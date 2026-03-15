/**
 * AMS - AI Code Generator Frontend Application
 */

(function () {
  'use strict';

  // ---- Markdown & Highlight setup ----
  function initializeMarkdown() {
    const markedLib = typeof marked !== 'undefined' ? marked : (window.marked || null);
    const hljsLib = typeof hljs !== 'undefined' ? hljs : (window.hljs || null);

    if (!markedLib) {
      console.error('Marked library not found!');
      return;
    }

    const target = markedLib.marked || markedLib;

    target.setOptions({
      breaks: true,
      gfm: true,
      highlight: function (code, lang) {
        if (hljsLib && lang && hljsLib.getLanguage(lang)) {
          try { return hljsLib.highlight(code, { language: lang }).value; } catch {}
        }
        if (hljsLib) {
          try { return hljsLib.highlightAuto(code).value; } catch {}
        }
        return code;
      }
    });

    const renderer = new target.Renderer();
    renderer.code = function (code, lang) {
      const text = typeof code === 'object' ? code.text : code;
      const language = (typeof code === 'object' ? code.lang : lang) || '';
      let highlighted;
      if (hljsLib && language && hljsLib.getLanguage(language)) {
        try { highlighted = hljsLib.highlight(text, { language }).value; } catch { highlighted = escapeHtml(text); }
      } else {
        highlighted = escapeHtml(text);
      }
      return `<pre><div class="code-header"><span>${language || 'code'}</span><button class="code-copy-btn" onclick="window.__amsCopy(this)">Copy</button></div><code class="hljs">${highlighted}</code></pre>`;
    };
    target.setOptions({ renderer });
  }

  initializeMarkdown();

  // Global copy helper for code blocks
  window.__amsCopy = (btn) => {
    const code = btn.closest('pre').querySelector('code').innerText;
    navigator.clipboard.writeText(code).then(() => {
      const originalText = btn.innerText;
      btn.innerText = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerText = originalText;
        btn.classList.remove('copied');
      }, 2000);
    });
  };

  // ---- State ----
  let ws = null;
  let config = null;
  let isStreaming = false;
  let currentStreamEl = null;  // the element receiving streamed tokens
  let streamBuffer = '';        // raw markdown text being built up
  let selectedProviderIdx = 0;
  let monacoEditor = null;
  let currentFilePath = null;
  let isMarkedReady = false;

  // Voice recognition state
  let recognition = null;
  let isRecording = false;
  let voiceLang = 'bn-BD'; // Default: Bengali

  // Status indicator state
  let statusIndicatorEl = null;

  // ---- DOM refs ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    messages: $('#messages'),
    welcome: $('#welcome'),
    input: $('#messageInput'),
    sendBtn: $('#sendBtn'),
    stopBtn: $('#stopBtn'),
    clearBtn: $('#clearChat'),
    settingsBtn: $('#settingsBtn'),
    themeToggle: $('#themeToggle'),
    sidebarToggle: $('#sidebarToggle'),
    sidebar: $('#sidebar'),
    fileTree: $('#fileTree'),
    refreshFiles: $('#refreshFiles'),
    connStatus: $('#connStatus'),
    providerSelect: $('#providerSelect'),
    modelSelect: $('#modelSelect'),
    modelCustom: $('#modelCustom'),
    // Settings
    settingsModal: $('#settingsModal'),
    closeSettings: $('#closeSettings'),
    providerTabs: $('#providerTabs'),
    cfgProviderName: $('#cfgProviderName'),
    cfgBaseUrl: $('#cfgBaseUrl'),
    cfgApiKeys: $('#cfgApiKeys'),
    cfgModels: $('#cfgModels'),
    newModelInput: $('#newModelInput'),
    addModel: $('#addModel'),
    addApiKey: $('#addApiKey'),
    addProvider: $('#addProvider'),
    removeProvider: $('#removeProvider'),
    cfgTemperature: $('#cfgTemperature'),
    tempValue: $('#tempValue'),
    saveSettings: $('#saveSettings'),
    // File viewer
    fileViewerModal: $('#fileViewerModal'),
    closeFileViewer: $('#closeFileViewer'),
    saveFileBtn: $('#saveFileBtn'),
    fileViewerTitle: $('#fileViewerTitle'),
    monacoEditor: $('#monacoEditor'),
    // Voice controls
    voiceBtn: $('#voiceBtn'),
    voiceLangBtn: $('#voiceLangBtn'),
    voiceLangLabel: $('#voiceLangLabel'),
    imageUploadBtn: $('#imageUploadBtn'),
    imageInput: $('#imageInput'),
    imagePreviewsContainer: $('#imagePreviewsContainer')
  };

  // ---- Init ----
  async function init() {
    initializeTheme();
    await loadConfig();
    connectWebSocket();
    setupEventListeners();
    loadFileTree();
    initVoiceRecognition();
    setupLeavePageWarning();
    initMonaco();
  }

  function initMonaco() {
    if (typeof require === 'undefined') return;
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function () {
      monacoEditor = monaco.editor.create(dom.monacoEditor, {
        value: '',
        language: 'javascript',
        theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: false },
        scrollbar: { vertical: 'auto', horizontal: 'auto' }
      });
    });
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-message">${message}</span>
    `;
    const container = $('#toastContainer');
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ---- Leave Page Warning ----
  function setupLeavePageWarning() {
    console.log('Leave page warning system initialized');
    
    // Add beforeunload event listener to warn users when leaving the page
    window.addEventListener('beforeunload', function(e) {
      // Check if there's an active conversation or streaming in progress
      // Look for actual message elements (not just the welcome screen)
      const messageElements = dom.messages.querySelectorAll('.msg-user, .msg-ai, .plan-card, .action-card, .status-indicator, .msg-error');
      const hasMessages = messageElements.length > 0;
      const isStreamingActive = isStreaming;
      
      console.log('Leave page check:', { hasMessages, isStreamingActive, messageCount: messageElements.length });
      
      if (hasMessages || isStreamingActive) {
        // Modern browser standard for beforeunload
        const message = 'You have an active conversation. Are you sure you want to leave?';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    });
    
    // Also handle page visibility change for better detection
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        // Page is being hidden (tab switched, window minimized, etc.)
        const messageElements = dom.messages.querySelectorAll('.msg-user, .msg-ai, .plan-card, .action-card, .status-indicator, .msg-error');
        const hasMessages = messageElements.length > 0;
        const isStreamingActive = isStreaming;
        
        if (hasMessages || isStreamingActive) {
          // Store a flag that we warned the user
          sessionStorage.setItem('ams-page-hidden-warning', 'true');
        }
      }
    });
  }

  // ---- Theme Management ----
  function initializeTheme() {
    const savedTheme = localStorage.getItem('ams-theme') || 'dark';
    setTheme(savedTheme);
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ams-theme', theme);
    
    // Update theme toggle icon
    const themeIcon = dom.themeToggle.querySelector('svg');
    if (themeIcon) {
      // Change icon based on theme
      if (theme === 'light') {
        themeIcon.innerHTML = '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>'; // Sun icon
      } else {
        themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>'; // Moon icon
      }
    }
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  }

  // ---- Config ----
  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      config = await res.json();
    } catch {
      config = { providers: [], activeProvider: '', activeModel: '' };
    }
    populateProviderSelect();
    populateModelSelect();
  }

  async function saveConfigToServer() {
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  }

  function populateProviderSelect() {
    dom.providerSelect.innerHTML = '';
    (config.providers || []).forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === config.activeProvider) opt.selected = true;
      dom.providerSelect.appendChild(opt);
    });
  }

  function populateModelSelect() {
    dom.modelSelect.innerHTML = '';
    const provider = config.providers.find(p => p.id === config.activeProvider);
    if (!provider) return;
    (provider.models || []).forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      if (m === config.activeModel) opt.selected = true;
      dom.modelSelect.appendChild(opt);
    });
    dom.modelCustom.value = '';
  }

  function getActiveProvider() {
    return config.providers.find(p => p.id === config.activeProvider);
  }

  // ---- WebSocket ----
  function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => {
      dom.connStatus.textContent = 'Connected';
      dom.connStatus.className = 'connection-status connected';
    };

    ws.onclose = () => {
      dom.connStatus.textContent = 'Disconnected';
      dom.connStatus.className = 'connection-status disconnected';
      // Reconnect after 2s
      setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = () => {};

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handleServerMessage(msg);
    };
  }

  function wsSend(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // ---- Server message handler ----
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'token':
        handleToken(msg.content);
        break;
      case 'tool_call':
        handleToolCall(msg);
        break;
      case 'tool_output':
        handleToolOutput(msg);
        break;
      case 'tool_result':
        handleToolResult(msg);
        break;
      case 'refresh_files':
        loadFileTree();
        break;
      case 'done':
        handleDone();
        break;
      case 'error':
        handleError(msg.message);
        break;
    }
  }

  // ---- Chat ----
  function sendMessage() {
    const text = dom.input.value.trim();
    const images = getQueuedImages();
    
    if ((!text && images.length === 0) || isStreaming) return;

    // Check for API keys
    const provider = getActiveProvider();
    if (!provider || !provider.apiKeys || provider.apiKeys.filter(k => k.trim()).length === 0) {
      if (provider && provider.id !== 'ollama-local') {
        showSettingsModal();
        return;
      }
    }

    hideWelcome();
    appendUserMessage(text, images);
    dom.input.value = '';
    autoResize(dom.input);
    clearQueuedImages();

    startStreaming();
    wsSend({ type: 'chat', message: text, images: images });
  }

  function startStreaming() {
    isStreaming = true;
    dom.sendBtn.classList.add('hidden');
    dom.stopBtn.classList.remove('hidden');
    dom.input.disabled = true;
    streamBuffer = '';
    currentStreamEl = null;
    
    // Show initial thinking status
    showStatusIndicator('Thinking');
  }

  function stopStreaming() {
    isStreaming = false;
    dom.sendBtn.classList.remove('hidden');
    dom.stopBtn.classList.add('hidden');
    dom.input.disabled = false;
    dom.input.focus();

    // Remove streaming cursor
    const cursors = dom.messages.querySelectorAll('.streaming-cursor');
    cursors.forEach(c => c.classList.remove('streaming-cursor'));
    
    // Hide status indicator
    hideStatusIndicator();
  }

  // ---- Status Indicator ----
  function showStatusIndicator(status) {
    hideStatusIndicator();
    
    const div = document.createElement('div');
    div.className = 'status-indicator';
    div.innerHTML = `
      <div class="status-dot"></div>
      <span class="status-text">${escapeHtml(status)}</span>
      <span class="status-dots">...</span>
    `;
    dom.messages.appendChild(div);
    statusIndicatorEl = div;
    scrollToBottom();
  }

  function updateStatusIndicator(status) {
    if (statusIndicatorEl) {
      const textEl = statusIndicatorEl.querySelector('.status-text');
      if (textEl) textEl.textContent = status;
      
      // Update status dynamically based on activity
      if (status.includes('Generate') || status.includes('Thinking')) {
        // Add pulsing effect for code generation
        statusIndicatorEl.classList.add('generating');
      } else {
        statusIndicatorEl.classList.remove('generating');
      }
    } else {
      showStatusIndicator(status);
    }
  }

  function hideStatusIndicator() {
    if (statusIndicatorEl) {
      statusIndicatorEl.remove();
      statusIndicatorEl = null;
    }
  }

  function handleToken(token) {
    // Update status indicator to show code generation is happening
    updateStatusIndicator('Generating code');
    
    if (!currentStreamEl) {
      // Create a new AI message container
      const aiMsg = createAiMessageContainer();
      currentStreamEl = aiMsg.querySelector('.msg-content');
    }
    streamBuffer += token;
    renderStreamContent();
  }

  function renderStreamContent() {
    if (!currentStreamEl) return;
    try {
      const markedLib = typeof marked !== 'undefined' ? marked : (window.marked || null);
      if (!markedLib) return;
      
      const target = markedLib.marked || markedLib;
      currentStreamEl.innerHTML = target.parse(streamBuffer);
      currentStreamEl.classList.add('streaming-cursor', 'streaming');
      // Scroll to bottom
      scrollToBottom();
    } catch (err) {
      console.error('Marked parse error:', err);
    }
  }

  function scrollToBottom() {
    dom.messages.scrollTop = dom.messages.scrollHeight;
  }

  function handleToolCall(msg) {
    // Finalize current stream text if any
    finalizeCurrentStream();

    // Update status indicator based on tool type
    let statusText = 'Working';
    switch (msg.name) {
      case 'create_plan':
        statusText = 'Planning';
        break;
      case 'create_file':
        statusText = 'Creating file';
        break;
      case 'modify_file':
        statusText = 'Modifying file';
        break;
      case 'read_file':
        statusText = 'Reading file';
        break;
      case 'delete_file':
        statusText = 'Deleting file';
        break;
      case 'list_files':
        statusText = 'Listing files';
        break;
      case 'run_command':
        statusText = 'Running command';
        break;
      case 'web_search':
        statusText = 'Searching web';
        break;
      case 'fetch_url':
        statusText = 'Fetching URL';
        break;
    }
    updateStatusIndicator(statusText);

    if (msg.name === 'create_plan') {
      appendPlanCard(msg.args);
    } else {
      appendActionCard(msg.name, msg.args, msg.id);
    }
    scrollToBottom();
  }

  function handleToolOutput(msg) {
    const card = dom.messages.querySelector(`.action-card[data-id="${msg.id}"]`);
    if (!card) return;
    
    let outputEl = card.querySelector('.action-command-output');
    if (!outputEl) {
      const pre = document.createElement('pre');
      pre.className = 'action-command-output';
      outputEl = document.createElement('code');
      pre.appendChild(outputEl);
      card.appendChild(pre);
      card.classList.add('has-output');
    }
    
    outputEl.textContent += msg.output;
    // Auto-scroll the output if needed
    outputEl.parentElement.scrollTop = outputEl.parentElement.scrollHeight;
    // Scroll global messages
    scrollToBottom();
  }

  function handleToolResult(msg) {
    if (msg.name === 'create_plan' && msg.result && msg.result.steps) {
      // Plan was returned as result, update plan card if we didn't already create one
      const lastPlan = dom.messages.querySelector('.plan-card:last-of-type');
      if (!lastPlan) {
        appendPlanCard(msg.result);
      }
    }
    // Could update action cards with results here if needed
    scrollToBottom();
  }

  function handleDone() {
    finalizeCurrentStream();
    hideStatusIndicator();
    stopStreaming();
  }

  function handleError(message) {
    finalizeCurrentStream();
    appendErrorMessage(message);
    stopStreaming();
  }

  function finalizeCurrentStream() {
    if (currentStreamEl) {
      currentStreamEl.classList.remove('streaming-cursor', 'streaming');
      if (streamBuffer) {
        try { 
          const markedLib = typeof marked !== 'undefined' ? marked : (window.marked || null);
          const hljsLib = typeof hljs !== 'undefined' ? hljs : (window.hljs || null);
          if (markedLib) {
            const target = markedLib.marked || markedLib;
            currentStreamEl.innerHTML = target.parse(streamBuffer);
          }
          
          // Highlight any code blocks
          if (hljsLib) {
            currentStreamEl.querySelectorAll('pre code').forEach(block => {
              try { hljsLib.highlightElement(block); } catch {}
            });
          }
        } catch (err) {
          console.error('Finalize stream error:', err);
        }
      }
      currentStreamEl = null;
      streamBuffer = '';
    }
  }

  function highlightCodeBlocks(container) {
    if (!container) return;
    const hljsLib = typeof hljs !== 'undefined' ? hljs : (window.hljs || null);
    if (!hljsLib) return;

    container.querySelectorAll('pre code').forEach(block => {
      try { hljsLib.highlightElement(block); } catch {}
    });
  }

  // ---- Message rendering ----
  function hideWelcome() {
    if (dom.welcome) dom.welcome.style.display = 'none';
  }

  function appendUserMessage(text, images = []) {
    const div = document.createElement('div');
    div.className = 'msg msg-user';
    
    let content = '';
    if (text) {
      content += `<div class="msg-bubble">${escapeHtml(text)}</div>`;
    }
    
    if (images && images.length > 0) {
      const imageHtml = images.map(img => `
        <div class="user-image-preview">
          <img src="${img.dataUrl}" alt="Uploaded image" />
        </div>`).join('');
      content += imageHtml;
    }
    
    div.innerHTML = content;
    dom.messages.appendChild(div);
    scrollToBottom();
  }

  function createAiMessageContainer() {
    const div = document.createElement('div');
    div.className = 'msg msg-ai';
    div.innerHTML = `
      <div class="msg-header">
        <div class="msg-avatar">A</div>
        <span class="msg-label">AMS</span>
      </div>
      <div class="msg-content"></div>
    `;
    dom.messages.appendChild(div);
    return div;
  }

  function appendPlanCard(args) {
    const steps = args.steps || [];
    const title = args.title || 'Plan';
    const div = document.createElement('div');
    div.className = 'plan-card';
    div.innerHTML = `
      <div class="plan-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        ${escapeHtml(title)}
      </div>
      <ol class="plan-steps">
        ${steps.map((s, i) => `
          <li class="plan-step">
            <span class="plan-step-num">${i + 1}</span>
            <span>${escapeHtml(s)}</span>
          </li>
        `).join('')}
      </ol>
    `;
    dom.messages.appendChild(div);
  }

  function appendActionCard(type, args, id) {
    const div = document.createElement('div');
    div.className = `action-card ${type.replace(/_/g, '-')}`;
    if (id) div.setAttribute('data-id', id);
    
    let icon = '&#9881;';
    let label = type;
    
    switch (type) {
      case 'create_file': icon = '&#10010;'; label = `Create: ${args.path}`; break;
      case 'read_file': icon = '&#128269;'; label = `Read: ${args.path}`; break;
      case 'modify_file': icon = '&#9998;'; label = `Modify: ${args.path}`; break;
      case 'delete_file': icon = '&#128465;'; label = `Delete: ${args.path}`; break;
      case 'move_file': icon = '&#10145;'; label = `Move: ${args.source} to ${args.destination}`; break;
      case 'copy_file': icon = '&#128101;'; label = `Copy: ${args.source} to ${args.destination}`; break;
      case 'list_files': icon = '&#128193;'; label = `List: ${args.path || '.'}`; break;
      case 'run_command': icon = '&#62;_'; label = args.command; break;
      case 'search_files': icon = '&#128269;'; label = `Search: ${args.query}`; break;
      case 'web_search': icon = '&#127760;'; label = `Search Web: ${args.query}`; break;
      case 'fetch_url': icon = '&#128196;'; label = `Fetch: ${args.url}`; break;
    }

    if (args.content && (type === 'create_file' || type === 'modify_file')) {
      const filePath = args.path || '';
      const codeContent = args.content || '';
      const ext = filePath.split('.').pop().toLowerCase();
      const hljsLib = typeof hljs !== 'undefined' ? hljs : (window.hljs || null);
      const lang = (hljsLib && hljsLib.getLanguage(ext)) ? ext : '';
      
      let highlightedCode;
      try {
        highlightedCode = (hljsLib && lang)
          ? hljsLib.highlight(codeContent, { language: lang }).value 
          : escapeHtml(codeContent);
      } catch {
        highlightedCode = escapeHtml(codeContent);
      }
      
      div.innerHTML = `
        <div class="action-header">
          <span class="action-icon">${icon}</span>
          <span class="action-path">${escapeHtml(label)}</span>
          <button class="action-expand-btn" title="Show code">
            <svg class="chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
        <div class="action-code-preview collapsed">
          <pre><code class="hljs">${highlightedCode}</code></pre>
        </div>
      `;
      
      // Add click handler for expand/collapse
      const expandBtn = div.querySelector('.action-expand-btn');
      const codePreview = div.querySelector('.action-code-preview');
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isExpanded = !codePreview.classList.contains('collapsed');
        codePreview.classList.toggle('collapsed');
        expandBtn.classList.toggle('expanded', !isExpanded);
        expandBtn.title = isExpanded ? 'Show code' : 'Hide code';
      });
    } else {
      div.innerHTML = `<span class="action-icon">${icon}</span><span class="action-path">${escapeHtml(label)}</span>`;
    }
    
    dom.messages.appendChild(div);
  }

  function appendErrorMessage(message) {
    const div = document.createElement('div');
    div.className = 'msg-error';
    div.textContent = message;
    dom.messages.appendChild(div);
    scrollToBottom();
  }

  // ---- File Tree ----
  async function loadFileTree() {
    try {
      const res = await fetch('/api/files');
      const tree = await res.json();
      renderFileTree(tree);
    } catch {
      dom.fileTree.innerHTML = '<div class="tree-empty">Failed to load files</div>';
    }
  }

  function renderFileTree(items) {
    dom.fileTree.innerHTML = '';
    if (!items || items.length === 0) {
      dom.fileTree.innerHTML = '<div class="tree-empty">No files yet</div>';
      return;
    }
    const container = document.createDocumentFragment();
    buildTreeNodes(items, container, 0);
    dom.fileTree.appendChild(container);
  }

  function buildTreeNodes(items, parent, depth) {
    for (const item of items) {
      if (item.type === 'directory') {
        const row = document.createElement('div');
        row.className = 'tree-item';
        row.style.paddingLeft = `${12 + depth * 16}px`;
        row.innerHTML = `<span class="tree-icon folder">&#9656;</span><span class="tree-item-name">${escapeHtml(item.name)}</span>`;

        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children collapsed';
        if (item.children) {
          buildTreeNodes(item.children, childContainer, depth + 1);
          // Auto-expand first level
          if (depth < 1) {
            childContainer.classList.remove('collapsed');
            childContainer.style.maxHeight = 'none';
            row.querySelector('.tree-icon').innerHTML = '&#9662;';
          }
        }

        row.addEventListener('click', (e) => {
          e.stopPropagation();
          const icon = row.querySelector('.tree-icon');
          if (childContainer.classList.contains('collapsed')) {
            childContainer.classList.remove('collapsed');
            childContainer.style.maxHeight = 'none';
            icon.innerHTML = '&#9662;';
          } else {
            childContainer.classList.add('collapsed');
            icon.innerHTML = '&#9656;';
          }
        });

        parent.appendChild(row);
        parent.appendChild(childContainer);
      } else {
        const row = document.createElement('div');
        row.className = 'tree-item';
        row.style.paddingLeft = `${12 + depth * 16}px`;
        const ext = item.name.split('.').pop().toLowerCase();
        const iconColor = getFileIconColor(ext);
        row.innerHTML = `<span class="tree-icon file" style="color:${iconColor}">&bull;</span><span class="tree-item-name">${escapeHtml(item.name)}</span>`;
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          openFile(item.path, item.name);
        });
        parent.appendChild(row);
      }
    }
  }

  function getFileIconColor(ext) {
    const colors = {
      js: '#f7df1e', ts: '#3178c6', jsx: '#61dafb', tsx: '#61dafb',
      py: '#3776ab', rb: '#cc342d', go: '#00add8', rs: '#dea584',
      html: '#e34f26', css: '#1572b6', scss: '#c69',
      json: '#a0a0a0', md: '#808080', yml: '#cb171e', yaml: '#cb171e',
      sql: '#e38c00', sh: '#89e051', bash: '#89e051',
      java: '#b07219', c: '#555', cpp: '#f34b7d', h: '#555'
    };
    return colors[ext] || 'var(--text-muted)';
  }

  async function openFile(filePath, name) {
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (data.success) {
        currentFilePath = filePath;
        dom.fileViewerTitle.textContent = name;
        
        if (monacoEditor) {
          const ext = name.split('.').pop().toLowerCase();
          let lang = 'javascript';
          if (ext === 'py') lang = 'python';
          else if (ext === 'html') lang = 'html';
          else if (ext === 'css') lang = 'css';
          else if (ext === 'json') lang = 'json';
          else if (ext === 'md') lang = 'markdown';
          else if (ext === 'ts') lang = 'typescript';
          
          monaco.editor.setModelLanguage(monacoEditor.getModel(), lang);
          monacoEditor.setValue(data.content);
          
          // Set theme based on current app theme
          const isLight = document.documentElement.getAttribute('data-theme') === 'light';
          monaco.editor.setTheme(isLight ? 'vs' : 'vs-dark');
        }
        
        dom.fileViewerModal.classList.remove('hidden');
      } else {
        showToast(data.error || 'Failed to open file', 'error');
      }
    } catch (err) {
      showToast('Error opening file: ' + err.message, 'error');
    }
  }

  async function saveFile() {
     if (!currentFilePath || !monacoEditor) return;
     
     const content = monacoEditor.getValue();
     try {
       const response = await fetch('/api/file', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ path: currentFilePath, content })
       });
       
       const data = await response.json();
       if (data.success) {
         showToast('File saved successfully', 'success');
       } else {
         showToast(data.error || 'Failed to save file', 'error');
       }
     } catch (err) {
       showToast('Error saving file: ' + err.message, 'error');
     }
   }

  // ---- Settings Modal ----
  function showSettingsModal() {
    selectedProviderIdx = config.providers.findIndex(p => p.id === config.activeProvider);
    if (selectedProviderIdx < 0) selectedProviderIdx = 0;
    renderSettingsTabs();
    renderSettingsForm();
    dom.settingsModal.classList.remove('hidden');
  }

  function hideSettingsModal() {
    dom.settingsModal.classList.add('hidden');
  }

  function renderSettingsTabs() {
    dom.providerTabs.innerHTML = '';
    config.providers.forEach((p, i) => {
      const tab = document.createElement('button');
      tab.className = `settings-tab ${i === selectedProviderIdx ? 'active' : ''}`;
      tab.textContent = p.name;
      tab.addEventListener('click', () => {
        selectedProviderIdx = i;
        renderSettingsTabs();
        renderSettingsForm();
      });
      dom.providerTabs.appendChild(tab);
    });
  }

  function renderSettingsForm() {
    const p = config.providers[selectedProviderIdx];
    if (!p) return;

    dom.cfgProviderName.value = p.name || '';
    dom.cfgBaseUrl.value = p.baseUrl || '';
    dom.cfgTemperature.value = config.temperature || 0.3;
    dom.tempValue.textContent = config.temperature || 0.3;

    // API Keys
    dom.cfgApiKeys.innerHTML = '';
    (p.apiKeys || []).forEach((key, i) => {
      const row = document.createElement('div');
      row.className = 'api-key-row';
      row.innerHTML = `
        <input type="password" class="text-input api-key-input" value="${escapeHtml(key)}" placeholder="API key ${i + 1}" />
        <button class="api-key-remove" data-idx="${i}" title="Remove">&times;</button>
      `;
      row.querySelector('.api-key-remove').addEventListener('click', () => {
        p.apiKeys.splice(i, 1);
        renderSettingsForm();
      });
      // Toggle visibility on focus
      const inp = row.querySelector('.api-key-input');
      inp.addEventListener('focus', () => { inp.type = 'text'; });
      inp.addEventListener('blur', () => { inp.type = 'password'; });
      inp.addEventListener('input', () => { p.apiKeys[i] = inp.value; });
      dom.cfgApiKeys.appendChild(row);
    });

    // Models
    dom.cfgModels.innerHTML = '';
    (p.models || []).forEach((m, i) => {
      const tag = document.createElement('span');
      tag.className = 'model-tag';
      tag.innerHTML = `${escapeHtml(m)}<button class="model-tag-remove" data-idx="${i}">&times;</button>`;
      tag.querySelector('.model-tag-remove').addEventListener('click', () => {
        p.models.splice(i, 1);
        renderSettingsForm();
      });
      dom.cfgModels.appendChild(tag);
    });
  }

  function applySettingsFromForm() {
    const p = config.providers[selectedProviderIdx];
    if (!p) return;

    p.name = dom.cfgProviderName.value.trim() || p.name;
    p.baseUrl = dom.cfgBaseUrl.value.trim();
    config.temperature = parseFloat(dom.cfgTemperature.value) || 0.3;

    // Read API key inputs
    const keyInputs = dom.cfgApiKeys.querySelectorAll('.api-key-input');
    p.apiKeys = Array.from(keyInputs).map(inp => inp.value.trim()).filter(Boolean);

    config.activeProvider = p.id;
    if (p.models && p.models.length > 0 && !p.models.includes(config.activeModel)) {
      config.activeModel = p.models[0];
    }
  }

  // ---- Event Listeners ----
  function setupEventListeners() {
    // Send message
    dom.sendBtn.addEventListener('click', sendMessage);
    dom.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto resize textarea
    dom.input.addEventListener('input', () => autoResize(dom.input));

    // Stop generation
    dom.stopBtn.addEventListener('click', () => {
      wsSend({ type: 'stop' });
      // Don't stop streaming UI immediately, wait for server to confirm with 'done' or 'error'
      // This ensures we don't have UI/Server state mismatch
      // But we can show a "Stopping" status
      updateStatusIndicator('Stopping');
    });

    // Clear chat
    dom.clearBtn.addEventListener('click', () => {
      wsSend({ type: 'clear' });
      dom.messages.innerHTML = '';
      if (dom.welcome) {
        dom.messages.appendChild(dom.welcome);
        dom.welcome.style.display = '';
      }
      if (isStreaming) stopStreaming();
    });

    // Sidebar toggle
    dom.sidebarToggle.addEventListener('click', () => {
      document.querySelector('.app').classList.toggle('sidebar-collapsed');
      
      // On mobile, ensure main content is accessible when sidebar is closed
      if (window.innerWidth <= 768) {
        // Add a small delay to ensure the transition completes
        setTimeout(() => {
          // Make sure main content area is properly focused/visible
          dom.messages.scrollTop = dom.messages.scrollTop; // Trigger reflow
        }, 300);
      }
    });

    // Refresh file tree
    dom.refreshFiles.addEventListener('click', loadFileTree);

    // Provider & model selects
    dom.providerSelect.addEventListener('change', () => {
      config.activeProvider = dom.providerSelect.value;
      populateModelSelect();
      saveConfigToServer();
    });

    dom.modelSelect.addEventListener('change', () => {
      config.activeModel = dom.modelSelect.value;
      dom.modelCustom.value = '';
      saveConfigToServer();
    });

    dom.modelCustom.addEventListener('change', () => {
      const val = dom.modelCustom.value.trim();
      if (val) {
        config.activeModel = val;
        saveConfigToServer();
      }
    });

    // Settings modal
    dom.settingsBtn.addEventListener('click', showSettingsModal);
    dom.closeSettings.addEventListener('click', hideSettingsModal);
    dom.settingsModal.addEventListener('click', (e) => {
      if (e.target === dom.settingsModal) hideSettingsModal();
    });

    // Temperature slider
    dom.cfgTemperature.addEventListener('input', () => {
      dom.tempValue.textContent = dom.cfgTemperature.value;
    });

    // Add API key
    dom.addApiKey.addEventListener('click', () => {
      const p = config.providers[selectedProviderIdx];
      if (p) {
        if (!p.apiKeys) p.apiKeys = [];
        p.apiKeys.push('');
        renderSettingsForm();
        // Focus the new input
        const inputs = dom.cfgApiKeys.querySelectorAll('.api-key-input');
        if (inputs.length) inputs[inputs.length - 1].focus();
      }
    });

    // Add model
    dom.addModel.addEventListener('click', () => {
      const val = dom.newModelInput.value.trim();
      if (!val) return;
      const p = config.providers[selectedProviderIdx];
      if (p) {
        if (!p.models) p.models = [];
        if (!p.models.includes(val)) p.models.push(val);
        dom.newModelInput.value = '';
        renderSettingsForm();
      }
    });

    dom.newModelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        dom.addModel.click();
      }
    });

    // Add provider
    dom.addProvider.addEventListener('click', () => {
      const id = 'provider-' + Date.now();
      config.providers.push({
        id,
        name: 'New Provider',
        baseUrl: '',
        apiKeys: [],
        models: []
      });
      selectedProviderIdx = config.providers.length - 1;
      renderSettingsTabs();
      renderSettingsForm();
    });

    // Remove provider
    dom.removeProvider.addEventListener('click', () => {
      if (config.providers.length <= 1) return;
      config.providers.splice(selectedProviderIdx, 1);
      selectedProviderIdx = Math.max(0, selectedProviderIdx - 1);
      renderSettingsTabs();
      renderSettingsForm();
    });

    // Save settings
    dom.saveSettings.addEventListener('click', async () => {
      applySettingsFromForm();
      await saveConfigToServer();
      await loadConfig();
      hideSettingsModal();
      showToast('Settings saved', 'success');
      // Update monaco theme if changed
      if (monacoEditor) {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        monaco.editor.setTheme(isLight ? 'vs' : 'vs-dark');
      }
    });

    // File viewer
    dom.closeFileViewer.addEventListener('click', () => {
      dom.fileViewerModal.classList.add('hidden');
      currentFilePath = null;
    });
    dom.saveFileBtn.addEventListener('click', saveFile);
    dom.fileViewerModal.addEventListener('click', (e) => {
      if (e.target === dom.fileViewerModal) dom.fileViewerModal.classList.add('hidden');
    });

    // Welcome tips: click to use as prompt
    document.querySelectorAll('.tip').forEach(tip => {
      tip.addEventListener('click', () => {
        dom.input.value = tip.textContent.replace(/^"|"$/g, '');
        autoResize(dom.input);
        dom.input.focus();
      });
    });

    // Theme toggle
    dom.themeToggle.addEventListener('click', () => {
      toggleTheme();
      if (monacoEditor) {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        monaco.editor.setTheme(isLight ? 'vs' : 'vs-dark');
      }
    });
    
    // Image upload
    dom.imageUploadBtn.addEventListener('click', () => {
      dom.imageInput.click();
    });
    
    dom.imageInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        processImageFile(file);
      }
    });
    
    // Voice controls
    if (dom.voiceBtn) {
      dom.voiceBtn.addEventListener('click', toggleVoiceRecording);
    }
    if (dom.voiceLangBtn) {
      dom.voiceLangBtn.addEventListener('click', toggleVoiceLanguage);
    }
  }
  
  // ---- Image Processing ----
  function processImageFile(file) {
    if (!file.type.match('image.*')) {
      alert('Please select an image file');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const imageDataUrl = e.target.result;
      addImageToInput(imageDataUrl, file.name);
    };
    reader.readAsDataURL(file);
  }
  
  function addImageToInput(imageDataUrl, fileName) {
    // Create an image preview in the dedicated container
    const imagePreview = document.createElement('div');
    imagePreview.className = 'image-preview';
    imagePreview.innerHTML = `
      <img src="${imageDataUrl}" alt="Preview" />
      <span class="image-filename">${fileName}</span>
      <button class="remove-image-btn" type="button">&times;</button>
    `;
    
    // Add to the dedicated image previews container
    dom.imagePreviewsContainer.appendChild(imagePreview);
    
    // Add event listener to remove button
    imagePreview.querySelector('.remove-image-btn').addEventListener('click', () => {
      imagePreview.remove();
      // Remove from queued images
      const index = window.queuedImages.findIndex(img => img.dataUrl === imageDataUrl);
      if (index > -1) {
        window.queuedImages.splice(index, 1);
      }
    });
    
    // Store image data in a global variable or add to message object
    if (!window.queuedImages) window.queuedImages = [];
    window.queuedImages.push({
      dataUrl: imageDataUrl,
      name: fileName
    });
  }
  
  function clearQueuedImages() {
    window.queuedImages = [];
    
    // Clear the image previews container
    dom.imagePreviewsContainer.innerHTML = '';
  }
  
  function getQueuedImages() {
    return window.queuedImages || [];
  }

  // ---- Utilities ----
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  // ---- Voice Recognition ----
  function initVoiceRecognition() {
    // Check for browser support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.warn('[AMS] Speech recognition not supported in this browser');
      if (dom.voiceBtn) dom.voiceBtn.style.display = 'none';
      if (dom.voiceLangBtn) dom.voiceLangBtn.style.display = 'none';
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = voiceLang;

    recognition.onstart = () => {
      isRecording = true;
      dom.voiceBtn.classList.add('recording');
      dom.voiceBtn.title = 'Stop recording';
    };

    recognition.onend = () => {
      isRecording = false;
      dom.voiceBtn.classList.remove('recording');
      dom.voiceBtn.title = `Voice input (${voiceLang === 'bn-BD' ? 'Bengali' : 'English'})`;
    };

    recognition.onerror = (event) => {
      console.warn('[AMS] Speech recognition error:', event.error);
      isRecording = false;
      dom.voiceBtn.classList.remove('recording');
      
      if (event.error === 'not-allowed') {
        alert('Microphone access denied. Please allow microphone access to use voice input.');
      }
    };

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      // Append final transcript to input
      if (finalTranscript) {
        const currentValue = dom.input.value;
        const needsSpace = currentValue && !currentValue.endsWith(' ') && !currentValue.endsWith('\n');
        dom.input.value = currentValue + (needsSpace ? ' ' : '') + finalTranscript;
        autoResize(dom.input);
      }
    };

    // Update initial button title
    if (dom.voiceBtn) {
      dom.voiceBtn.title = `Voice input (${voiceLang === 'bn-BD' ? 'Bengali' : 'English'})`;
    }
  }

  function toggleVoiceRecording() {
    if (!recognition) {
      alert('Voice recognition is not supported in your browser. Please use Chrome or Edge.');
      return;
    }

    if (isRecording) {
      recognition.stop();
    } else {
      recognition.lang = voiceLang;
      try {
        recognition.start();
      } catch (e) {
        // May already be running
        recognition.stop();
        setTimeout(() => recognition.start(), 100);
      }
    }
  }

  function toggleVoiceLanguage() {
    voiceLang = voiceLang === 'bn-BD' ? 'en-US' : 'bn-BD';
    
    // Update UI
    dom.voiceLangLabel.textContent = voiceLang === 'bn-BD' ? 'BN' : 'EN';
    dom.voiceLangBtn.classList.toggle('en', voiceLang === 'en-US');
    dom.voiceBtn.title = `Voice input (${voiceLang === 'bn-BD' ? 'Bengali' : 'English'})`;

    // Update recognition language if active
    if (recognition) {
      recognition.lang = voiceLang;
      // Restart if recording
      if (isRecording) {
        recognition.stop();
        setTimeout(() => recognition.start(), 100);
      }
    }
  }

  // Global copy function for code blocks
  window.__amsCopy = function (btn) {
    const pre = btn.closest('pre');
    const code = pre.querySelector('code');
    navigator.clipboard.writeText(code.textContent).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  };
  
  // Test function for leave page warning (for development only)
  window.testLeaveWarning = function() {
    // Simulate having messages to trigger the warning
    const testDiv = document.createElement('div');
    testDiv.className = 'msg-user'; // Use actual message class
    testDiv.innerHTML = '<div class="msg-bubble">Test message</div>';
    dom.messages.appendChild(testDiv);
    console.log('Test message added. Try refreshing or closing the tab to see the warning.');
    console.log('Current message count:', dom.messages.querySelectorAll('.msg-user, .msg-ai, .plan-card, .action-card, .status-indicator, .msg-error').length);
  };
  
  // Test function to simulate streaming
  window.testStreamingWarning = function() {
    isStreaming = true;
    console.log('Streaming simulation started. Try leaving the page to see the warning.');
  };

  // ---- Boot ----
  init();
})();


