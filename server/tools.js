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
        name: 'move_file',
        description: 'Move or rename a file',
        parameters: {
          type: 'object',
          properties: {
            source: { type: 'string', description: 'Source path' },
            destination: { type: 'string', description: 'Destination path' }
          },
          required: ['source', 'destination']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'copy_file',
        description: 'Copy a file to a new location',
        parameters: {
          type: 'object',
          properties: {
            source: { type: 'string', description: 'Source path' },
            destination: { type: 'string', description: 'Destination path' }
          },
          required: ['source', 'destination']
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
        description: 'Run a shell command in the project directory (e.g., npm install, git init). Output will be streamed back in real-time.',
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
        name: 'search_files',
        description: 'Search for a string across all files in the project (like grep)',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The text to search for'
            }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for documentation, tutorials, package info, or any other information.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query'
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
        description: 'Fetch and read content from a URL.',
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
1. **Plan First**: ALWAYS start with create_plan.
2. **Execute Systematically**: Follow the plan.
3. **Verify**: Test and validate.

## Available Tools
- **create_plan**: Create a step-by-step plan
- **create_file**: Create/overwrite a file
- **read_file**: Read a file
- **modify_file**: Update a file
- **delete_file**: Delete a file
- **move_file**: Move/rename a file
- **copy_file**: Copy a file
- **list_files**: List files in a directory
- **run_command**: Run shell commands (streaming output)
- **search_files**: Search text across files (grep)
- **web_search**: Search the web
- **fetch_url**: Read web content

## Tool Usage Guidelines
- Use create_plan FIRST for every new task
- Use list_files to understand project structure
- Use read_file before modifying
- Use run_command for shell operations (npm install, etc.)
- Use search_files to find code patterns or usages
- Explain your thinking briefly before each action

## IMPORTANT: How to Call Tools
Use native function calling if supported, otherwise use:
<tool_call>
<name>tool_name</name>
<arguments>{"param1": "value1"}</arguments>
</tool_call>`;
}

function parseXmlToolCalls(text) {
  const toolCalls = [];
  const regex = /<tool_call>\s*<name>(.*?)<\/name>\s*<arguments>(.*?)<\/arguments>\s*<\/tool_call>/gs;
  let match;
  while ((match = regex.exec(text)) !== null) {
    toolCalls.push({
      id: 'call_' + Math.random().toString(36).substr(2, 9),
      type: 'function',
      function: {
        name: match[1].trim(),
        arguments: match[2].trim()
      }
    });
  }
  return toolCalls;
}

function stripXmlToolCalls(text) {
  return text.replace(/<tool_call>.*?<\/tool_call>/gs, '').trim();
}

module.exports = { getTools, getSystemPrompt, parseXmlToolCalls, stripXmlToolCalls };
