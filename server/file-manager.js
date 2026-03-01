/**
 * AMS File Manager - Handles file system operations within the project directory
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

  runCommand(command) {
    try {
      const output = execSync(command, {
        cwd: this.projectDir,
        timeout: 60000,
        encoding: 'utf-8',
        maxBuffer: 2 * 1024 * 1024,
        shell: true
      });
      return { success: true, output: output.trim() };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        output: (err.stdout || '').trim(),
        stderr: (err.stderr || '').trim()
      };
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
