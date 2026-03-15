/**
 * AMS AI Client - Handles communication with AI providers
 * Supports OpenAI-compatible APIs with streaming, tool calling, and API key rotation.
 */

class AIClient {
  constructor(config) {
    this.config = config;
    this.provider = config.providers.find(p => p.id === config.activeProvider);
    if (!this.provider) {
      throw new Error(`Provider not found: ${config.activeProvider}`);
    }
    // Track which key index to use; rotate on failures
    this.currentKeyIndex = 0;
  }

  /**
   * Send a chat completion request with automatic key rotation.
   * @param {Array} messages - Conversation messages
   * @param {Array} tools - Tool definitions
   * @param {Function} onToken - Callback for streaming tokens
   * @param {AbortSignal} signal - Abort signal for cancelling requests
   * @returns {Object} { content, toolCalls }
   */
  async chat(messages, tools, onToken, signal) {
    const keys = this.provider.apiKeys.filter(k => k && k.trim());
    if (keys.length === 0) {
      throw new Error('No API keys configured for this provider. Please add an API key in Settings.');
    }

    const maxRetries = keys.length;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (signal?.aborted) throw new Error('Aborted');
        return await this._makeRequest(messages, tools, onToken, signal);
      } catch (error) {
        if (error.name === 'AbortError' || error.message === 'Aborted') throw error;
        lastError = error;
        if (this._isRotatableError(error) && attempt < maxRetries - 1) {
          console.log(`[AMS] Key ${this.currentKeyIndex} failed (${error.message}), rotating...`);
          this.currentKeyIndex = (this.currentKeyIndex + 1) % keys.length;
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  async _makeRequest(messages, tools, onToken, signal) {
    const keys = this.provider.apiKeys.filter(k => k && k.trim());
    const apiKey = keys[this.currentKeyIndex % keys.length];
    const baseUrl = this.provider.baseUrl.replace(/\/+$/, '');
  
    // Process messages to handle image content
    const processedMessages = messages.map(msg => {
      if (msg.role === 'user' && msg.images && msg.images.length > 0) {
        // Convert to multimodal format if images are present
        const content = [];
          
        // Add text content if available
        if (msg.content) {
          content.push({
            type: 'text',
            text: msg.content
          });
        }
          
        // Add image content
        msg.images.forEach(image => {
          // Extract base64 data from data URL
          const base64Data = image.dataUrl.split(',')[1];
          const mimeType = image.dataUrl.split(';')[0].split(':')[1];
            
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Data}`
            }
          });
        });
          
        return {
          ...msg,
          content,
          images: undefined // Remove the images property
        };
      }
      return msg;
    });
  
    const body = {
      model: this.config.activeModel,
      messages: processedMessages,
      stream: true
    };
  
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
  
    // Add temperature if configured
    if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature;
    }
  
    const headers = {
      'Content-Type': 'application/json'
    };
  
    // Ollama local doesn't need auth; otherwise set Bearer token
    if (apiKey && apiKey !== 'ollama') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
  
    const url = `${baseUrl}/chat/completions`;
  
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      let errBody = '';
      try { errBody = await response.text(); } catch {}
      const errMsg = `API Error ${response.status}: ${errBody.slice(0, 300)}`;
      const err = new Error(errMsg);
      err.status = response.status;
      throw err;
    }

    // Check if the response is actually streaming (SSE) or a single JSON blob
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      // Non-streaming fallback
      return this._processJsonResponse(await response.json(), onToken);
    }

    return this._processStream(response, onToken);
  }

  _processJsonResponse(json, onToken) {
    const choice = json.choices?.[0];
    if (!choice) throw new Error('No response from model');

    const content = choice.message?.content || '';
    if (content && onToken) {
      onToken(content);
    }

    const toolCalls = choice.message?.tool_calls || null;
    return { content, toolCalls };
  }

  async _processStream(response, onToken) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCallsMap = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        // Text content
        if (delta.content) {
          content += delta.content;
          if (onToken) onToken(delta.content);
        }

        // Tool calls (accumulated across chunks)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (tc.id) {
              // New tool call
              toolCallsMap[idx] = {
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || ''
                }
              };
            } else if (toolCallsMap[idx]) {
              // Continue accumulating
              if (tc.function?.name) {
                toolCallsMap[idx].function.name += tc.function.name;
              }
              if (tc.function?.arguments) {
                toolCallsMap[idx].function.arguments += tc.function.arguments;
              }
            }
          }
        }
      }
    }

    const toolCalls = Object.values(toolCallsMap);
    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : null
    };
  }

  _isRotatableError(error) {
    const msg = (error.message || '').toLowerCase();
    const status = error.status;
    return (
      status === 401 ||
      status === 403 ||
      status === 429 ||
      msg.includes('quota') ||
      msg.includes('rate limit') ||
      msg.includes('exceeded') ||
      msg.includes('insufficient') ||
      msg.includes('invalid api key') ||
      msg.includes('unauthorized')
    );
  }
}

module.exports = { AIClient };
