/**
 * Sandbox bAIwor Code — penjaga akses berkas & perintah terminal.
 *
 * Latar belakang (temuan audit A5): sandbox pada tool berkas (F1) dapat ditembus
 * sepenuhnya lewat `run_command`, karena mengunci `cwd` tidak mengunci isi perintah.
 * Contoh nyata yang sebelumnya lolos:
 *   - run_command 'type C:\Users\<user>\hermes_providers.txt'   -> bocor
 *   - run_command 'cd .. && cd .. && dir /b'                    -> keluar workspace
 *
 * Modul ini menutup celah tersebut dengan memeriksa STRING perintah sebelum eksekusi.
 *
 * Batasan yang jujur: mencocokkan pola string BUKAN sandbox sejati. Ini lapisan
 * pertahanan berlapis (defense in depth), bukan jaminan. Sandbox sejati butuh
 * container / user terbatas di level OS.
 */

import path from 'node:path';
import os from 'node:os';

/** Direktori yang selalu dianggap area kredensial sensitif. */
const SENSITIVE_DIRS = ['.ssh', '.baiwor', '.aws', '.gnupg', '.azure', '.kube'];

/** Nama berkas kredensial — dicocokkan PERSIS (agar `id_rsa.pub` tidak ikut terblokir). */
const SENSITIVE_FILES = [
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  '.netrc',
  '.git-credentials',
  '.npmrc',
  '.pgpass',
];

/** Acuan ke direktori home pengguna (selalu di luar workspace). */
const HOME_ENV_REFS = [
  /\$HOME\b/,
  /\$\{HOME\}/,
  /%USERPROFILE%/i,
  /%APPDATA%/i,
  /%HOMEDRIVE%/i,
  /(?:^|[\s"'`(=])~[\\/]/,
];

/** Lokasi binary sistem yang tetap diizinkan agar perintah wajar tidak ikut terblokir. */
const SYSTEM_ALLOWED_PREFIXES =
  process.platform === 'win32'
    ? ['c:\\windows', 'c:\\program files']
    : ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/opt', '/snap'];

/** Pola perintah yang bersifat merusak dan tidak pernah wajar untuk agent coding. */
const DANGEROUS_RULES = [
  {
    re: /\brm\s+(?:-[a-zA-Z]+\s+)*(?:\/|~|\$HOME|%USERPROFILE%)(?:\s|$)/i,
    reason: 'menghapus direktori root/home secara rekursif',
  },
  {
    re: /\bdel\s+\/[a-z]*[sq][a-z]*\s+[a-z]:[\\/]?\s*(?:\s|$)/i,
    reason: 'menghapus seluruh isi drive',
  },
  {
    re: /\b(?:format|mkfs(?:\.\w+)?)\s+[a-z]:/i,
    reason: 'memformat drive',
  },
  {
    re: /\bdd\s+[^|;&]*\bof=\/dev\//i,
    reason: 'menulis langsung ke perangkat blok',
  },
  {
    re: /\b(?:shutdown|reboot|halt|poweroff)\b/i,
    reason: 'mematikan atau me-reboot mesin',
  },
  {
    re: /\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|pwsh|powershell)\b/i,
    reason: 'menjalankan skrip dari internet secara langsung',
  },
  {
    re: /\bgit\s+push\b[^|;&]*(?:--force|-f)(?:\s|$)/i,
    reason: 'force push — menimpa riwayat remote',
  },
  {
    re: /:\s*\(\s*\)\s*\{.*\|\s*:.*\}/,
    reason: 'fork bomb',
  },
  {
    re: /\bchmod\s+-R\s+777\s+\/(?:\s|$)/i,
    reason: 'mengubah izin seluruh sistem',
  },
];

/**
 * Memeriksa apakah `child` berada di dalam direktori `parent`.
 * Menggunakan perbandingan string path (bukan realpath), sehingga path yang
 * belum ada di disk tetap dapat divalidasi.
 *
 * Catatan (perbaikan audit A6): pemisah harus dicek dengan `path.sep`, bukan
 * sekadar `startsWith('..')` — kalau tidak, folder bernama `..foo` di dalam
 * workspace akan salah ditolak.
 */
export function isSubPath(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return !(rel === '..' || rel.startsWith('..' + path.sep));
}

/**
 * Memeriksa apakah path mengarah ke berkas atau direktori sensitif.
 * Perbaikan audit A7: nama berkas dicocokkan persis, sehingga `id_rsa.pub`
 * (kunci publik, aman dibaca) tidak lagi ikut ditolak.
 */
export function isSensitivePath(targetPath) {
  const resolved = path.resolve(targetPath);
  const home = path.resolve(os.homedir());
  const segments = resolved.split(path.sep).map((s) => s.toLowerCase());
  const base = segments[segments.length - 1] || '';

  for (const dir of SENSITIVE_DIRS) {
    if (segments.includes(dir)) return true;
    if (isSubPath(path.join(home, dir), resolved)) return true;
  }

  return SENSITIVE_FILES.includes(base);
}

/**
 * Apakah path absolut ini boleh disentuh (workspace, tmp, atau lokasi sistem umum).
 */
export function isPathAllowed(targetPath, workspace = process.cwd()) {
  const resolved = path.resolve(targetPath);
  if (isSubPath(workspace, resolved)) return true;
  if (isSubPath(os.tmpdir(), resolved)) return true;

  const lower = resolved.toLowerCase();
  return SYSTEM_ALLOWED_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(prefix));
}

/**
 * Mengambil seluruh kandidat path absolut dari sebuah string perintah.
 */
function extractAbsolutePaths(command) {
  const found = [];
  let m;

  const winRe = /[a-zA-Z]:[\\/][^\s"'`|&;<>()]*/g;
  while ((m = winRe.exec(command)) !== null) found.push(m[0]);

  // Pola POSIX hanya relevan di luar Windows; di Windows `/b` adalah flag, bukan path.
  if (process.platform !== 'win32') {
    const posixRe = /(?:^|[\s"'`=(])(\/[^\s"'`|&;<>()]*)/g;
    while ((m = posixRe.exec(command)) !== null) found.push(m[1]);
  }

  return found;
}

function deny(category, reason) {
  return { allowed: false, category, reason };
}

/**
 * Menganalisis perintah terminal sebelum dieksekusi.
 *
 * @param {string} command - Perintah shell yang diminta model.
 * @param {Object} [options]
 * @param {string} [options.workspace] - Root workspace yang diizinkan.
 * @returns {{ allowed: boolean, category: string|null, reason: string|null }}
 */
export function analyzeCommand(command, options = {}) {
  const workspace = path.resolve(options.workspace || process.cwd());
  const raw = String(command ?? '');

  if (!raw.trim()) {
    return deny('empty', 'Perintah kosong.');
  }

  const lower = raw.toLowerCase();

  // 1. Referensi ke area kredensial
  for (const dir of SENSITIVE_DIRS) {
    if (lower.includes(dir)) {
      return deny(
        'sensitive-path',
        `Perintah menyentuh area kredensial '${dir}' yang dilindungi. Gunakan tool berkas bila memang perlu, atau minta pengguna membukanya sendiri.`
      );
    }
  }
  for (const file of SENSITIVE_FILES) {
    if (lower.includes(file)) {
      return deny(
        'sensitive-path',
        `Perintah menyentuh berkas kredensial '${file}' yang dilindungi.`
      );
    }
  }
  for (const re of HOME_ENV_REFS) {
    if (re.test(raw)) {
      return deny(
        'sensitive-path',
        'Perintah mengacu ke direktori home pengguna (di luar workspace). Gunakan path relatif di dalam workspace.'
      );
    }
  }

  // 2. Pola perintah merusak
  for (const rule of DANGEROUS_RULES) {
    if (rule.re.test(raw)) {
      return deny('dangerous-command', `Perintah ditolak karena ${rule.reason}.`);
    }
  }

  // 3. Percobaan keluar dari workspace lewat cd/pushd
  const cdMatches = raw.matchAll(/\b(?:cd|chdir|pushd|set-location|sl)\s+([^\s;&|]+)/gi);
  for (const match of cdMatches) {
    const target = match[1].replace(/^["']|["']$/g, '');
    if (target.startsWith('..')) {
      return deny(
        'workspace-escape',
        `'cd ${target}' keluar dari workspace. Jalankan perintah dengan path relatif di dalam workspace saja.`
      );
    }
    if (path.isAbsolute(target) && !isPathAllowed(target, workspace)) {
      return deny(
        'workspace-escape',
        `'cd ${target}' menuju lokasi di luar workspace (${workspace}).`
      );
    }
  }

  // 4. Path absolut di luar workspace / tmp / sistem
  for (const candidate of extractAbsolutePaths(raw)) {
    if (!isPathAllowed(candidate, workspace)) {
      return deny(
        'workspace-escape',
        `Perintah mengakses '${candidate}' yang berada di luar workspace (${workspace}). Gunakan path relatif di dalam workspace.`
      );
    }
  }

  return { allowed: true, category: null, reason: null };
}
