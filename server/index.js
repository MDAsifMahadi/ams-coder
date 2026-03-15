/**
 * AMS Server - Express + WebSocket server for the AI Code Generator
 */

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const { AIClient } = require('./ai-client');
const { FileManager } = require('./file-manager');
const { getTools, getSystemPrompt, parseXmlToolCalls, stripXmlToolCalls } = require('./tools');
const { webSearch, fetchUrl } = require('./web-tools');

function startServer(projectDir, port) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const configPath = path.join(projectDir, 'ams.config.json');
  const fileManager = new FileManager(projectDir);

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ---------- REST API ----------

  app.get('/api/config', (req, res) => {
    res.json(loadConfig(configPath));
  });

  app.post('/api/config', (req, res) => {
    try {
      saveConfig(configPath, req.body);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/files', (req, res) => {
    res.json(fileManager.getFileTree());
  });

  app.get('/api/file', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    res.json(fileManager.readFile(filePath));
  });

  app.post('/api/file', (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    res.json(fileManager.modifyFile(filePath, content));
  });

  // ---------- WebSocket ----------

  wss.on('connection', (ws) => {
    let conversation = [];
    let abortController = null;

    ws.on('message', async (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        return;
      }

      if (msg.type === 'chat') {
        const config = loadConfig(configPath);
        const userMessage = { role: 'user', content: msg.message };
        // Add images if present
        if (msg.images && msg.images.length > 0) {
          userMessage.images = msg.images;
        }
        conversation.push(userMessage);

        abortController = new AbortController();
        try {
          await handleConversation(ws, config, conversation, fileManager, abortController.signal);
        } catch (err) {
          if (err.name !== 'AbortError') {
            safeSend(ws, { type: 'error', message: err.message });
          }
        }
        safeSend(ws, { type: 'done' });
        abortController = null;
      }

      if (msg.type === 'stop') {
        if (abortController) abortController.abort();
      }

      if (msg.type === 'clear') {
        conversation = [];
        if (abortController) abortController.abort();
      }
    });

    ws.on('close', () => {
      if (abortController) abortController.abort();
    });
  });

  // ---------- Start ----------

  server.listen(port, () => {
    const line = '='.repeat(46);
    console.log('');
    console.log(`  ${line}`);
    console.log('   AMS - AI Code Generator');
    console.log(`  ${line}`);
    console.log(`   Server:  http://localhost:${port}`);
    console.log(`   Project: ${projectDir}`);
    console.log(`  ${line}`);
    console.log('   Press Ctrl+C to stop');
    console.log('');

    // Try to open browser
    try {
      const open = require('open');
      open(`http://localhost:${port}`);
    } catch {
      // open package not available; user can open manually
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${port} is already in use. Try: ams --port=${port + 1}\n`);
      process.exit(1);
    }
    throw err;
  });
}

// ---------- Conversation Loop ----------

async function handleConversation(ws, config, conversation, fileManager, signal) {
  const systemPrompt = getSystemPrompt();
  const tools = getTools();
  const aiClient = new AIClient(config);

  const MAX_ITERATIONS = 25; // safety limit for agentic loop
  let useNativeTools = true; // Try native tools first

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    let response;
    try {
      response = await aiClient.chat(
        [{ role: 'system', content: systemPrompt }, ...conversation],
        useNativeTools ? tools : null,
        (token) => {
          safeSend(ws, { type: 'token', content: token });
        },
        signal
      );
    } catch (err) {
      // If tool calling is not supported, retry without tools
      if (err.message && (err.message.includes('tools') || err.message.includes('function'))) {
        console.log('[AMS] Native tool calling not supported, switching to XML mode');
        useNativeTools = false;
        response = await aiClient.chat(
          [{ role: 'system', content: systemPrompt }, ...conversation],
          null,
          (token) => {
            safeSend(ws, { type: 'token', content: token });
          },
          signal
        );
      } else {
        throw err;
      }
    }

    // Check for XML tool calls if no native tool calls found
    let toolCalls = response.toolCalls;
    let responseContent = response.content;

    if ((!toolCalls || toolCalls.length === 0) && responseContent) {
      const xmlToolCalls = parseXmlToolCalls(responseContent);
      if (xmlToolCalls.length > 0) {
        toolCalls = xmlToolCalls;
        responseContent = stripXmlToolCalls(responseContent);
      }
    }

    // If AI made tool calls, execute them and continue
    if (toolCalls && toolCalls.length > 0) {
      // Add assistant message with tool calls
      const assistantMsg = { role: 'assistant', tool_calls: toolCalls };
      if (responseContent) assistantMsg.content = responseContent;
      conversation.push(assistantMsg);

      // Execute each tool call
      for (const toolCall of toolCalls) {
        // Check for stop signal BEFORE each tool execution
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        let args;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = {};
        }

        safeSend(ws, {
          type: 'tool_call',
          id: toolCall.id,
          name: toolCall.function.name,
          args
        });

        const result = await executeTool(toolCall.function.name, args, fileManager, (output) => {
          // Also check signal during output streaming (though harder to cancel deep tools)
          if (!signal.aborted) {
            safeSend(ws, {
              type: 'tool_output',
              id: toolCall.id,
              output
            });
          }
        });

        safeSend(ws, {
          type: 'tool_result',
          id: toolCall.id,
          name: toolCall.function.name,
          result
        });

        // Notify frontend to refresh file tree after file mutations
        if (['create_file', 'modify_file', 'delete_file', 'move_file', 'copy_file', 'run_command'].includes(toolCall.function.name)) {
          safeSend(ws, { type: 'refresh_files' });
        }

        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }

      // Continue loop: let the AI respond to tool results
      continue;
    }

    // No tool calls: AI is done speaking
    if (responseContent) {
      conversation.push({ role: 'assistant', content: responseContent });
    }
    break;
  }
}

// ---------- Tool Execution ----------

async function executeTool(name, args, fileManager, onOutput) {
  switch (name) {
    case 'create_plan':
      return { success: true, title: args.title, steps: args.steps };
    case 'create_file':
      return fileManager.createFile(args.path, args.content);
    case 'read_file':
      return fileManager.readFile(args.path);
    case 'modify_file':
      return fileManager.modifyFile(args.path, args.content);
    case 'delete_file':
      return fileManager.deleteFile(args.path);
    case 'move_file':
      return fileManager.moveFile(args.source, args.destination);
    case 'copy_file':
      return fileManager.copyFile(args.source, args.destination);
    case 'list_files':
      return fileManager.listFiles(args.path || '.');
    case 'run_command':
      return fileManager.runCommand(args.command, onOutput);
    case 'search_files':
      return fileManager.searchFiles(args.query);
    case 'web_search':
      return webSearch(args.query);
    case 'fetch_url':
      return fetchUrl(args.url);
    default:
      return { error: `Tool not found: ${name}` };
  }
}

// ---------- Config Helpers ----------

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return {
      providers: [
        {
          id: 'ollama',
          name: 'Ollama (Local)',
          baseUrl: 'http://localhost:11434/v1',
          apiKeys: ['ollama'],
          models: ['codellama', 'llama3', 'mistral', 'qwen2.5-coder']
        }
      ],
      activeProvider: 'ollama',
      activeModel: 'qwen2.5-coder',
      temperature: 0.3
    };
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function saveConfig(configPath, config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function safeSend(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

module.exports = { startServer };
