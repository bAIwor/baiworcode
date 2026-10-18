/**
 * Perkakas mode izin perintah (access mode) untuk antarmuka bAIwor Code.
 *
 * Mode ini sudah bisa diganti lewat pintasan Shift+Tab di prompt. Karena
 * kebanyakan pengguna bAIwor Code adalah pemula, peralihan yang sama juga
 * disediakan sebagai perintah slash `/access` — lengkap dengan pilihan
 * interaktif dan sinonim bahasa Indonesia, supaya tidak perlu menghafal
 * pintasan rahasia.
 */

/** Nama mode yang valid di config. */
export const ACCESS_MODES = ['normal', 'full'];

/** Sinonim argumen yang diterima perintah `/access`. */
const ACCESS_MODE_ALIASES = {
  normal: ['normal', 'safe', 'aman', 'biasa'],
  full: ['full', 'penuh', 'full-access', 'fullaccess'],
};

/** Label ramah pengguna untuk status line & pesan konfirmasi. */
export function accessModeLabel(mode) {
  return mode === 'full' ? 'Full access' : 'Safe';
}

/** Kalimat penjelas singkat untuk tiap mode. */
export function describeAccessMode(mode) {
  return mode === 'full'
    ? 'Perintah kelas "confirm" langsung dijalankan tanpa bertanya. Perintah berbahaya tetap ditolak.'
    : 'Setiap perintah berisiko akan meminta persetujuan dulu (disarankan).';
}

/**
 * Menerjemahkan argumen `/access` menjadi nama mode yang dipakai config.
 *
 * @param {string} value
 * @returns {'normal'|'full'|null} null bila argumen kosong atau tidak dikenali.
 */
export function parseAccessModeArg(value = '') {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  for (const [mode, names] of Object.entries(ACCESS_MODE_ALIASES)) {
    if (names.includes(v)) return mode;
  }
  return null;
}

/**
 * Daftar pilihan untuk menu interaktif (`p.select`).
 * Mode yang sedang aktif diberi tanda supaya pemula langsung paham posisinya.
 *
 * @param {'normal'|'full'} [current]
 * @returns {Array<{value:string, label:string, hint:string}>}
 */
export function accessModeOptions(current = 'normal') {
  return ACCESS_MODES.map((mode) => ({
    value: mode,
    label: mode === current ? `${accessModeLabel(mode)} (aktif)` : accessModeLabel(mode),
    hint: describeAccessMode(mode),
  }));
}
