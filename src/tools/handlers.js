import fs from 'node:fs';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';
import os from 'node:os';
import { isSubPath, isSensitivePath, analyzeCommand, classifyCommand } from './sandbox.js';
import { requestCommandApproval } from './approval.js';

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
  // Pisahkan juga pada CRLF: tanpa ini, tiap baris berkas Windows menyisakan
  // `\r` di ujungnya sehingga tampil sebagai karakter aneh di keluaran.
  const lines = content.split(/\r?\n/);
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
  const usesCRLF = fileText.includes('\r\n');

  // Selalu kirim pengganti lewat fungsi, bukan string: `String.replace` menafsirkan
  // `$&`, `$1`, `$'` di dalam string pengganti, sehingga potongan kode yang memuat
  // karakter itu akan berubah tanpa diminta.
  const applyReplace = (haystack, needle, replacement) =>
    haystack.replace(needle, () => replacement);

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

    const normalizedNew = new_content.replace(/\r\n/g, '\n');
    let updatedText = applyReplace(normalizedFileText, normalizedOld, normalizedNew);
    // Kembalikan akhir baris asli. Tanpa ini, berkas CRLF (khas Windows)
    // berubah seluruhnya menjadi LF dan muncul sebagai diff sepanjang berkas.
    if (usesCRLF) updatedText = updatedText.replace(/\n/g, '\r\n');
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

  // Selaraskan akhir baris pengganti dengan berkas agar tidak tercipta campuran.
  const replacement = usesCRLF
    ? new_content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
    : new_content.replace(/\r\n/g, '\n');
  const updatedText = applyReplace(fileText, old_content, replacement);
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
    '.baiwor',
    '.next',
    '.cache',
    'dist',
    'build',
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
 * Menghentikan proses beserta anak-cucunya.
 *
 * Di Windows `child.kill()` hanya membunuh shell (cmd.exe) dan meninggalkan
 * proses anak yang sudah dijalankan, jadi `taskkill /T /F` dipakai agar seluruh
 * pohon proses benar-benar berhenti.
 *
 * @param {import('node:child_process').ChildProcess|null} child
 */
function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  if (os.platform() === 'win32' && child.pid) {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        try {
          child.kill();
        } catch {
          // abaikan
        }
      });
      return;
    } catch {
      // jatuh ke child.kill() di bawah
    }
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // abaikan
  }
}

/**
 * Handler untuk menjalankan perintah terminal
 *
 * @param {{command:string, cwd?:string}} args
 * @param {{signal?:AbortSignal}} [options] - Signal pembatalan dari sesi chat.
 */
export async function handleRunCommand({ command, cwd }, options = {}) {
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

  // Penjaga sandbox perintah (A5) & Approval Gate (Tahap 5):
  // Mengklasifikasikan perintah menjadi: deny, confirm, atau allow.
  const classification = classifyCommand(command, { workspace: process.cwd() });

  if (classification.decision === 'deny') {
    return {
      success: false,
      output: `Ditolak oleh sandbox bAIwor [${classification.category}]: ${classification.reason}`,
    };
  }

  if (classification.decision === 'confirm') {
    const approval = await requestCommandApproval(command, classification.reason);
    if (!approval.approved) {
      return {
        success: false,
        output: approval.message || `Perintah '${command}' dibatalkan oleh pengguna (butuh konfirmasi).`,
      };
    }
  }

  return new Promise((resolve) => {
    const signal = options?.signal || null;
    const isWindows = os.platform() === 'win32';
    // Di Windows gunakan cmd.exe bawaan (mendukung pemisah chained && dan || standar)
    const shellOpt = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/bash';

    let settled = false;

    const onAbort = () => {
      terminateProcessTree(child);
      finish({
        success: false,
        output: `Perintah dibatalkan oleh pengguna sebelum selesai: ${command}`,
      });
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(value);
    };

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
        finish({
          success: false,
          output: msg.trim() || error.message,
        });
        return;
      }

      let resultText = '';
      if (out) resultText += out;
      if (err) resultText += (resultText ? '\n\nSTDERR:\n' : '') + err;

      finish({
        success: true,
        output: resultText || '(Perintah selesai tanpa output)',
      });
    });

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}
