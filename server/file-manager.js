/**
 * AMS File Manager - Handles file system operations within the project directory
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

class FileManager {
  constructor(projectDir) {
    this.projectDir = path.resolve(projectDir);
  }

  /**
   * Resolve a relative path to an absolute path within the project directory.
   * Throws if the resolved path escapes the project directory.
   */
  _resolvePath(filePath) {
    const resolved = path.resolve(this.projectDir, filePath);
    if (!resolved.startsWith(this.projectDir)) {
      throw new Error('Access denied: path is outside the project directory');
    }
    return resolved;
  }

  createFile(filePath, content) {
    try {
      const fullPath = this._resolvePath(filePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, content, 'utf-8');
      return { success: true, path: filePath, message: `Created: ${filePath}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  readFile(filePath) {
    try {
      const fullPath = this._resolvePath(filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      const stat = fs.statSync(fullPath);
      if (stat.size > 512 * 1024) {
        return { success: false, error: `File too large (${(stat.size / 1024).toFixed(0)}KB). Max 512KB.` };
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      return { success: true, path: filePath, content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  modifyFile(filePath, content) {
    try {
      const fullPath = this._resolvePath(filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File not found: ${filePath}. Use create_file instead.` };
      }
      fs.writeFileSync(fullPath, content, 'utf-8');
      return { success: true, path: filePath, message: `Modified: ${filePath}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  searchReplace(filePath, oldStr, newStr) {
    try {
      const fullPath = this._resolvePath(filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }

      let content = fs.readFileSync(fullPath, 'utf-8');
      
      // Normalize line endings and trim trailing whitespace for comparison
      const normalize = (str) => str.replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd()).join('\n');
      
      const normalizedContent = normalize(content);
      const normalizedOldStr = normalize(oldStr);

      if (normalizedOldStr.trim() === '') {
        return { success: false, error: 'The text to search for (oldStr) cannot be empty.' };
      }

      // Check for uniqueness in normalized content
      const firstIndex = normalizedContent.indexOf(normalizedOldStr);
      if (firstIndex === -1) {
        return { 
          success: false, 
          error: `Could not find the exact text block in ${filePath}. \n\nTIP: Ensure you have copied the code exactly as it appears in the file, including indentation and comments.` 
        };
      }

      const lastIndex = normalizedContent.lastIndexOf(normalizedOldStr);
      if (firstIndex !== lastIndex) {
        return { 
          success: false, 
          error: `The text block you provided matches multiple locations in ${filePath}. Please provide more context (surrounding lines) to make it unique.` 
        };
      }

      // To perform the actual replacement while preserving the original whitespace/indentation 
      // of the parts we are NOT changing, we need to find the match in the original content.
      // Since we matched normalized strings, we can't easily use original content index.
      // Strategy: Split into lines and match line by line.
      
      const originalLines = content.replace(/\r\n/g, '\n').split('\n');
      const oldLines = normalizedOldStr.split('\n');
      
      let matchLineIndex = -1;
      for (let i = 0; i <= originalLines.length - oldLines.length; i++) {
        let match = true;
        for (let j = 0; j < oldLines.length; j++) {
          if (originalLines[i + j].trimEnd() !== oldLines[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          matchLineIndex = i;
          break;
        }
      }

      if (matchLineIndex === -1) {
        // This shouldn't happen if normalizedContent.indexOf worked, but just in case
        return { success: false, error: 'Internal matching error.' };
      }

      // Replace the lines
      originalLines.splice(matchLineIndex, oldLines.length, ...newStr.replace(/\r\n/g, '\n').split('\n'));
      const newContent = originalLines.join('\n');
      
      fs.writeFileSync(fullPath, newContent, 'utf-8');
      return { success: true, path: filePath, message: `Successfully updated ${oldLines.length} line(s) in ${filePath}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  deleteFile(filePath) {
    try {
      const fullPath = this._resolvePath(filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true });
      } else {
        fs.unlinkSync(fullPath);
      }
      return { success: true, path: filePath, message: `Deleted: ${filePath}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  moveFile(srcPath, destPath) {
    try {
      const fullSrc = this._resolvePath(srcPath);
      const fullDest = this._resolvePath(destPath);
      const destDir = path.dirname(fullDest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.renameSync(fullSrc, fullDest);
      return { success: true, from: srcPath, to: destPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  copyFile(srcPath, destPath) {
    try {
      const fullSrc = this._resolvePath(srcPath);
      const fullDest = this._resolvePath(destPath);
      const destDir = path.dirname(fullDest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(fullSrc, fullDest);
      return { success: true, from: srcPath, to: destPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  listFiles(dirPath = '.') {
    try {
      const fullPath = this._resolvePath(dirPath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `Directory not found: ${dirPath}` };
      }
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      const items = entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'ams.config.json')
        .map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          path: path.join(dirPath, e.name).replace(/\\/g, '/')
        }));
      return { success: true, path: dirPath, items };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  runCommand(command, onOutput) {
    return new Promise((resolve) => {
      try {
        const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
        const child = spawn(shell, [process.platform === 'win32' ? '-Command' : '-c', command], {
          cwd: this.projectDir,
          shell: true,
          env: { ...process.env, FORCE_COLOR: '1' }
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
          const str = data.toString();
          output += str;
          if (onOutput) onOutput(str);
        });

        child.stderr.on('data', (data) => {
          const str = data.toString();
          errorOutput += str;
          if (onOutput) onOutput(str);
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve({ success: true, output: output.trim() });
          } else {
            resolve({
              success: false,
              error: `Command failed with exit code ${code}`,
              output: output.trim(),
              stderr: errorOutput.trim()
            });
          }
        });

        child.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  }

  searchFiles(query) {
    try {
      // Basic grep implementation using Node.js for portability
      const results = [];
      const searchInDir = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(this.projectDir, fullPath).replace(/\\/g, '/');
          
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'package-lock.json') continue;
          
          if (entry.isDirectory()) {
            searchInDir(fullPath);
          } else {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, i) => {
              if (line.includes(query)) {
                results.push({
                  path: relPath,
                  line: i + 1,
                  content: line.trim()
                });
              }
            });
          }
        }
      };
      
      searchInDir(this.projectDir);
      return { success: true, query, results: results.slice(0, 50) }; // Limit to 50 results
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Build a recursive file tree for the sidebar.
   */
  getFileTree(dirPath, relativePath, depth) {
    dirPath = dirPath || this.projectDir;
    relativePath = relativePath || '.';
    depth = depth || 0;

    if (depth > 6) return [];

    const items = [];
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }

    // Sort: directories first, then files, both alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    const ignoreList = new Set([
      'node_modules', '.git', '.next', '.nuxt', '__pycache__',
      '.cache', 'dist', 'build', '.DS_Store', 'ams.config.json',
      '.env', '.env.local', 'coverage', '.turbo', '.vercel'
    ]);

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
      if (ignoreList.has(entry.name)) continue;

      const entryRelPath = path.join(relativePath, entry.name).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          path: entryRelPath,
          type: 'directory',
          children: this.getFileTree(
            path.join(dirPath, entry.name),
            entryRelPath,
            depth + 1
          )
        });
      } else {
        items.push({
          name: entry.name,
          path: entryRelPath,
          type: 'file'
        });
      }
    }

    return items;
  }
}

module.exports = { FileManager };
