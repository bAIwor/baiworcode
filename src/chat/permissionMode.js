/**
 * Perkakas mode izin terpadu (permission mode) untuk bAIwor Code.
 *
 * Satu konsep menggantikan dua konsep lama (agentMode Build/Plan +
 * accessMode Safe/Full) — mengikuti pola Qoder / Claude Code di mana
 * read-only plan hanyalah salah satu dari empat mode izin.
 *
 *   safe  → setiap perubahan berkas & perintah berisiko bertanya  (biru)
 *   auto  → berkas langsung diterapkan; perintah tetap bertanya    (hijau)
 *   plan  → arsitek read-only; tool tulis diblokir keras           (kuning)
 *   yolo  → tanpa bertanya; kelas "deny" tetap ditolak             (merah)
 *
 * Warna memakai pastel warna brand Google (lihat theme.js palette.perm*).
 */

import { theme } from '../theme.js';

/** Nama mode yang valid. Urutan ini juga dipakai siklus Shift+Tab. */
export const PERMISSION_MODES = ['safe', 'auto', 'plan', 'yolo'];

/** Sinonim argumen perintah `/permission`. */
const PERMISSION_MODE_ALIASES = {
  safe: ['safe', 'aman', 'normal', 'biasa'],
  auto: ['auto', 'otomatis', 'semi'],
  plan: ['plan', 'rencana', 'arsitek', 'read-only', 'readonly'],
  yolo: ['yolo', 'full', 'penuh', 'full-access', 'fullaccess'],
};

/** Label pendek untuk status line & pesan konfirmasi. */
export function permissionModeLabel(mode) {
  if (mode === 'auto') return 'Auto';
  if (mode === 'plan') return 'Plan';
  if (mode === 'yolo') return 'YOLO';
  return 'Safe';
}

/** Kalimat penjelas singkat untuk tiap mode. */
export function describePermissionMode(mode) {
  switch (mode) {
    case 'auto':
      return 'Perubahan berkas langsung diterapkan; perintah berisiko tetap bertanya.';
    case 'plan':
      return 'Mode arsitek read-only: hanya membaca, mencari, dan menyusun rencana.';
    case 'yolo':
      return 'Semua persetujuan dilewati — perintah berbahaya kelas "deny" tetap ditolak.';
    default:
      return 'Setiap perubahan berkas & perintah berisiko minta persetujuan (disarankan).';
  }
}

/**
 * Menerjemahkan argumen `/permission` menjadi nama mode yang dipakai config.
 *
 * @param {string} value
 * @returns {'safe'|'auto'|'plan'|'yolo'|null} null bila kosong / tidak dikenali.
 */
export function parsePermissionModeArg(value = '') {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  for (const [mode, names] of Object.entries(PERMISSION_MODE_ALIASES)) {
    if (names.includes(v)) return mode;
  }
  return null;
}

/**
 * Fungsi warna chalk untuk label mode (pastel Google).
 *
 * @param {'safe'|'auto'|'plan'|'yolo'} mode
 * @returns {(text: string) => string}
 */
export function permissionModeColor(mode) {
  if (mode === 'auto') return theme.permAuto;
  if (mode === 'plan') return theme.permPlan;
  if (mode === 'yolo') return theme.permYolo;
  return theme.permSafe;
}

/** Mode berikutnya untuk siklus Shift+Tab: safe → auto → plan → yolo → safe. */
export function nextPermissionMode(current) {
  const idx = PERMISSION_MODES.indexOf(current);
  if (idx === -1) return 'safe';
  return PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length];
}

/**
 * Daftar pilihan untuk menu interaktif (`p.select`).
 *
 * @param {'safe'|'auto'|'plan'|'yolo'} [current]
 * @returns {Array<{value:string, label:string, hint:string}>}
 */
export function permissionModeOptions(current = 'safe') {
  return PERMISSION_MODES.map((mode) => ({
    value: mode,
    label: mode === current ? `${permissionModeLabel(mode)} (aktif)` : permissionModeLabel(mode),
    hint: describePermissionMode(mode),
  }));
}
