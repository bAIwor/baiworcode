/**
 * Tool `search_files` untuk bAIwor Code.
 *
 * Diadaptasi dari pola pencarian berkas pada agen CLI modern, tapi
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
import os from 'node:os';
import path from 'node:path';
import { resolveSafePath, IGNORE_DIRS } from './handlers.js';
import { isSensitivePath } from './sandbox.js';

// IGNORE_DIRS diimpor dari ./handlers.js (satu sumber kebenaran).

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
const MAX_PATTERN_CHARS = 500;

/**
 * Mendeteksi pola regex yang berpotensi memicu *catastrophic backtracking*
 * (ReDoS). JavaScript tidak menyediakan timeout untuk `RegExp`, jadi pola yang
 * jelas berbahaya ditolak lebih awal dengan pesan yang bisa ditindaklanjuti.
 *
 * Yang diperiksa: panjang pola dan penumpukan quantifier pada grup
 * (`(a+)+`, `(.*)*`, `(\d+\s?)+`) — bentuk paling umum penyebab proses
 * menggantung.
 *
 * @param {string} pattern
 * @returns {string|null} alasan penolakan, atau null bila pola wajar.
 */
export function detectRiskyRegex(pattern) {
  const p = String(pattern ?? '');
  if (p.length > MAX_PATTERN_CHARS) {
    return `pola terlalu panjang (maksimum ${MAX_PATTERN_CHARS} karakter)`;
  }
  // Grup yang memuat quantifier lalu diulang lagi: (a+)+, (.*)*, (\w*\s?)+.
  if (/\([^()]*[+*][^()]*\)\s*[+*{]/.test(p)) {
    return 'quantifier bersarang yang bisa memicu backtracking ekstrem';
  }
  // Grup bertingkat yang diulang: ((a+))+, ((a|b)*)+.
  if (/\(\([^()]*[+*][^()]*\)\)\s*[+*{]/.test(p)) {
    return 'grup bersarang yang diulang (quantifier bertumpuk)';
  }
  // Rangkaian .* beruntun seperti .*.* yang bisa meledak pada baris panjang.
  if (/(\.\*){2,}/.test(p)) {
    return 'rangkaian .* berulang';
  }

  // Alternasi di dalam grup yang diulang. Hanya berbahaya bila alternatifnya
  // tumpang tindih (a|aa, a|a+) atau salah satunya memuat quantifier.
  // (foo|bar)+ tetap diizinkan karena tidak ada ambiguitas.
  const quantifiedGroupRe = /\(([^()]*)\)\s*[+*{]/g;
  let match;
  while ((match = quantifiedGroupRe.exec(p)) !== null) {
    const inner = match[1];
    if (/[+*{]/.test(inner)) {
      return 'grup berulang yang memuat quantifier di dalamnya';
    }
    if (inner.includes('|')) {
      const alternatives = inner.split('|').map((a) => a.trim()).filter(Boolean);
      for (let i = 0; i < alternatives.length; i += 1) {
        for (let j = i + 1; j < alternatives.length; j += 1) {
          const a = alternatives[i];
          const b = alternatives[j];
          if (a.startsWith(b) || b.startsWith(a)) {
            return 'alternasi tumpang tindih di dalam grup berulang (mis. (a|aa)+)';
          }
        }
      }
    }
  }
  return null;
}

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

/** Membaca berkas sebagai teks; mengembalikan null bila biner, sensitif, symlink, atau terlalu besar. */
function readTextFile(fullPath) {
  const ext = path.extname(fullPath).toLowerCase();
  if (BINARY_EXT.has(ext)) return null;
  if (isSensitivePath(fullPath)) return null;

  let stat;
  try {
    stat = fs.lstatSync(fullPath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) return null;

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

/** Memeriksa apakah `dirPath` adalah direktori home pengguna (akar yang sangat luas). */
export function isHomeDirectory(dirPath = process.cwd()) {
  try {
    const a = path.resolve(dirPath).toLowerCase();
    const b = path.resolve(os.homedir()).toLowerCase();
    return a === b;
  } catch {
    return false;
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

  const baseDir = root;
  const globRe = fileGlob ? globToRegExp(fileGlob) : null;

  // Pencarian dari direktori HOME hampir selalu berujung lambat dan berisik.
  // Beri peringatan supaya model (dan pengguna) mempersempit lokasi pencarian.
  const homeNote = isHomeDirectory(root)
    ? '⚠️ Pencarian dijalankan dari direktori HOME (seluruh folder pengguna). Ini lambat dan hasilnya sangat luas — sebutkan subfolder yang lebih spesifik (mis. "baiworcode/src") agar hasilnya cepat dan tajam.'
    : '';
  const withNote = (out) => (homeNote ? `${homeNote}\n\n${out}` : out);

  // ---------- Mode: cari nama berkas ----------
  if (mode === 'files') {
    const nameRe = globToRegExp(pattern);
    const matches = [];

    const collect = (fullPath) => {
      const name = path.basename(fullPath);
      if (globRe && !globRe.test(name)) return;
      if (isSensitivePath(fullPath)) return;
      if (nameRe.test(name)) matches.push(toRelative(fullPath, baseDir));
    };

    if (fs.statSync(root).isFile()) {
      collect(root);
    } else {
      walk(root, collect, () => matches.length >= MAX_MATCHES);
    }

    if (matches.length === 0) {
      return { success: true, output: withNote(`Tidak ada berkas yang cocok dengan pola '${pattern}'.`) };
    }

    const shown = matches.slice(0, MAX_MATCHES);
    const footer =
      matches.length > shown.length
        ? `\n\n… [Menampilkan ${shown.length} dari ${matches.length} berkas yang cocok]`
        : '';
    return { success: true, output: withNote(`${shown.join('\n')}${footer}`) };
  }

  // ---------- Mode: cari isi berkas ----------
  const risk = detectRiskyRegex(pattern);
  if (risk) {
    return {
      success: false,
      output: `Error: pola regex ditolak (${risk}). Sederhanakan pola agar pencarian tidak menggantung.`,
    };
  }

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
    if (isSensitivePath(fullPath)) return;

    const text = readTextFile(fullPath);
    if (text === null) return;
    filesSearched += 1;

    const relPath = toRelative(fullPath, baseDir);
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      // Batasi input regex per baris: mengecilkan dampak pola yang lolos
      // detektor statis tanpa membuat hasil pencarian normal berubah.
      const line = lines[i];
      const matchTarget = line.length > 8000 ? line.slice(0, 8000) : line;
      if (contentRe.test(matchTarget)) {
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
      output: withNote(
        `Tidak ada kecocokan untuk '${pattern}' (${filesSearched} berkas dipindai di ${toRelative(root, baseDir) || '.'}).`
      ),
    };
  }

  const footer = hitLimit
    ? `\n\n… [Dibatasi pada ${MAX_MATCHES} kecocokan pertama. Persempit pola atau path untuk hasil lebih spesifik]`
    : `\n\n[${results.length} kecocokan dari ${filesSearched} berkas]`;

  return { success: true, output: withNote(`${results.join('\n')}${footer}`) };
}
