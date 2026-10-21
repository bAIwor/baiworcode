import fs from 'node:fs';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';
import os from 'node:os';
import crypto from 'node:crypto';
import chalk from 'chalk';
import { theme } from '../theme.js';
import {
  isSubPath,
  isSensitivePath,
  realpathOrResolved,
  realpathWithMissingTail,
  analyzeCommand,
  classifyCommand,
  parseDestructiveAllowlist,
  isDestructiveAllowed,
} from './sandbox.js';
import {
  requestCommandApproval,
  requestFileChangeApproval,
  hasFileApprovalHandler,
} from './approval.js';
import { getPermissionMode, getConfig } from '../config.js';
import { applyEdit, applyEditList, applyUnifiedDiff } from './editUtil.js';
import { recordFileBeforeChange } from './snapshot.js';
import { generateVisualDiff } from './diffView.js';

// Helper path tetap diekspor dari modul ini agar kontrak lama tidak berubah.
export { isSubPath, isSensitivePath };

// Daftar ignore bersama dengan searchTool (satu sumber kebenaran).
export const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.baiwor',
  '.next',
  '.nuxt',
  '.cache',
  '.parcel-cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  'AppData',
  'Application Data',
  'Local Settings',
  '$RECYCLE.BIN',
  'System Volume Information',
  '.npm',
  '.local',
  '.minimax',
  '.minimax-code',
  '.gradle',
  '.m2',
  '.cargo',
  '.rustup',
  '.docker',
]);

// Penyimpanan background tasks aktif di memori
const backgroundTasks = new Map();

/**
 * Mengambil record background task berdasarkan ID
 */
export function getBackgroundTask(taskId) {
  return backgroundTasks.get(taskId) || null;
}

/**
 * Mengambil daftar seluruh background tasks
 */
export function listBackgroundTasks() {
  return Array.from(backgroundTasks.values()).map((t) => ({
    id: t.id,
    command: t.command,
    status: t.status,
    exitCode: t.exitCode,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    outputLength: (t.output || '').length,
  }));
}

/**
 * Menghentikan background task secara paksa
 */
export function stopBackgroundTask(taskId) {
  const task = backgroundTasks.get(taskId);
  if (!task) return false;
  task.status = 'stopped';
  task.completedAt = Date.now();
  if (task.process) {
    try {
      terminateProcessTree(task.process);
    } catch {}
  }
  return true;
}

/**
 * Mengosongkan registry background tasks dan membunuh proses yang masih berjalan
 */
export function clearBackgroundTasks() {
  for (const task of backgroundTasks.values()) {
    if (task.status === 'running' && task.process) {
      terminateProcessTree(task.process);
    }
  }
  backgroundTasks.clear();
}

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

  // Validasi berbasis realpath: junction/symlink di dalam workspace tidak
  // boleh dipakai untuk membaca/menulis area di luar workspace atau area
  // sensitif. realpathWithMissingTail juga bekerja untuk berkas baru.
  const realResolved = realpathWithMissingTail(resolved);
  if (isSensitivePath(realResolved)) {
    throw new Error(`Akses ditolak: Jalur '${filePath}' mengarah ke area konfigurasi/kredensial sensitif melalui symlink.`);
  }

  const realBase = realpathOrResolved(normalizedBase);
  const realTmp = realpathOrResolved(os.tmpdir());
  const inWorkspace = isSubPath(realBase, realResolved);
  const inTmp = allowTmp && isSubPath(realTmp, realResolved);

  if (!inWorkspace && !inTmp) {
    throw new Error(`Akses ditolak: Jalur '${filePath}' berada di luar direktori workspace proyek (${normalizedBase})${realResolved !== resolved ? ' — target symlink berada di luar workspace' : ''}.`);
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

  const MAX_READ_BYTES = 5 * 1024 * 1024;
  if (stat.size > MAX_READ_BYTES) {
    return {
      success: false,
      output: `Error: Berkas terlalu besar untuk dibaca sekaligus (${(stat.size / (1024 * 1024)).toFixed(1)} MB, maksimum 5 MB). Minta pengguna membuka bagian tertentu atau gunakan search_files untuk menemukan bagian yang relevan.`,
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
export async function handleWriteFile({ file_path, content }, options = {}) {
  let resolved;
  try {
    resolved = resolveSafePath(file_path);
  } catch (err) {
    return {
      success: false,
      output: err.message,
    };
  }

  const oldText = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf8') : '';
  const diffResult = generateVisualDiff(oldText, content || '', { filePath: file_path });

  // Safe Mode Approval Gate:
  const tty = options?.tty ?? Boolean(process.stdin.isTTY);
  const asksFileApproval = getPermissionMode() === 'safe';
  if (asksFileApproval && (tty || hasFileApprovalHandler()) && !options?.skipApproval) {
    const approval = await requestFileChangeApproval({
      filePath: file_path,
      action: 'write',
      diff: diffResult.hasChanges ? diffResult.coloredDiff : '',
      diffStats: diffResult.hasChanges ? diffResult.diffStats : '',
    });
    if (!approval.approved) {
      return {
        success: false,
        output: approval.message || `Modifikasi berkas '${file_path}' dibatalkan oleh pengguna (Safe Mode).`,
        diff: diffResult.hasChanges ? diffResult.coloredDiff : undefined,
        diffStats: diffResult.hasChanges ? diffResult.diffStats : undefined,
      };
    }
  }

  recordFileBeforeChange(resolved);

  const dir = path.dirname(resolved);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(resolved, content || '', 'utf8');
  const normalized = (content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const linesCount = !normalized ? 0 : normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n').length : normalized.split('\n').length;

  return {
    success: true,
    output: `Berhasil menulis berkas: ${file_path} (${linesCount} baris)`,
    diff: diffResult.hasChanges ? diffResult.coloredDiff : undefined,
    diffStats: diffResult.hasChanges ? diffResult.diffStats : undefined,
  };
}

/**
 * Menerjemahkan alasan kegagalan edit menjadi pesan yang bisa ditindaklanjuti.
 */
function describeEditFailure(reason, filePath, count, lines = []) {
  if (reason === 'not-found') {
    return `Error: old_content tidak ditemukan di dalam berkas ${filePath} (sudah dicoba pencocokan persis maupun toleran spasi/indentasi). Pastikan potongan itu benar-benar ada.`;
  }
  if (reason === 'identical') {
    return `Error: new_content identik dengan old_content, tidak ada perubahan yang dilakukan pada ${filePath}.`;
  }
  if (reason === 'ambiguous') {
    const lineInfo = Array.isArray(lines) && lines.length ? ` (ditemukan pada baris ${lines.join(', ')})` : '';
    return `Error: old_content ditemukan ${count} kali di dalam berkas ${filePath}${lineInfo}. Persempit potongan kode dengan menyertakan baris konteks sebelum/sesudahnya agar unik, atau set "replace_all": true untuk mengganti semuanya.`;
  }
  if (reason === 'missing-old') {
    return 'Error: setiap item pada "edits" wajib memiliki old_content.';
  }
  return `Error: gagal mengedit berkas (${reason}).`;
}

/**
 * Handler untuk mengedit berkas (search and replace) — versi toleran.
 *
 * Mendukung:
 *   - `replace_all` : ganti SEMUA kemunculan, bukan hanya yang unik.
 *   - `edits`       : banyak edit sekaligus, diterapkan atomik (semua atau tidak sama sekali).
 *   - pencocokan    : persis → toleran indentasi/spasi ujung → toleran spasi dalam.
 *
 * @param {{file_path:string, old_content?:string, new_content?:string,
 *          replace_all?:boolean, edits?:Array}} args
 */
export async function handleEditFile({
  file_path,
  old_content,
  new_content,
  replace_all = false,
  edits = null,
}, options = {}) {
  let resolved;
  try {
    resolved = resolveSafePath(file_path);
  } catch (err) {
    return { success: false, output: err.message };
  }

  if (!fs.existsSync(resolved)) {
    return { success: false, output: `Error: Berkas tidak ditemukan: ${file_path}` };
  }
  if (!fs.statSync(resolved).isFile()) {
    return { success: false, output: `Error: Jalur tersebut bukan sebuah berkas: ${file_path}` };
  }

  const fileText = fs.readFileSync(resolved, 'utf8');

  // Mode multi-edit (atomik).
  if (Array.isArray(edits) && edits.length) {
    const res = applyEditList(fileText, edits);
    if (!res.ok) {
      return {
        success: false,
        output: `Error pada edit ke-${res.index + 1}: ${describeEditFailure(res.reason, file_path, res.count, res.lines)}`,
      };
    }

    const diffResult = generateVisualDiff(fileText, res.text, { filePath: file_path });

    // Safe Mode Approval Gate:
    const tty = options?.tty ?? Boolean(process.stdin.isTTY);
    const asksFileApproval = getPermissionMode() === 'safe';
    if (asksFileApproval && (tty || hasFileApprovalHandler()) && !options?.skipApproval) {
      const approval = await requestFileChangeApproval({
        filePath: file_path,
        action: 'edit',
        diff: diffResult.hasChanges ? diffResult.coloredDiff : '',
        diffStats: diffResult.hasChanges ? diffResult.diffStats : '',
      });
      if (!approval.approved) {
        return {
          success: false,
          output: approval.message || `Modifikasi berkas '${file_path}' dibatalkan oleh pengguna (Safe Mode).`,
          diff: diffResult.hasChanges ? diffResult.coloredDiff : undefined,
          diffStats: diffResult.hasChanges ? diffResult.diffStats : undefined,
        };
      }
    }

    recordFileBeforeChange(resolved);
    fs.writeFileSync(resolved, res.text, 'utf8');
    return {
      success: true,
      output: `Berhasil menerapkan ${edits.length} edit pada ${file_path} (${res.count} penggantian).`,
      diff: diffResult.hasChanges ? diffResult.coloredDiff : undefined,
      diffStats: diffResult.hasChanges ? diffResult.diffStats : undefined,
    };
  }

  if (typeof old_content !== 'string' || old_content === '') {
    return {
      success: false,
      output: 'Error: parameter "old_content" wajib diisi (atau gunakan "edits" untuk banyak perubahan).',
    };
  }

  const res = applyEdit(fileText, old_content, new_content ?? '', {
    replaceAll: Boolean(replace_all),
  });
  if (!res.ok) {
    return { success: false, output: describeEditFailure(res.reason, file_path, res.count, res.lines) };
  }

  const diffResult = generateVisualDiff(fileText, res.text, { filePath: file_path });

  // Safe Mode Approval Gate:
  const tty = options?.tty ?? Boolean(process.stdin.isTTY);
  const asksFileApproval = getPermissionMode() === 'safe';
  if (asksFileApproval && (tty || hasFileApprovalHandler()) && !options?.skipApproval) {
    const approval = await requestFileChangeApproval({
      filePath: file_path,
      action: 'edit',
      diff: diffResult.hasChanges ? diffResult.coloredDiff : '',
      diffStats: diffResult.hasChanges ? diffResult.diffStats : '',
    });
    if (!approval.approved) {
      return {
        success: false,
        output: approval.message || `Modifikasi berkas '${file_path}' dibatalkan oleh pengguna (Safe Mode).`,
        diff: diffResult.hasChanges ? diffResult.coloredDiff : undefined,
        diffStats: diffResult.hasChanges ? diffResult.diffStats : undefined,
      };
    }
  }

  recordFileBeforeChange(resolved);
  fs.writeFileSync(resolved, res.text, 'utf8');
  const countNote = res.count > 1 ? ` — ${res.count} kemunculan diganti` : '';
  const fuzzyNote = res.strategy === 'exact' ? '' : ' (dicocokkan toleran spasi/indentasi)';
  return {
    success: true,
    output: `Berhasil mengedit berkas ${file_path}${countNote}${fuzzyNote}.`,
    diff: diffResult.hasChanges ? diffResult.coloredDiff : undefined,
    diffStats: diffResult.hasChanges ? diffResult.diffStats : undefined,
  };
}

/**
 * Handler untuk menerapkan unified diff ke sebuah berkas (tool `patch_file`).
 * Blok konteks dicari ulang di berkas, sehingga patch tetap berlaku walau nomor
 * baris bergeser.
 *
 * @param {{file_path:string, patch:string}} args
 */
export async function handlePatchFile({ file_path, patch }, options = {}) {
  let resolved;
  try {
    resolved = resolveSafePath(file_path);
  } catch (err) {
    return { success: false, output: err.message };
  }

  if (!fs.existsSync(resolved)) {
    return { success: false, output: `Error: Berkas tidak ditemukan: ${file_path}` };
  }
  if (!fs.statSync(resolved).isFile()) {
    return { success: false, output: `Error: Jalur tersebut bukan sebuah berkas: ${file_path}` };
  }
  if (typeof patch !== 'string' || !patch.trim()) {
    return { success: false, output: 'Error: parameter "patch" wajib diisi (unified diff).' };
  }

  const fileText = fs.readFileSync(resolved, 'utf8');
  const res = applyUnifiedDiff(fileText, patch);
  if (!res.ok) {
    const map = {
      'no-hunks': 'tidak ada hunk yang dikenali — pastikan format unified diff (baris "@@ ... @@").',
      'insert-only-hunk': 'hunk tanpa baris konteks/tanda "-" belum didukung; sertakan minimal satu baris konteks.',
      'hunk-not-found': 'blok konteks salah satu hunk tidak ditemukan (isi berkas mungkin sudah berbeda).',
    };
    return {
      success: false,
      output: `Error: gagal menerapkan patch ke ${file_path}: ${map[res.reason] || res.reason}`,
    };
  }

  const diffResult = generateVisualDiff(fileText, res.text, { filePath: file_path });

  // Safe Mode Approval Gate:
  const tty = options?.tty ?? Boolean(process.stdin.isTTY);
  const asksFileApproval = getPermissionMode() === 'safe';
  if (asksFileApproval && (tty || hasFileApprovalHandler()) && !options?.skipApproval) {
    const approval = await requestFileChangeApproval({
      filePath: file_path,
      action: 'patch',
      diff: diffResult.hasChanges ? diffResult.coloredDiff : '',
      diffStats: diffResult.hasChanges ? diffResult.diffStats : '',
    });
    if (!approval.approved) {
      return {
        success: false,
        output: approval.message || `Modifikasi berkas '${file_path}' dibatalkan oleh pengguna (Safe Mode).`,
        diff: diffResult.hasChanges ? diffResult.coloredDiff : undefined,
        diffStats: diffResult.hasChanges ? diffResult.diffStats : undefined,
      };
    }
  }

  recordFileBeforeChange(resolved);
  fs.writeFileSync(resolved, res.text, 'utf8');
  return {
    success: true,
    output: `Berhasil menerapkan patch (${res.applied} hunk) pada ${file_path}.`,
    diff: diffResult.hasChanges ? diffResult.coloredDiff : undefined,
    diffStats: diffResult.hasChanges ? diffResult.diffStats : undefined,
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

    const IGNORE_PATTERNS = IGNORE_DIRS;

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
 * Batas waktu bawaan perintah foreground (ms). Bisa ditimpa lewat env
 * `BAIWOR_RUN_COMMAND_TIMEOUT_MS`, atau per pemanggilan lewat argumen
 * `timeout_ms` dari model (mis. untuk `mcode exec`, `npm install`, atau build).
 *
 * @param {number|string|null} [timeoutMs] - Permintaan eksplisit dari pemanggil.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number} Nilai final dalam ms, dijepit ke rentang [1s, 10m].
 */
export function resolveCommandTimeout(timeoutMs = null, env = process.env) {
  const MIN_MS = 1000;
  const MAX_MS = 600000; // 10 menit
  const DEFAULT_MS = 60000;

  let base = DEFAULT_MS;
  const rawDefault = env?.BAIWOR_RUN_COMMAND_TIMEOUT_MS;
  if (rawDefault !== undefined && rawDefault !== null && String(rawDefault).trim() !== '') {
    const parsed = Number.parseInt(String(rawDefault).trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) base = parsed;
  }

  let value = base;
  const requested = Number(timeoutMs);
  if (Number.isFinite(requested) && requested > 0) value = requested;

  return Math.min(MAX_MS, Math.max(MIN_MS, Math.floor(value)));
}

/**
 * Handler untuk menjalankan perintah terminal.
 * Mendukung eksekusi foreground (standar) maupun background task runner (asinkron).
 *
 * @param {{command?:string, cwd?:string, run_in_background?:boolean, is_background?:boolean, action?:string, task_id?:string, timeout_ms?:number}} args
 * @param {{signal?:AbortSignal}} [options] - Signal pembatalan dari sesi chat.
 */
export async function handleRunCommand({
  command,
  cwd,
  run_in_background = false,
  is_background = false,
  action = 'run',
  task_id = null,
  timeout_ms = null,
} = {}, options = {}) {
  // 1. Aksi stop / batalkan task latar belakang
  if (action === 'stop') {
    if (!task_id) {
      return { success: false, output: 'Error: parameter "task_id" wajib diisi untuk menghentikan task.' };
    }
    const task = backgroundTasks.get(task_id);
    if (!task) {
      return { success: false, output: `Error: Task dengan id "${task_id}" tidak ditemukan.` };
    }
    stopBackgroundTask(task_id);
    return {
      success: true,
      task_id,
      status: 'stopped',
      output: `Task ${task_id} (${task.command}) berhasil dihentikan.`,
    };
  }

  // 2. Aksi status / query task latar belakang
  if (action === 'status' || (!command && task_id)) {
    const targetId = task_id;
    if (!targetId) {
      return { success: false, output: 'Error: parameter "task_id" wajib diisi untuk memeriksa status task.' };
    }
    const task = backgroundTasks.get(targetId);
    if (!task) {
      return { success: false, output: `Error: Task dengan id "${targetId}" tidak ditemukan.` };
    }
    const elapsed = Math.round(((task.completedAt || Date.now()) - task.startedAt) / 1000);
    return {
      success: true,
      task_id: targetId,
      status: task.status,
      exitCode: task.exitCode,
      output: `[Task ${targetId}] Status: ${task.status} (${elapsed}s, exit code: ${task.exitCode ?? 'running'})\nPerintah: ${task.command}\n\nOUTPUT:\n${task.output || '(belum ada output)'}`.trim(),
    };
  }

  // 3. Aksi list background tasks
  if (action === 'list') {
    const list = listBackgroundTasks();
    if (!list.length) {
      return { success: true, output: 'Tidak ada background task yang sedang berjalan atau tersimpan.' };
    }
    const lines = list.map((t) => `• [${t.id}] (${t.status}) ${t.command}`);
    return { success: true, output: `Daftar Background Task (${list.length}):\n${lines.join('\n')}` };
  }

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
  const classification = classifyCommand(command, { workspace: executionCwd });

  if (classification.decision === 'deny') {
    // Override destruktif SADAR (default: TERTUTUP). Hanya kelas
    // 'dangerous-command' yang bisa dibuka, dan hanya untuk id aturan yang
    // disebut eksplisit oleh operator — via env BAIWOR_ALLOW_DESTRUCTIVE atau
    // field config `destructiveAllow`. Kelas deny lain (kredensial,
    // workspace-escape) tetap ditolak mutlak.
    const allowlist = parseDestructiveAllowlist(
      process.env.BAIWOR_ALLOW_DESTRUCTIVE,
      getConfig().destructiveAllow
    );
    if (!isDestructiveAllowed(classification, allowlist)) {
      return {
        success: false,
        output: `Ditolak oleh sandbox bAIwor [${classification.category}]: ${classification.reason}`,
      };
    }
  console.log(
    theme.warning.bold(
      `  ⚠️  Override destruktif aktif [${classification.ruleId}]: ${classification.reason}`
    )
  );
  }

  if (classification.decision === 'confirm') {
    // Mode YOLO di TTY: kelas confirm dilewati tanpa bertanya (HITL).
    // Kelas deny TETAP ditolak — YOLO tidak pernah membuka pintu bom.
    // `options.tty` dipakai sebagai injeksi dalam pengujian; default ke stdin.
    const tty = options?.tty ?? Boolean(process.stdin.isTTY);
    const yoloTty = getPermissionMode() === 'yolo' && Boolean(tty);
    if (!yoloTty) {
      const approval = await requestCommandApproval(command, classification.reason);
      if (!approval.approved) {
        return {
          success: false,
          output: approval.message || `Perintah '${command}' dibatalkan oleh pengguna (butuh konfirmasi).`,
        };
      }
    }
  }

  // Eksekusi di latar belakang jika diminta
  const shouldBackground = Boolean(run_in_background || is_background);
  if (shouldBackground) {
    // Batasi jumlah task agar memori tidak tumbuh tanpa batas. Task yang sudah
    // selesai dibersihkan lebih dulu; bila semuanya masih berjalan, tolak task baru.
    if (backgroundTasks.size >= 50) {
      for (const [id, task] of backgroundTasks) {
        if (task.status !== 'running') backgroundTasks.delete(id);
      }
      if (backgroundTasks.size >= 50) {
        return {
          success: false,
          output: 'Error: terlalu banyak background task aktif (maksimum 50). Hentikan task lama terlebih dahulu.',
        };
      }
    }

    const taskId = `task_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const isWindows = os.platform() === 'win32';
    const shellOpt = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/bash';

    const child = spawn(command, {
      cwd: executionCwd,
      shell: shellOpt,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const taskRecord = {
      id: taskId,
      command,
      cwd: executionCwd,
      process: child,
      status: 'running',
      exitCode: null,
      startedAt: Date.now(),
      completedAt: null,
      output: '',
    };

    backgroundTasks.set(taskId, taskRecord);

    const appendOut = (chunk) => {
      taskRecord.output += chunk.toString();
      if (taskRecord.output.length > 5 * 1024 * 1024) {
        taskRecord.output = taskRecord.output.slice(-4 * 1024 * 1024);
      }
    };

    if (child.stdout) child.stdout.on('data', appendOut);
    if (child.stderr) child.stderr.on('data', appendOut);

    child.on('close', (code) => {
      if (taskRecord.status === 'stopped') return;
      taskRecord.status = code === 0 ? 'completed' : 'failed';
      taskRecord.exitCode = code;
      taskRecord.completedAt = Date.now();
    });

    child.on('error', (err) => {
      if (taskRecord.status === 'stopped') return;
      taskRecord.status = 'failed';
      taskRecord.exitCode = 1;
      taskRecord.output += `\nError: ${err.message}`;
      taskRecord.completedAt = Date.now();
    });

    return {
      success: true,
      task_id: taskId,
      status: 'running',
      output: `Perintah dijalankan di latar belakang (task_id: ${taskId}).\nGunakan run_command dengan action="status" dan task_id="${taskId}" untuk memeriksa output.`,
    };
  }

  return new Promise((resolve) => {
    const signal = options?.signal || null;
    const isWindows = os.platform() === 'win32';
    // Di Windows gunakan cmd.exe bawaan (mendukung pemisah chained && dan || standar)
    const shellOpt = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/bash';

    let settled = false;
    let killTimer = null;

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
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(value);
    };

    const child = exec(command, {
      cwd: executionCwd,
      shell: shellOpt,
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

    // Batas waktu dikelola sendiri, bukan lewat opsi `timeout` milik exec().
    // Bawaan Node hanya membunuh shell langsung (cmd.exe) dan meninggalkan
    // proses cucu (npm install di tengah npm test, dsb. tetap hidup).
    // terminateProcessTree() memastikan seluruh pohon proses berhenti.
    // Nilainya bisa dikonfigurasi (env / argumen `timeout_ms`) karena sebagian
    // perintah sah-sah saja berjalan lama.
    const timeoutMs = resolveCommandTimeout(timeout_ms);
    const timeoutSec = Math.round(timeoutMs / 1000);
    killTimer = setTimeout(() => {
      terminateProcessTree(child);
      finish({
        success: false,
        output:
          `Perintah dihentikan karena melebihi batas waktu ${timeoutSec} detik: ${command}` +
          ' Jika perintah ini memang lama, ulangi dengan argumen timeout_ms yang lebih besar (maksimum 600000 ms = 10 menit).',
      });
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}
