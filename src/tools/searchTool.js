/**
 * Tool `search_files` untuk bAIwor Code.
 *
 * Diadaptasi dari pola `file_operations_search.py` milik Hermes Agent, tapi
 * diimplementasikan murni dengan modul bawaan Node (tanpa ripgrep / dependensi baru)
 * supaya `npm install` tetap ringan untuk pengguna pemula.
 *
 * Dua mode:
 *   - target='content' : cari pola regex di dalam isi berkas (dengan nomor baris)
 *   - target='files'   : cari nama berkas berdasarkan pola glob
 *
 * Semua akses tetap melewati sandbox `resolveSafePath`, sehingga pencarian
 * tidak bisa dipakai untuk membaca berkas di luar workspace.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveSafePath } from './handlers.js';

/** Direktori yang tidak pernah ditelusuri. */
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.cache',
  '.parcel-cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.workbuddy-ai',
  '.baiwor',
  '.venv',
  'venv',
  '__pycache__',
]);

/** Ekstensi yang hampir pasti biner — dilewati agar tidak menghasilkan sampah. */
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.avif', '.svg',
  '.pdf', '.zip', '.gz', '.tar', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib',
  '.bin', '.dat', '.db', '.sqlite', '.sqlite3', '.mp3', '.mp4', '.mov', '.avi',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.class', '.jar', '.wasm',
]);

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB per berkas
const MAX_MATCHES = 200;
const MAX_FILES_SCANNED = 5000;
const MAX_LINE_CHARS = 300;

/**
 * Mengubah pola glob sederhana menjadi RegExp.
 * Mendukung `*` (satu segmen), `?` (satu karakter), dan `**` (lintas segmen).
 */
export function globToRegExp(glob) {
  const escaped = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped
    .replace(/\*\*\//g, '\u0000')   // penanda sementara untuk `**/`
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/\?/g, '[^/\\\\]')
    .replace(/\u0000/g, '(?:.*[/\\\\])?')
    .replace(/\u0001/g, '.*');
  return new RegExp(`^${body}$`, 'i');
}

/** Membaca berkas sebagai teks; mengembalikan null bila biner atau terlalu besar. */
function readTextFile(fullPath) {
  const ext = path.extname(fullPath).toLowerCase();
  if (BINARY_EXT.has(ext)) return null;

  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;

  let buf;
  try {
    buf = fs.readFileSync(fullPath);
  } catch {
    return null;
  }

  // Deteksi biner lewat byte NUL pada 8 KB pertama.
  const probe = buf.subarray(0, 8192);
  if (probe.includes(0)) return null;

  return buf.toString('utf8');
}

/**
 * Menelusuri direktori secara rekursif dan memanggil `visit(fullPath)` per berkas.
 * Berhenti lebih awal bila `shouldStop()` mengembalikan true.
 */
function walk(rootDir, visit, shouldStop) {
  let scanned = 0;
  const stack = [rootDir];

  while (stack.length > 0) {
    if (shouldStop && shouldStop()) return;
    const current = stack.pop();

    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (shouldStop && shouldStop()) return;

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        stack.push(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;

      scanned += 1;
      if (scanned > MAX_FILES_SCANNED) return;
      visit(path.join(current, entry.name));
    }
  }
}

function toRelative(target, baseDir) {
  const rel = path.relative(baseDir, target);
  return (rel || path.basename(target)).split(path.sep).join('/');
}

/**
 * Handler tool `search_files`.
 *
 * @param {Object} args
 * @param {string} args.pattern - Regex (mode content) atau glob (mode files).
 * @param {'content'|'files'} [args.target='content']
 * @param {string} [args.path='.'] - Direktori atau berkas awal pencarian.
 * @param {string} [args.file_glob] - Filter nama berkas (mis. '*.js').
 * @returns {Promise<{success: boolean, output: string}>}
 */
export async function handleSearchFiles({
  pattern,
  target = 'content',
  path: searchPath = '.',
  file_glob: fileGlob,
} = {}) {
  if (!pattern || typeof pattern !== 'string') {
    return { success: false, output: 'Error: parameter "pattern" wajib diisi.' };
  }

  const mode = target === 'files' ? 'files' : 'content';

  let root;
  try {
    root = resolveSafePath(searchPath || '.');
  } catch (err) {
    return { success: false, output: err.message };
  }

  if (!fs.existsSync(root)) {
    return { success: false, output: `Error: Lokasi tidak ditemukan: ${searchPath}` };
  }

  const baseDir = process.cwd();
  const globRe = fileGlob ? globToRegExp(fileGlob) : null;

  // ---------- Mode: cari nama berkas ----------
  if (mode === 'files') {
    const nameRe = globToRegExp(pattern);
    const matches = [];

    const collect = (fullPath) => {
      const name = path.basename(fullPath);
      if (globRe && !globRe.test(name)) return;
      if (nameRe.test(name)) matches.push(toRelative(fullPath, baseDir));
    };

    if (fs.statSync(root).isFile()) {
      collect(root);
    } else {
      walk(root, collect, () => matches.length >= MAX_MATCHES);
    }

    if (matches.length === 0) {
      return { success: true, output: `Tidak ada berkas yang cocok dengan pola '${pattern}'.` };
    }

    const shown = matches.slice(0, MAX_MATCHES);
    const footer =
      matches.length > shown.length
        ? `\n\n… [Menampilkan ${shown.length} dari ${matches.length} berkas yang cocok]`
        : '';
    return { success: true, output: `${shown.join('\n')}${footer}` };
  }

  // ---------- Mode: cari isi berkas ----------
  let contentRe;
  try {
    contentRe = new RegExp(pattern);
  } catch (err) {
    return { success: false, output: `Error: pola regex tidak valid (${err.message}).` };
  }

  const results = [];
  let filesSearched = 0;
  let hitLimit = false;

  const scanFile = (fullPath) => {
    const name = path.basename(fullPath);
    if (globRe && !globRe.test(name)) return;

    const text = readTextFile(fullPath);
    if (text === null) return;
    filesSearched += 1;

    const relPath = toRelative(fullPath, baseDir);
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      if (contentRe.test(lines[i])) {
        let snippet = lines[i].trim();
        if (snippet.length > MAX_LINE_CHARS) {
          snippet = snippet.slice(0, MAX_LINE_CHARS) + '…';
        }
        results.push(`${relPath}:${i + 1}: ${snippet}`);
        if (results.length >= MAX_MATCHES) {
          hitLimit = true;
          return;
        }
      }
    }
  };

  if (fs.statSync(root).isFile()) {
    scanFile(root);
  } else {
    walk(root, scanFile, () => hitLimit);
  }

  if (results.length === 0) {
    return {
      success: true,
      output: `Tidak ada kecocokan untuk '${pattern}' (${filesSearched} berkas dipindai di ${toRelative(root, baseDir) || '.'}).`,
    };
  }

  const footer = hitLimit
    ? `\n\n… [Dibatasi pada ${MAX_MATCHES} kecocokan pertama. Persempit pola atau path untuk hasil lebih spesifik]`
    : `\n\n[${results.length} kecocokan dari ${filesSearched} berkas]`;

  return { success: true, output: `${results.join('\n')}${footer}` };
}
