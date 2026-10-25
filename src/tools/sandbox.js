/**
 * Sandbox bAIwor Code — penjaga akses berkas & perintah terminal.
 *
 * Latar belakang (temuan audit A5): sandbox pada tool berkas (F1) dapat ditembus
 * sepenuhnya lewat `run_command`, karena mengunci `cwd` tidak mengunci isi perintah.
 * Contoh nyata yang sebelumnya lolos:
 *   - run_command 'type C:\Users\<user>\catatan_penting.txt'      -> bocor
 *   - run_command 'cd .. && cd .. && dir /b'                    -> keluar workspace
 *
 * Modul ini menutup celah tersebut dengan memeriksa STRING perintah sebelum eksekusi.
 *
 * Batasan yang jujur: mencocokkan pola string BUKAN sandbox sejati. Ini lapisan
 * pertahanan berlapis (defense in depth), bukan jaminan. Sandbox sejati butuh
 * container / user terbatas di level OS.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Direktori yang selalu dianggap area kredensial sensitif. */
const SENSITIVE_DIRS = [
  '.ssh', '.baiwor', '.aws', '.gnupg', '.azure', '.kube',
  '.tinyfish', '.docker', '.npm',
];

/** Nama berkas kredensial — dicocokkan PERSIS (agar `id_rsa.pub` tidak ikut terblokir). */
const SENSITIVE_FILES = [
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  '.netrc',
  '.git-credentials',
  '.gitconfig',
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
  /%HOMEPATH%/i,
  /%LOCALAPPDATA%/i,
  // Variabel lingkungan lain yang menunjuk ke luar home/workspace.
  /\$(?:USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|OLDPWD)\b/i,
  /\$\{(?:USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|OLDPWD)\}/i,
  /%PROGRAMDATA%/i,
  /%ALLUSERSPROFILE%/i,
  /%SYSTEMDRIVE%/i,
  /%PUBLIC%/i,
  // PowerShell: $env:USERPROFILE, ${env:APPDATA}
  /\$env:/i,
  /\$\{env:/i,
  // Semua bentuk tilde (~, ~/, ~user) menunjuk ke home / home pengguna lain.
  // Kelas batas token harus menyertakan operator shell (<, >, ;, |, &) —
  // tanpa itu cat <~/secret.txt lolos dari deteksi.
  /(?:^|[\s"'`(=,;|&<>])~/,
];

/** Lokasi binary sistem yang tetap diizinkan agar perintah wajar tidak ikut terblokir. */
const SYSTEM_ALLOWED_PREFIXES =
  process.platform === 'win32'
    ? ['c:\\windows', 'c:\\program files']
    : ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/opt', '/snap'];

/**
 * Prefix lokasi sistem versi Windows.
 *
 * Dipakai saat mengevaluasi ulang path bergaya Windows di host non-Windows,
 * supaya `C:\Windows\System32\...` tidak ikut dianggap "keluar workspace".
 */
const WIN32_SYSTEM_PREFIXES = ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)'];

/**
 * Menormalkan escape shell yang umum dipakai untuk mengelabui pencocokan
 * string: caret cmd.exe (`C^:`) dan backslash sebelum separator POSIX
 * (`\/etc`). Backslash sebelum huruf TIDAK dihapus agar path Windows
 * (`C:\Users`) tetap utuh.
 *
 * @param {string} command
 * @returns {string}
 */
function normalizeShellEscapes(command) {
  return String(command ?? '')
    .replace(/\^([\\/*?"'<>|&;():])/g, '$1')
    .replace(/\\\//g, '/');
}

/**
 * Pola perintah yang bersifat merusak dan tidak pernah wajar untuk agent coding.
 *
 * Setiap aturan punya `id` stabil. Id ini dipakai oleh mekanisme override sadar
 * (lihat `parseDestructiveAllowlist`) supaya operator bisa membuka SATU aturan
 * tertentu tanpa membuka semua — mis. hanya `power` untuk shutdown.
 */
const DANGEROUS_RULES = [
  {
    id: 'rm-root',
    re: /\brm\s+(?:-[a-zA-Z]+\s+)*(?:\/|~|\$HOME|%USERPROFILE%)(?:\s|$)/i,
    reason: 'menghapus direktori root/home secara rekursif',
  },
  {
    id: 'del-drive',
    // Flag boleh lebih dari satu dan urutannya bebas: del /f /s /q C:\
    re: /\b(?:del|erase)\s+(?:\/[a-z]+\s+)*["']?[a-z]:[\\/]?(?:\*[^\s"']*)?["']?\s*(?:\s|$)/i,
    reason: 'menghapus seluruh isi drive',
  },
  {
    id: 'rd-drive',
    re: /\b(?:rd|rmdir)\s+(?:\/[a-z]+\s+)*["']?[a-z]:[\\/]?(?:\*[^\s"']*)?["']?\s*(?:\s|$)/i,
    reason: 'menghapus seluruh isi drive',
  },
  {
    id: 'format-drive',
    re: /\b(?:format|mkfs(?:\.\w+)?)\s+[a-z]:/i,
    reason: 'memformat drive',
  },
  {
    id: 'dd-block-device',
    re: /\bdd\s+[^|;&]*\bof=\/dev\//i,
    reason: 'menulis langsung ke perangkat blok',
  },
  {
    id: 'power',
    re: /\b(?:shutdown|reboot|halt|poweroff|stop-computer|restart-computer)\b/i,
    reason: 'mematikan atau me-reboot mesin',
  },
  {
    id: 'pipe-to-shell',
    // Path absolut (/bin/bash) dan interpreter umum ikut ditangkap. Tanpa
    // prefix path opsional, `curl ... | /bin/bash` lolos karena /bin ada di
    // SYSTEM_ALLOWED_PREFIXES.
    re: /\b(?:curl|wget)\b[^|;&]*\|\&?\s*(?:sudo\s+(?:-[a-z]+\s+)*)?(?:(?:\/|\.{1,2}\/)?[\w.-]+\/)*(?:env\s+(?:-[^\s]+\s+)*)?(?:sh|bash|zsh|dash|ksh|pwsh|powershell|python[\d.]*|perl|ruby|node|php)\b/i,
    reason: 'menjalankan skrip dari internet secara langsung',
  },
  {
    id: 'encoded-command',
    // Perintah PowerShell terenkode tidak bisa diaudit; jangan biarkan lolos
    // lewat singkatan parameter (-e, -enc, -encodedcommand).
    re: /\b(?:pwsh|powershell)\b[^|;&]*\s-(?:encodedcommand|encoded|encode|encod|enco|enc|ec|e)\b/i,
    reason: 'menjalankan perintah PowerShell terenkode yang tidak bisa diperiksa',
  },
  {
    id: 'git-force-push',
    re: /\bgit\s+push\b[^|;&]*(?:--force|-f)(?:\s|$)/i,
    reason: 'force push — menimpa riwayat remote',
  },
  {
    id: 'fork-bomb',
    re: /:\s*\(\s*\)\s*\{.*\|\s*:.*\}/,
    reason: 'fork bomb',
  },
  {
    id: 'chmod-root',
    re: /\bchmod\s+-R\s+777\s+\/(?:\s|$)/i,
    reason: 'mengubah izin seluruh sistem',
  },
];

/**
 * Realpath yang tetap bekerja untuk path yang belum ada: bagian yang ada
 * di-resolve, sisa segmennya ditempel kembali. Ini menutup celah symlink/
 * junction di dalam workspace yang mengarah ke luar.
 *
 * @param {string} targetPath
 * @returns {string}
 */
export function realpathWithMissingTail(targetPath) {
  const resolved = path.resolve(targetPath);
  let current = resolved;
  const tail = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.unshift(path.basename(current));
    current = parent;
  }
  let real;
  try {
    real = fs.realpathSync.native(current);
  } catch {
    try {
      real = fs.realpathSync(current);
    } catch {
      real = current;
    }
  }
  return tail.length > 0 ? path.join(real, ...tail) : real;
}

/**
 * Realpath bila memungkinkan; fallback ke path.resolve.
 * @param {string} targetPath
 * @returns {string}
 */
export function realpathOrResolved(targetPath) {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    try {
      return fs.realpathSync(targetPath);
    } catch {
      return path.resolve(targetPath);
    }
  }
}

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
  const home = path.resolve(os.homedir());
  // Periksa path literal DAN realpath-nya: symlink/junction di dalam workspace
  // bisa menunjuk ke ~/.ssh atau ~/.baiwor tanpa namanya terlihat di path asli.
  const candidates = new Set([
    path.resolve(targetPath),
    realpathWithMissingTail(targetPath),
  ]);

  for (const resolved of candidates) {
    const segments = resolved.split(path.sep).map((s) => s.toLowerCase());
    const base = segments[segments.length - 1] || '';

    for (const dir of SENSITIVE_DIRS) {
      if (segments.includes(dir)) return true;
      if (isSubPath(path.join(home, dir), resolved)) return true;
    }

    if (SENSITIVE_FILES.includes(base)) return true;
  }

  return false;
}

/**
 * Apakah path absolut ini boleh disentuh (workspace, tmp, atau lokasi sistem umum).
 */
export function isPathAllowed(targetPath, workspace = process.cwd()) {
  const resolved = path.resolve(targetPath);
  if (isSubPath(workspace, resolved)) return true;
  if (isSubPath(os.tmpdir(), resolved)) return true;

  return SYSTEM_ALLOWED_PREFIXES.some((prefix) => isSubPath(prefix, resolved));
}

/**
 * Apakah token/path ini terlihat seperti path gaya Windows?
 *
 * Latar belakang: di host POSIX, `C:\Users\me\secret.txt` dan `..\..\secret.txt`
 * diperlakukan sebagai SATU nama berkas biasa (backslash bukan separator).
 * Akibatnya `path.resolve()` menaruh keduanya DI DALAM workspace dan guard
 * gagal terbuka (fail-open) — akses di luar workspace lolos tanpa ditolak.
 *
 * Deteksi ini membuat guard mengevaluasi ulang path bergaya Windows dengan
 * semantik `path.win32`, apa pun host yang dipakai. Di Windows (native ==
 * win32) hasilnya identik dengan sebelumnya, jadi tidak ada perubahan perilaku.
 *
 * @param {string} token
 * @returns {boolean}
 */
function looksLikeWindowsPath(token) {
  if (!token) return false;
  return /\\/.test(token) || /^[a-zA-Z]:/.test(token);
}

/**
 * Apakah kandidat path keluar dari workspace menurut semantik path tertentu?
 *
 * Kandidat absolut dipakai apa adanya; kandidat relatif di-resolve relatif
 * terhadap workspace (bukan terhadap cwd), supaya hasilnya konsisten dengan
 * tempat perintah dijalankan.
 *
 * @param {string} candidate
 * @param {string} workspace
 * @param {typeof path} impl - `path` (native) atau `path.win32`
 * @returns {boolean}
 */
function escapesWorkspaceBy(candidate, workspace, impl = path) {
  const root = impl.resolve(workspace);
  const target = impl.isAbsolute(candidate) ? impl.resolve(candidate) : impl.resolve(root, candidate);
  const rel = impl.relative(root, target);
  if (rel === '') return false;
  if (impl.isAbsolute(rel)) return true; // root atau drive berbeda
  return rel === '..' || rel.startsWith('..' + impl.sep);
}

/**
 * Apakah kandidat path harus dianggap berada di luar workspace?
 *
 * Memakai aturan bawaan (workspace, tmp, lokasi sistem) lalu, sebagai jaring
 * pengaman kedua, mengevaluasi ulang path bergaya Windows dengan semantik
 * `path.win32`. Tanpa jaring ini guard gagal-terbuka di host POSIX.
 *
 * Evaluasi ulang HANYA dijalankan bila path native-nya terlihat "di dalam
 * workspace" — di situlah celah fail-open berada. Path tmp/sistem yang sudah
 * diizinkan aturan bawaan tidak perlu dihitung ulang.
 *
 * @param {string} candidate
 * @param {string} workspace
 * @returns {boolean}
 */
function isOutsideWorkspace(candidate, workspace) {
  if (!isPathAllowed(candidate, workspace)) return true;

  const resolvedNative = path.resolve(candidate);
  const insideWorkspaceByString = isSubPath(workspace, resolvedNative);
  const insideTmpByString = isSubPath(os.tmpdir(), resolvedNative);

  // Path yang secara string berada di workspace/tmp tetapi realpath-nya
  // menunjuk keluar adalah symlink/junction escape.
  if (insideWorkspaceByString) {
    const realWorkspace = realpathOrResolved(workspace);
    if (!isSubPath(realWorkspace, realpathWithMissingTail(resolvedNative))) return true;
  }
  if (insideTmpByString) {
    const realTmp = realpathOrResolved(os.tmpdir());
    if (!isSubPath(realTmp, realpathWithMissingTail(resolvedNative))) return true;
  }

  if (!insideWorkspaceByString) return false;
  if (!looksLikeWindowsPath(candidate)) return false;

  const lower = path.win32.resolve(candidate).toLowerCase();
  const isSystem = WIN32_SYSTEM_PREFIXES.some(
    (prefix) => lower === prefix || lower.startsWith(prefix + '\\')
  );
  if (isSystem) return false;

  return escapesWorkspaceBy(candidate, workspace, path.win32);
}

/**
 * Mengambil seluruh kandidat path absolut dari sebuah string perintah.
 */
function extractAbsolutePaths(command) {
  const found = [];
  let m;

  // Path absolut Windows. Batas token di depan (`(?:^|[...])`) penting: tanpa
  // itu, skema URL seperti `https://github.com` juga cocok — huruf `s` + `:`
  // + `//` terbaca sebagai drive `s:` absolut sehingga perintah sah seperti
  // `git clone https://...` atau `curl https://...` ikut ditolak sandbox.
  // Dengan batas token, `s:` pada `https://` didahului huruf `p` (bukan
  // pemisah) sehingga tidak lagi dianggap path.
  const winRe = /(?:^|[\s"'`=(,;|&<>])([a-zA-Z]:[\\/][^\s"'`|&;<>()]*)/g;
  while ((m = winRe.exec(command)) !== null) found.push(m[1]);

  // UNC / device path (\\server\share, \\?\C:\...) selalu di luar workspace.
  const uncRe = /(?:^|[\s"'`=(,;|&<>])(\\\\[^\s"'`|&;<>()]+)/g;
  while ((m = uncRe.exec(command)) !== null) found.push(m[1]);

  // Pola POSIX hanya relevan di luar Windows; di Windows `/b` adalah flag, bukan path.
  // Kelas batas token harus sama dengan winRe di atas. Kalau `<`, `>`, `;`, `|`,
  // `&` tidak ikut menjadi batas, perintah seperti `cat </etc/shadow` atau
  // `echo x >/etc/cron.d/job` tidak menghasilkan path absolut sama sekali —
  // sehingga guard workspace-escape lolos.
  if (process.platform !== 'win32') {
    const posixRe = /(?:^|[\s"'`=(,;|&<>])(\/[^\s"'`|&;<>()]*)/g;
    while ((m = posixRe.exec(command)) !== null) found.push(m[1]);
  }

  return found;
}

/**
 * Pola perintah yang SAH tapi berisiko — boleh dijalankan, tapi sebaiknya
 * dikonfirmasi dulu ke pengguna (dipakai oleh approval gate / Human-in-the-Loop).
 *
 * Dipisahkan dari DANGEROUS_RULES: yang di sini TIDAK ditolak oleh sandbox,
 * hanya ditandai agar pemanggil bisa menampilkan prompt Y/n.
 */
export const CONFIRM_RULES = [
  { re: /\bgit\s+push\b/i, reason: 'mengirim perubahan ke repositori remote' },
  { re: /\bnpm\s+publish\b/i, reason: 'menerbitkan paket ke registri publik' },
  { re: /\bnpm\s+(?:i|install)\s+(?:-g|--global)\b/i, reason: 'memasang paket secara global di sistem' },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: 'membuang seluruh perubahan lokal' },
  { re: /\bgit\s+clean\s+-[a-z]*[fd]/i, reason: 'menghapus berkas yang belum dilacak' },
  { re: /\bgit\s+(?:checkout|restore)\s+--?\s*\./i, reason: 'membuang perubahan pada seluruh berkas' },
  { re: /\brm\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*[rR][a-zA-Z]*\b/i, reason: 'menghapus berkas secara rekursif' },
  { re: /\bdel\s+\/[a-z]*[fq][a-z]*\b/i, reason: 'menghapus berkas secara paksa' },
  // Windows: pola /s tidak selalu berada tepat setelah perintah (del /s /q),
  // jadi periksa seluruh argumen. rmdir/rd dan Remove-Item juga harus minta izin.
  { re: /\bdel\b[^|;&]*\/s\b/i, reason: 'menghapus berkas secara rekursif' },
  { re: /\berase\b[^|;&]*\/s\b/i, reason: 'menghapus berkas secara rekursif' },
  { re: /\b(?:rmdir|rd)\b[^|;&]*\/s\b/i, reason: 'menghapus direktori beserta isinya' },
  { re: /\bremove-item\b/i, reason: 'menghapus item melalui PowerShell' },
  { re: /\bclear-content\b/i, reason: 'mengosongkan isi berkas melalui PowerShell' },
  { re: /\b(?:kill|taskkill|pkill)\b/i, reason: 'menghentikan proses yang sedang berjalan' },
  { re: /\bchmod\b|\bchown\b|\bicacls\b/i, reason: 'mengubah izin atau kepemilikan berkas' },
  {
    // Kode inline yang membaca environment/home bisa merakit path di luar
    // workspace tanpa literal path yang bisa dicek regex path.
    re: /\b(?:node|python[\d.]*|perl|ruby|php)\b[^|;&]*\s(?:-e|-c|-r)\s+[^\n]*(?:process\.env|os\.homedir|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|OLDPWD)\b/i,
    reason: 'menjalankan kode inline yang mengakses environment/home',
  },
];

/**
 * Mengklasifikasikan perintah menjadi tiga tingkat keputusan:
 *
 *   - `deny`    : ditolak mutlak oleh sandbox (tidak pernah wajar untuk agent).
 *   - `confirm` : sah, tetapi berisiko — sebaiknya minta persetujuan pengguna (Y/n).
 *   - `allow`   : jalankan langsung.
 *
 * `analyzeCommand()` tetap menjadi sumber kebenaran untuk keputusan tolak,
 * sehingga perilaku sandbox tidak berubah — fungsi ini hanya menambah satu
 * tingkat di antaranya.
 *
 * @param {string} command
 * @param {Object} [options]
 * @param {string} [options.workspace]
 * @returns {{ decision: 'allow'|'confirm'|'deny', category: string|null, reason: string|null }}
 */
export function classifyCommand(command, options = {}) {
  const verdict = analyzeCommand(command, options);
  if (!verdict.allowed) {
    return {
      decision: 'deny',
      category: verdict.category,
      reason: verdict.reason,
      ruleId: verdict.ruleId ?? null,
    };
  }

  const raw = normalizeShellEscapes(command);
  for (const rule of CONFIRM_RULES) {
    if (rule.re.test(raw)) {
      return {
        decision: 'confirm',
        category: 'needs-approval',
        reason: `Perintah ini ${rule.reason}.`,
        ruleId: null,
      };
    }
  }

  return { decision: 'allow', category: null, reason: null, ruleId: null };
}

/** Daftar id aturan perintah merusak yang boleh dibuka lewat override. */
export const DANGEROUS_RULE_IDS = DANGEROUS_RULES.map((rule) => rule.id);

/**
 * Mengurai izin override destruktif dari env/config menjadi Set id (atau 'all').
 *
 * Sengaja menerima nilai sebagai argumen (bukan membaca global) agar mudah diuji.
 * Aturan:
 *   - kosong / undefined / false / '' -> tidak ada yang diizinkan (Set kosong)
 *   - true / '1' / 'true' / 'all' / '*' -> 'all' (SEMUA aturan merusak dibuka)
 *   - string 'power,git-force-push' atau array ['power'] -> Set id tersebut
 *
 * Env (`BAIWOR_ALLOW_DESTRUCTIVE`) menang atas `config.destructiveAllow`.
 */
export function parseDestructiveAllowlist(envValue, configValue) {
  const raw =
    envValue !== undefined && envValue !== null && envValue !== '' ? envValue : configValue;

  if (raw === undefined || raw === null || raw === false || raw === '') return new Set();
  if (raw === true) return 'all';

  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (!v || v === '0' || v === 'false' || v === 'none') return new Set();
    if (v === '1' || v === 'true' || v === 'all' || v === '*') return 'all';
    return new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
  }

  if (Array.isArray(raw)) {
    return new Set(raw.map((s) => String(s).trim().toLowerCase()).filter(Boolean));
  }

  return new Set();
}

/**
 * Apakah penolakan `dangerous-command` boleh diteruskan karena override sadar.
 *
 * Hanya kelas `dangerous-command` yang bisa dibuka. Kelas lain (kredensial,
 * workspace-escape) TETAP ditolak mutlak — override ini tidak menembusnya.
 */
export function isDestructiveAllowed(classification, allowlist) {
  if (!classification || classification.category !== 'dangerous-command') return false;
  if (!classification.ruleId) return false;
  if (allowlist === 'all') return true;
  return allowlist instanceof Set && allowlist.has(classification.ruleId);
}

function deny(category, reason, ruleId = null) {
  return { allowed: false, category, reason, ruleId };
}

/**
 * Mencari argumen berisi path relatif yang keluar dari workspace lewat segmen
 * `..` (mis. `type ..\secret.txt` atau `foo/../../etc`).
 *
 * Pemeriksaan `cd`/`pushd` di atas hanya menangkap perintah `cd`. Tanpa ini,
 * perintah lain bisa menembus sandbox dengan path relatif karena `run_command`
 * dieksekusi dari dalam workspace, sehingga `..` mengarah ke folder induk nyata.
 *
 * Token di-resolve terhadap workspace lebih dulu, jadi path relatif yang tetap
 * berada di dalam project (mis. `src/../lib`) tidak ikut ditolak.
 *
 * @returns {string|null} token pelanggar, atau null bila aman.
 */
function findEscapingRelativePath(command, workspace) {
  const tokenRe = /[^\s"'`|&;<>()]+/g;
  let m;
  while ((m = tokenRe.exec(command)) !== null) {
    const token = m[0];
    if (token.includes('://')) continue; // URL, bukan path lokal
    const hasSeparator = token.includes('/') || token.includes('\\');
    if (token !== '..' && !hasSeparator) continue;
    if (path.isAbsolute(token)) continue;

    const resolved = path.resolve(workspace, token);
    if (!isSubPath(workspace, resolved)) return token;

    // Fail-open guard: di host POSIX, `..\..\secret.txt` terbaca sebagai satu
    // nama berkas (backslash bukan separator) sehingga tidak tertangkap di
    // atas. Ulangi dengan semantik Windows agar konsisten lintas platform.
    if (looksLikeWindowsPath(token) && escapesWorkspaceBy(token, workspace, path.win32)) {
      return token;
    }

    // Token relatif (mis. `link/secret`) bisa keluar workspace lewat junction.
    if (!isSubPath(realpathOrResolved(workspace), realpathWithMissingTail(resolved))) {
      return token;
    }
  }
  return null;
}

/**
 * Apakah target `cd`/`pushd` menunjuk ke luar workspace (termasuk via symlink).
 * Pengganti pemeriksaan `startsWith('..')` yang bisa dilewati `./..`.
 *
 * @param {string} target
 * @param {string} workspace
 * @returns {boolean}
 */
function isCommandPathOutside(target, workspace) {
  if (!target || target.includes('://')) return false;
  // `cd ~`, `cd -`, `cd` tanpa argumen (ditangani pemanggil) menuju home /
  // direktori sebelumnya yang berada di luar workspace.
  if (target === '~' || target.startsWith('-')) return true;

  const native = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(workspace, target);

  if (!isPathAllowed(native, workspace)) return true;

  if (isSubPath(workspace, native)) {
    const realWorkspace = realpathOrResolved(workspace);
    if (!isSubPath(realWorkspace, realpathWithMissingTail(native))) return true;
  }

  if (looksLikeWindowsPath(target) && escapesWorkspaceBy(target, workspace, path.win32)) {
    return true;
  }

  return false;
}

/**
 * Karakter yang dianggap bagian dari sebuah nama, bukan batas token.
 * Dipakai agar `foo.ssh` atau `id_rsa.pub` tidak ikut dianggap area kredensial.
 */
const NAME_CHAR_RE = /[A-Za-z0-9_.]/;

/**
 * Menentukan apakah posisi `index` berada di dalam tanda kutip (' atau ").
 *
 * Dipakai untuk membedakan path sungguhan dari sekadar sebutan di dalam teks,
 * mis. pesan commit `git commit -m "catatan soal .ssh"`.
 *
 * @param {string} str
 * @param {number} index
 * @returns {boolean}
 */
function isInsideQuotes(str, index) {
  let quote = null;
  for (let i = 0; i < index; i += 1) {
    const ch = str[i];
    if (ch === '\\') {
      i += 1; // lewati karakter yang di-escape
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    }
  }
  return quote !== null;
}

/**
 * Apakah sebuah nama sensitif benar-benar dipakai sebagai path, bukan sekadar
 * disebut dalam teks bebas.
 *
 * Nama dianggap berbahaya bila:
 *   - diapit pemisah path / drive di salah satu sisinya — `~/.ssh`,
 *     `.ssh/id_rsa`, `C:\...\.aws`; atau
 *   - muncul sebagai token utuh di LUAR tanda kutip — `cat .npmrc`.
 *
 * Dengan aturan ini `git commit -m "docs soal .ssh"` tidak lagi ditolak,
 * sementara akses nyata ke area kredensial tetap diblokir.
 *
 * @param {string} raw
 * @param {string} name
 * @returns {boolean}
 */
function referencesSensitiveName(raw, name) {
  const lower = raw.toLowerCase();
  const needle = name.toLowerCase();
  let idx = lower.indexOf(needle);

  while (idx !== -1) {
    const before = idx > 0 ? raw[idx - 1] : '';
    const after = raw[idx + needle.length] || '';
    const bounded = !NAME_CHAR_RE.test(before) && !NAME_CHAR_RE.test(after);

    if (bounded) {
      const pathLike = /[~/\\:]/.test(before) || /[/\\]/.test(after);
      if (pathLike || !isInsideQuotes(raw, idx)) return true;
    }
    idx = lower.indexOf(needle, idx + 1);
  }
  return false;
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
  // Analisis memakai bentuk yang sudah dinormalisasi, sementara eksekusi tetap
  // memakai string asli dari model.
  const normalized = normalizeShellEscapes(raw);

  if (!raw.trim()) {
    return deny('empty', 'Perintah kosong.');
  }

  // 1. Referensi ke area kredensial (hanya bila benar-benar berupa path).
  for (const dir of SENSITIVE_DIRS) {
    if (referencesSensitiveName(normalized, dir)) {
      return deny(
        'sensitive-path',
        `Perintah menyentuh area kredensial '${dir}' yang dilindungi. Gunakan tool berkas bila memang perlu, atau minta pengguna membukanya sendiri.`
      );
    }
  }
  for (const file of SENSITIVE_FILES) {
    if (referencesSensitiveName(normalized, file)) {
      return deny(
        'sensitive-path',
        `Perintah menyentuh berkas kredensial '${file}' yang dilindungi.`
      );
    }
  }
  for (const re of HOME_ENV_REFS) {
    if (re.test(normalized)) {
      return deny(
        'sensitive-path',
        'Perintah mengacu ke direktori home pengguna (di luar workspace). Gunakan path relatif di dalam workspace.'
      );
    }
  }

  // 2. Pola perintah merusak
  for (const rule of DANGEROUS_RULES) {
    if (rule.re.test(normalized)) {
      return deny('dangerous-command', `Perintah ditolak karena ${rule.reason}.`, rule.id);
    }
  }

  // 3. Percobaan keluar dari workspace lewat cd/pushd
  // `cd`/`pushd` tanpa argumen berpindah ke HOME / direktori sebelumnya.
  if (/(?:^|[;&|]\s*)(?:cd|chdir|pushd|set-location|sl)\s*(?:[;&|]|$)/i.test(normalized)) {
    return deny(
      'workspace-escape',
      'Perintah cd/pushd tanpa argumen menuju direktori home atau direktori sebelumnya. Gunakan path di dalam workspace.'
    );
  }

  const cdMatches = normalized.matchAll(/\b(?:cd|chdir|pushd|set-location|sl)\s+([^\s;&|]+)/gi);
  for (const match of cdMatches) {
    const target = match[1].replace(/^["']|["']$/g, '');
    if (isCommandPathOutside(target, workspace)) {
      return deny(
        'workspace-escape',
        `'cd ${target}' menuju lokasi di luar workspace (${workspace}). Gunakan path di dalam workspace saja.`
      );
    }
  }

  // 4. Path relatif yang keluar workspace lewat segmen `..`
  const relativeEscape = findEscapingRelativePath(normalized, workspace);
  if (relativeEscape) {
    return deny(
      'workspace-escape',
      `Argumen '${relativeEscape}' menunjuk ke luar workspace (${workspace}) lewat path relatif. Gunakan path relatif di dalam workspace saja.`
    );
  }

  // 5. Path absolut di luar workspace / tmp / sistem
  for (const candidate of extractAbsolutePaths(normalized)) {
    if (isOutsideWorkspace(candidate, workspace)) {
      return deny(
        'workspace-escape',
        `Perintah mengakses '${candidate}' yang berada di luar workspace (${workspace}). Gunakan path relatif di dalam workspace.`
      );
    }
  }

  return { allowed: true, category: null, reason: null };
}
