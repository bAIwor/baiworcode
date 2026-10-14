import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import os from 'node:os';

/**
 * Menormalkan path berkas berdasarkan CWD aktif
 */
function resolveSafePath(filePath, baseDir = process.cwd()) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path tidak valid.');
  }
  return path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(baseDir, filePath);
}

/**
 * Handler untuk membaca berkas
 */
export async function handleReadFile({ file_path, offset = 1, limit = 200 }) {
  const resolved = resolveSafePath(file_path);

  if (!fs.existsSync(resolved)) {
    return {
      success: false,
      output: `Error: Berkas tidak ditemukan: ${file_path}`,
    };
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    return {
      success: false,
      output: `Error: Jalur tersebut bukan sebuah berkas: ${file_path}`,
    };
  }

  const content = fs.readFileSync(resolved, 'utf8');
  const lines = content.split('\n');
  const totalLines = lines.length;

  const startLine = Math.max(1, parseInt(offset, 10) || 1);
  const maxLimit = Math.max(1, parseInt(limit, 10) || 200);
  const endLine = Math.min(totalLines, startLine + maxLimit - 1);

  const slicedLines = lines.slice(startLine - 1, endLine);
  const numberedOutput = slicedLines
    .map((line, idx) => `${startLine + idx}: ${line}`)
    .join('\n');

  const footer =
    endLine < totalLines
      ? `\n\n[Menampilkan baris ${startLine}-${endLine} dari total ${totalLines} baris. Gunakan offset=${endLine + 1} untuk melanjutkan]`
      : '';

  return {
    success: true,
    output: numberedOutput + footer,
  };
}

/**
 * Handler untuk menulis berkas baru atau menimpa berkas
 */
export async function handleWriteFile({ file_path, content }) {
  const resolved = resolveSafePath(file_path);
  const dir = path.dirname(resolved);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(resolved, content || '', 'utf8');
  const linesCount = (content || '').split('\n').length;

  return {
    success: true,
    output: `Berhasil menulis berkas: ${file_path} (${linesCount} baris)`,
  };
}

/**
 * Handler untuk mengedit berkas (search and replace)
 */
export async function handleEditFile({ file_path, old_content, new_content }) {
  const resolved = resolveSafePath(file_path);

  if (!fs.existsSync(resolved)) {
    return {
      success: false,
      output: `Error: Berkas tidak ditemukan: ${file_path}`,
    };
  }

  const fileText = fs.readFileSync(resolved, 'utf8');

  // Cek kecocokan teks
  if (!fileText.includes(old_content)) {
    // Coba normalisasi newline CRLF vs LF jika tidak cocok
    const normalizedFileText = fileText.replace(/\r\n/g, '\n');
    const normalizedOld = old_content.replace(/\r\n/g, '\n');

    if (!normalizedFileText.includes(normalizedOld)) {
      return {
        success: false,
        output: `Error: old_content tidak ditemukan di dalam berkas ${file_path}. Pastikan teks yang ingin diganti persis sama.`,
      };
    }

    const occurrences = normalizedFileText.split(normalizedOld).length - 1;
    if (occurrences > 1) {
      return {
        success: false,
        output: `Error: old_content ditemukan ${occurrences} kali di dalam berkas. Berikan potongan kode yang lebih spesifik/unik.`,
      };
    }

    const updatedText = normalizedFileText.replace(normalizedOld, new_content.replace(/\r\n/g, '\n'));
    fs.writeFileSync(resolved, updatedText, 'utf8');

    return {
      success: true,
      output: `Berhasil mengedit berkas ${file_path}`,
    };
  }

  const occurrences = fileText.split(old_content).length - 1;
  if (occurrences > 1) {
    return {
      success: false,
      output: `Error: old_content ditemukan ${occurrences} kali di dalam berkas. Berikan potongan kode yang lebih spesifik/unik.`,
    };
  }

  const updatedText = fileText.replace(old_content, new_content);
  fs.writeFileSync(resolved, updatedText, 'utf8');

  return {
    success: true,
    output: `Berhasil mengedit berkas ${file_path}`,
  };
}

/**
 * Handler untuk melihat daftar isi direktori
 */
export async function handleListDirectory({ dir_path = '.', recursive = false, max_depth = 2 }) {
  const resolved = resolveSafePath(dir_path);

  if (!fs.existsSync(resolved)) {
    return {
      success: false,
      output: `Error: Direktori tidak ditemukan: ${dir_path}`,
    };
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return {
      success: false,
      output: `Error: Jalur tersebut bukan sebuah direktori: ${dir_path}`,
    };
  }

  const IGNORE_PATTERNS = new Set([
    'node_modules',
    '.git',
    '.next',
    '.cache',
    'dist',
    'build',
    '.openclaw',
    '.qwenwork',
    '.workbuddy-ai',
  ]);

  const results = [];

  function scan(currentDir, currentDepth) {
    if (currentDepth > max_depth) return;

    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORE_PATTERNS.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(resolved, fullPath);

      if (entry.isDirectory()) {
        results.push(`📁 ${relPath}/`);
        if (recursive && currentDepth < max_depth) {
          scan(fullPath, currentDepth + 1);
        }
      } else if (entry.isFile()) {
        try {
          const s = fs.statSync(fullPath);
          results.push(`📄 ${relPath} (${s.size} bytes)`);
        } catch {
          results.push(`📄 ${relPath}`);
        }
      }
    }
  }

  scan(resolved, 1);

  if (results.length === 0) {
    return {
      success: true,
      output: `Direktori kosong atau semua berkas diabaikan (ignore list): ${dir_path}`,
    };
  }

  return {
    success: true,
    output: results.join('\n'),
  };
}

/**
 * Handler untuk menjalankan perintah terminal
 */
export async function handleRunCommand({ command, cwd }) {
  if (!command || !command.trim()) {
    return {
      success: false,
      output: 'Error: Perintah tidak boleh kosong.',
    };
  }

  const executionCwd = cwd ? resolveSafePath(cwd) : process.cwd();

  return new Promise((resolve) => {
    const isWindows = os.platform() === 'win32';
    const shellOpt = isWindows ? 'powershell.exe' : '/bin/bash';

    const child = exec(command, {
      cwd: executionCwd,
      shell: shellOpt,
      timeout: 60000, // 60 detik
      maxBuffer: 10 * 1024 * 1024, // 10MB
    }, (error, stdout, stderr) => {
      const out = (stdout || '').trim();
      const err = (stderr || '').trim();

      if (error) {
        let msg = `Perintah selesai dengan error (Exit Code: ${error.code || 1})\n`;
        if (out) msg += `\nSTDOUT:\n${out}`;
        if (err) msg += `\nSTDERR:\n${err}`;
        resolve({
          success: false,
          output: msg.trim() || error.message,
        });
        return;
      }

      let resultText = '';
      if (out) resultText += out;
      if (err) resultText += (resultText ? '\n\nSTDERR:\n' : '') + err;

      resolve({
        success: true,
        output: resultText || '(Perintah selesai tanpa output)',
      });
    });
  });
}
