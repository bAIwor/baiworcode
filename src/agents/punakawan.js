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
      'instabox_exec',
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
export const SQUAD_ROLE_EMOJIS = {
  bAIwor: '🔨',
  pAItruk: '🔍',
  gAIreng: '⚖️',
  semAIr: '👑',
};

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
