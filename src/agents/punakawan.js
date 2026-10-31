import { palette } from '../theme.js';

/**
 * Single Source of Truth untuk Tim Punakawan AI bAIwor Code:
 *
 * 1. bAIwor  : Tokoh Utama & Master Builder (Loop Utama & Pekerja Kode)
 * 2. semAIr  : Sang Pamomong & Arsitek Strategi (Roadmap, Checklist Todo, Perencanaan)
 * 3. pAItruk : Sang Scout & Penjelajah (Penelusuran berkas, riset, investigasi read-only)
 * 4. gAIreng : Sang Auditor & Verifikator (Uji mutu, eksekusi test, validasi)
 */

export const PUNAKAWAN_ROLES = {
  bAIwor: {
    name: 'bAIwor',
    title: 'Sang Tokoh Utama & Master Builder',
    emoji: '🔨',
    role: 'worker',
    description: 'Tokoh utama bAIwor Code. Eksekutor produksi, modifikasi kode presisi, refactoring, dan implementasi fitur.',
    allowedTools: [
      'edit_file',
      'write_file',
      'patch_file',
      'run_command',
      'read_file',
      'list_directory',
      'search_files',
    ],
  },
  semAIr: {
    name: 'semAIr',
    title: 'Sang Arsitek & Pamomong Strategi',
    emoji: '👑',
    role: 'architect',
    description: 'Merancang breakdown tugas, analisis kebutuhan, struktur roadmap, dan memelihara konteks percakapan.',
    allowedTools: [
      'todo_list',
      'read_file',
      'list_directory',
      'search_files',
      'websearch',
      'ask_user',
    ],
  },
  pAItruk: {
    name: 'pAItruk',
    title: 'Sang Scout & Penjelajah',
    emoji: '🔭',
    role: 'explore',
    description: 'Investigasi kode read-only, pemetaan dependensi, dan penelusuran referensi tanpa mengubah berkas.',
    allowedTools: ['read_file', 'list_directory', 'search_files', 'webfetch', 'websearch'],
  },
  gAIreng: {
    name: 'gAIreng',
    title: 'Sang Auditor & Verifikator',
    emoji: '⚖️',
    role: 'verifier',
    description: 'Audit mutu independen, eksekusi unit test, verifikasi diagnostik, dan mitigasi regresi.',
    allowedTools: ['run_command', 'diagnostics', 'read_file'],
  },
};

/**
 * Palet warna representasi karakter Tim Punakawan AI.
 * Warna seragam kuning emas khas Punakawan agar identitas aktor jelas.
 */
export const PUNAKAWAN_COLORS = {
  bAIwor: palette.gold,
  semAIr: palette.gold,
  pAItruk: palette.gold,
  gAIreng: palette.gold,
};

/**
 * Ikon peran subagent untuk pohon aktivitas paralel (Punakawan Squad).
 */
// Diturunkan dari PUNAKAWAN_ROLES agar ikon tidak pernah menyimpang dari
// sumber tunggal metadata karakter.
export const SQUAD_ROLE_EMOJIS = Object.fromEntries(
  Object.entries(PUNAKAWAN_ROLES).map(([name, role]) => [name, role.emoji])
);

/**
 * Pemetaan tool → anggota Punakawan pelakunya. Single source of truth: dipakai
 * timeline (atribusi aktor), presenter (menentukan penyampai jawaban), dan
 * turunannya. Menambah tool baru cukup mendaftarkan di sini.
 */
export const TOOL_ACTORS = {
  read_file: 'pAItruk',
  list_directory: 'pAItruk',
  search_files: 'pAItruk',
  webfetch: 'pAItruk',
  websearch: 'pAItruk',
  webautomate: 'pAItruk',
  write_file: 'bAIwor',
  edit_file: 'bAIwor',
  patch_file: 'bAIwor',
  run_command: 'gAIreng',
  diagnostics: 'gAIreng',
  todo_list: 'semAIr',
  delegate_task: 'semAIr',
  ask_user: 'semAIr',
  typesafe_ask: 'semAIr',
};

/**
 * Identitas penyampai jawaban (presenter) per anggota: gelar singkat untuk
 * badge penutup jawaban dan sapaan piket harian untuk banner.
 */
export const PRESENTER_INFO = {
  semAIr: {
    tagline: 'Arsitek & Pamomong Strategi',
    greeting: 'Rencana sing cetha, gaweane dadi enteng.',
  },
  bAIwor: {
    tagline: 'Master Builder',
    greeting: 'Kodene tak gawekne, tinggal cek hasilne.',
  },
  pAItruk: {
    tagline: 'Scout & Penjelajah',
    greeting: 'Tak telusuri dulu jejak kodene.',
  },
  gAIreng: {
    tagline: 'Auditor & Verifikator',
    greeting: 'Beri-selesai mesti tak uji dhisik.',
  },
};

/**
 * Label aktor dengan ikon di kiri nama (mis. "🔭 pAItruk") agar "siapa yang
 * bertindak" terbaca sekilas tanpa membaca nama.
 *
 * @param {string} name
 * @returns {string} Label berikon; string kosong bila peran tidak dikenal.
 */
export function formatPunakawanLabel(name) {
  const role = PUNAKAWAN_ROLES[name];
  if (!role) return '';
  return `${role.emoji} ${role.name}`;
}

/**
 * Mengambil metadata peran Punakawan berdasarkan nama atau alias peran generik.
 * @param {string} roleName
 * @returns {object|null}
 */
export function getPunakawanRole(roleName) {
  if (!roleName || typeof roleName !== 'string') return null;
  const key = roleName.toLowerCase().trim();
  for (const [name, meta] of Object.entries(PUNAKAWAN_ROLES)) {
    if (name.toLowerCase() === key || meta.role.toLowerCase() === key) {
      return meta;
    }
  }
  return null;
}

/**
 * Menghasilkan badge teks peran Punakawan untuk display status UI.
 * @param {string} roleName
 * @returns {string}
 */
export function formatPunakawanBadge(roleName) {
  const role = getPunakawanRole(roleName);
  if (!role) return '';
  return `[${role.emoji} ${role.name}: ${role.title}]`;
}
