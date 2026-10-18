/**
 * Modul Pengelolaan Workspace (Ruang Kerja) bAIwor Code.
 *
 * Mengatur resolusi path direktori kerja aktif, validasi target folder,
 * perpindahan workspace saat sesi interaktif berjalan (/cd, /workspace),
 * serta ekstraksi argumen folder dari CLI (`bcode <folder> [prompt]`, `bcode -C <dir>`).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isHomeDirectory } from './tools/searchTool.js';
import { listSessions } from './chat/sessionManager.js';

/**
 * Memvalidasi dan menormalisasi apakah `targetPath` adalah direktori yang sah di disk.
 * Mendukung ekspansi tilde (`~`) ke direktori home pengguna.
 *
 * @param {string} targetPath - Path direktori yang dituju.
 * @param {string} [baseDir=process.cwd()] - Direktori basis jika targetPath berbentuk relatif.
 * @returns {{ ok: boolean, path?: string, error?: string }}
 */
export function resolveWorkspace(targetPath, baseDir = process.cwd()) {
  if (!targetPath || typeof targetPath !== 'string' || !targetPath.trim()) {
    return { ok: false, error: 'Path direktori tidak boleh kosong.' };
  }
  let clean = targetPath.trim();

  // Dukungan ekspansi tilde (~ atau ~/...)
  if (clean === '~') {
    clean = os.homedir();
  } else if (clean.startsWith('~' + path.sep) || clean.startsWith('~/')) {
    clean = path.join(os.homedir(), clean.slice(2));
  }

  const resolved = path.isAbsolute(clean)
    ? path.resolve(clean)
    : path.resolve(baseDir, clean);

  try {
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: `Direktori tidak ditemukan: "${clean}"` };
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return { ok: false, error: `Path bukan sebuah direktori: "${clean}"` };
    }
    return { ok: true, path: resolved };
  } catch (err) {
    return { ok: false, error: `Gagal mengakses direktori: ${err.message}` };
  }
}

/**
 * Berpindah ke direktori workspace baru menggunakan `process.chdir`.
 *
 * @param {string} targetPath - Path target yang dituju.
 * @param {string} [baseDir=process.cwd()] - Direktori basis awal.
 * @returns {{ ok: boolean, oldCwd: string, newCwd?: string, error?: string }}
 */
export function switchWorkspace(targetPath, baseDir = process.cwd()) {
  const check = resolveWorkspace(targetPath, baseDir);
  if (!check.ok) {
    return { ok: false, oldCwd: process.cwd(), error: check.error };
  }
  const oldCwd = process.cwd();
  try {
    process.chdir(check.path);
    return { ok: true, oldCwd, newCwd: check.path };
  } catch (err) {
    return { ok: false, oldCwd, error: `Gagal berpindah direktori: ${err.message}` };
  }
}

/**
 * Memisahkan argumen CLI menjadi target direktori dan prompt instruksi teks.
 *
 * Mendukung pola pemanggilan:
 *   1. Opsi eksplisit: `options.cwd` atau `options.dir`
 *      Contoh: `bcode -C ./proyek "cek kode"` -> targetDir: './proyek', prompt: 'cek kode'
 *   2. Argumen posisi pertama adalah direktori yang valid di disk:
 *      Contoh: `bcode ./proyek` -> targetDir: './proyek', prompt: ''
 *      Contoh: `bcode ./proyek "cek kode"` -> targetDir: './proyek', prompt: 'cek kode'
 *   3. Argumen posisi biasa (bukan direktori):
 *      Contoh: `bcode "buatkan fungsi auth"` -> targetDir: null, prompt: 'buatkan fungsi auth'
 *
 * @param {string[]} promptParts - Array argumen posisi dari commander.
 * @param {object} [options={}] - Opsi yang diparse commander (options.cwd, options.dir).
 * @param {string} [baseDir=process.cwd()] - Basis pencarian direktori relatif.
 * @returns {{ targetDir: string|null, prompt: string }}
 */
export function extractTargetAndPrompt(promptParts = [], options = {}, baseDir = process.cwd()) {
  const parts = Array.isArray(promptParts) ? [...promptParts] : [];
  const explicitDir = options?.cwd || options?.dir || null;

  if (explicitDir) {
    return {
      targetDir: String(explicitDir).trim(),
      prompt: parts.join(' ').trim(),
    };
  }

  if (parts.length > 0) {
    const candidate = parts[0];
    const check = resolveWorkspace(candidate, baseDir);
    if (check.ok) {
      return {
        targetDir: candidate,
        prompt: parts.slice(1).join(' ').trim(),
      };
    }
  }

  return {
    targetDir: null,
    prompt: parts.join(' ').trim(),
  };
}

/**
 * Mengambil ringkasan status workspace aktif saat ini.
 *
 * @param {string} [dir=process.cwd()]
 * @returns {{ cwd: string, isHome: boolean, sessionCount: number }}
 */
export function getWorkspaceInfo(dir = process.cwd()) {
  const resolved = path.resolve(dir);
  const isHome = isHomeDirectory(resolved);
  let sessionCount = 0;
  try {
    const list = listSessions({ projectPath: resolved });
    sessionCount = Array.isArray(list) ? list.length : 0;
  } catch {}

  return {
    cwd: resolved,
    isHome,
    sessionCount,
  };
}
