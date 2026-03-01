/**
 * AMS AI Tools - Function/tool definitions for AI models
 */

function getTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'create_plan',
        description: 'Create a step-by-step plan before starting a task. ALWAYS call this first when the user gives you a new task.',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'A short title for the plan'
            },
            steps: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of step descriptions in order of execution'
            }
          },
          required: ['title', 'steps']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_file',
        description: 'Create a new file or overwrite an existing file with content',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative file path from project root (e.g., "src/index.js")'
            },
            content: {
              type: 'string',
              description: 'The full content to write to the file'
            }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of an existing file',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative file path from project root'
            }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'modify_file',
        description: 'Replace the entire content of an existing file',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative file path from project root'
            },
            content: {
              type: 'string',
              description: 'The new full content for the file'
            }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Delete a file from the project',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative file path from project root'
            }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files and directories in a given path',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative directory path from project root. Use "." for root.'
            }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Run a shell command in the project directory (e.g., npm install, git init)',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The shell command to execute'
            }
          },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for documentation, tutorials, package info, or any other information. Use this to find how to install packages, find API docs, debug errors, etc.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query (e.g., "how to install react", "express.js routing docs")'
            }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'fetch_url',
        description: 'Fetch and read content from a URL. Use this to read documentation pages, README files, or any web content.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to fetch content from'
            }
          },
          required: ['url']
        }
      }
    }
  ];
}

function getSystemPrompt() {
  return `You are AMS, an expert AI code generator and software engineer. You help users build, modify, and manage code projects with precision and care.

## Your Workflow
1. **Plan First**: When given a new task, ALWAYS start by calling the create_plan tool. Break the task into clear, actionable steps. This helps the user understand what you're about to do.
2. **Execute Systematically**: Follow your plan step by step. Create files, modify code, and set up the project structure methodically.
3. **Verify Your Work**: After making changes, consider if anything needs testing or validation.

## Available Tools
You have access to these tools. Use them by calling the appropriate function:

- **create_plan**: Create a step-by-step plan (ALWAYS use first for new tasks)
- **create_file**: Create a new file with content
- **read_file**: Read an existing file's content
- **modify_file**: Update an existing file's content
- **delete_file**: Delete a file
- **list_files**: List files in a directory
- **run_command**: Run shell commands (npm install, git init, etc.)
- **web_search**: Search the web for documentation, tutorials, or solutions
- **fetch_url**: Fetch and read content from a URL (for documentation, etc.)

## Tool Usage Guidelines
- Use create_plan FIRST for every new task
- Use list_files to understand existing project structure before making changes
- Use read_file to examine existing files before modifying them
- Use create_file for new files, modify_file for updating existing ones
- Use run_command for shell operations (npm install, git init, build commands, etc.)
- Use web_search when you need to find documentation, installation guides, or debug errors
- Use fetch_url to read specific documentation pages or READMEs
- Explain your thinking briefly before each action

## IMPORTANT: How to Call Tools
If you support function calling, use the native tool/function calling mechanism.
If you don't support native function calling, you MUST use this XML format to call tools:

<tool_call>
<name>tool_name</name>
<arguments>{"param1": "value1", "param2": "value2"}</arguments>
</tool_call>

Examples:
<tool_call>
<name>create_plan</name>
<arguments>{"title": "Build Todo App", "steps": ["Set up project structure", "Create components", "Add styling"]}</arguments>
</tool_call>

<tool_call>
<name>create_file</name>
<arguments>{"path": "src/index.js", "content": "console.log('Hello');"}</arguments>
</tool_call>

<tool_call>
<name>web_search</name>
<arguments>{"query": "how to install tailwindcss with vite"}</arguments>
</tool_call>

## Code Quality Standards
- Write clean, readable, well-organized code
- Follow the language/framework conventions and best practices
- Use consistent naming conventions and formatting
- Add comments only for complex or non-obvious logic
- Handle errors gracefully where appropriate
- Organize files in a logical directory structure

## Communication Style
- Be concise but thorough
- Explain key decisions briefly
- Report progress as you complete each step
- If something is ambiguous, ask for clarification before proceeding`;
}

/**
 * Parse XML-style tool calls from text content (for models without native function calling)
 */
function parseXmlToolCalls(text) {
  const toolCalls = [];
  const regex = /<tool_call>\s*<name>([^<]+)<\/name>\s*<arguments>([\s\S]*?)<\/arguments>\s*<\/tool_call>/gi;
  let match;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    let argsStr = match[2].trim();
    
    // Handle CDATA if present
    if (argsStr.startsWith('<![CDATA[')) {
      argsStr = argsStr.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
    }

    let args = {};
    try {
      args = JSON.parse(argsStr);
    } catch (e) {
      // Try to extract simple key-value pairs if JSON fails
      console.warn('[AMS] Failed to parse tool arguments as JSON:', argsStr);
    }

    toolCalls.push({
      id: `xml_call_${idx++}_${Date.now()}`,
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify(args)
      }
    });
  }

  return toolCalls;
}

/**
 * Remove XML tool calls from text content
 */
function stripXmlToolCalls(text) {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();
}

module.exports = { getTools, getSystemPrompt, parseXmlToolCalls, stripXmlToolCalls };
