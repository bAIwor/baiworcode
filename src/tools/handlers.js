import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import os from 'node:os';
import { isSubPath, isSensitivePath, analyzeCommand } from './sandbox.js';

// Helper path tetap diekspor dari modul ini agar kontrak lama tidak berubah.
export { isSubPath, isSensitivePath };

/**
 * Menormalkan path berkas berdasarkan CWD aktif dengan perlindungan Sandbox (F1)
 */
export function resolveSafePath(filePath, baseDir = process.cwd(), allowTmp = true) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path tidak valid.');
  }

  const normalizedBase = path.resolve(baseDir);
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(normalizedBase, filePath);

  if (isSensitivePath(resolved)) {
    throw new Error(`Akses ditolak: Jalur '${filePath}' merupakan area konfigurasi/kredensial sensitif yang dilindungi oleh bAIwor.`);
  }

  const inWorkspace = isSubPath(normalizedBase, resolved);
  const inTmp = allowTmp && isSubPath(os.tmpdir(), resolved);

  if (!inWorkspace && !inTmp) {
    throw new Error(`Akses ditolak: Jalur '${filePath}' berada di luar direktori workspace proyek (${normalizedBase}).`);
  }

  return resolved;
}

/**
 * Handler untuk membaca berkas
 */
export async function handleReadFile({ file_path, offset = 1, limit = 200 }) {
  let resolved;
  try {
    resolved = resolveSafePath(file_path);
  } catch (err) {
    return {
      success: false,
      output: err.message,
    };
  }

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
  let resolved;
  try {
    resolved = resolveSafePath(file_path);
  } catch (err) {
    return {
      success: false,
      output: err.message,
    };
  }

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
  let resolved;
  try {
    resolved = resolveSafePath(file_path);
  } catch (err) {
    return {
      success: false,
      output: err.message,
    };
  }

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
  let resolved;
  try {
    resolved = resolveSafePath(dir_path);
  } catch (err) {
    return {
      success: false,
      output: err.message,
    };
  }

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

  let executionCwd = process.cwd();
  if (cwd) {
    try {
      executionCwd = resolveSafePath(cwd);
    } catch (err) {
      return {
        success: false,
        output: err.message,
      };
    }
  }

  // Penjaga sandbox perintah (temuan audit A5): mengunci `cwd` saja tidak cukup —
  // isi perintah masih bisa menunjuk path absolut di luar workspace atau
  // memuat `cd ..` untuk keluar. Periksa string perintah sebelum eksekusi.
  const verdict = analyzeCommand(command, { workspace: process.cwd() });
  if (!verdict.allowed) {
    return {
      success: false,
      output: `Ditolak oleh sandbox bAIwor [${verdict.category}]: ${verdict.reason}`,
    };
  }

  return new Promise((resolve) => {
    const isWindows = os.platform() === 'win32';
    // Di Windows gunakan cmd.exe bawaan (mendukung pemisah chained && dan || standar)
    const shellOpt = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/bash';

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
