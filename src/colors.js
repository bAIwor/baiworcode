import chalk from 'chalk';

/**
 * Deteksi dukungan warna yang lebih tegas daripada bawaan chalk.
 *
 * Chalk sesekali melaporkan level 0 di Windows Terminal yang sebenarnya
 * mendukung truecolor (mis. `TERM` tidak diset). Fungsi ini memakai petunjuk
 * lingkungan yang andal untuk menaikkan level tersebut.
 *
 * @param {NodeJS.WriteStream} stream
 * @param {NodeJS.ProcessEnv} env
 * @returns {0|1|2|3} level warna yang wajar untuk lingkungan ini
 */
export function detectColorLevel(stream = process.stdout, env = process.env) {
  // FORCE_COLOR eksplisit harus menang atas heuristik TTY.
  if (env.FORCE_COLOR !== undefined) {
    const forced = String(env.FORCE_COLOR).toLowerCase();
    if (forced === '0' || forced === 'false' || forced === '') return 0;
    const level = Number(env.FORCE_COLOR);
    if (Number.isFinite(level) && level > 0) return Math.min(3, level);
    return 1;
  }
  if (!stream || !stream.isTTY) return 0; // pipa/redirect: jangan berwarna
  if (env.NO_COLOR) return 0; // pengguna sengaja mematikan warna

  const truecolor =
    Boolean(env.WT_SESSION) || // Windows Terminal
    /truecolor|24bit/i.test(env.COLORTERM || '') ||
    /truecolor/i.test(env.TERM || '');
  const has256 = truecolor || /256color/i.test(env.TERM || '');

  return truecolor ? 3 : has256 ? 2 : 1;
}

/**
 * Menaikkan level warna chalk bila chalk salah mendeteksi 0 padahal keluaran
 * menuju TTY sungguhan. Tidak pernah menurunkan level yang sudah terdeteksi.
 *
 * @returns {number} level chalk setelah koreksi
 */
export function ensureColorSupport(stream = process.stdout, env = process.env) {
  if (chalk.level === 0) {
    const detected = detectColorLevel(stream, env);
    if (detected > 0) chalk.level = detected;
  }
  return chalk.level;
}

// Dijalankan saat modul di-import. Modul ini HARUS di-import paling awal pada
// titik masuk CLI supaya berkas yang menghitung warna saat import (mis. logo
// Bawor) memakai level yang sudah benar, bukan level 0 bawaan.
ensureColorSupport();

/**
 * Pewarna tiruan yang tidak melakukan apa pun — dipakai saat stdout bukan
 * terminal sungguhan agar tidak ada escape code yang mengotori keluaran.
 *
 * Bentuknya superset dari kebutuhan semua modul (context, timeline, dsb.).
 * Daftar metode di bawah sengaja ditulis EKSPLISIT (bukan lewat Proxy) supaya
 * saat ada konsumen baru, kelonggaran painter ketahuan saat review — bukan
 * baru meledak saat runtime.
 */
export const NO_COLOR_PAINTER = (() => {
  const identity = (v) => String(v);
  identity.bold = identity;
  identity.dim = identity;
  identity.italic = identity;
  identity.underline = identity;
  identity.strikethrough = identity;
  identity.inverse = identity;
  identity.hidden = identity;
  identity.reset = identity;
  identity.red = identity;
  identity.green = identity;
  identity.yellow = identity;
  identity.blue = identity;
  identity.magenta = identity;
  identity.cyan = identity;
  identity.white = identity;
  identity.gray = identity;
  identity.whiteBright = identity;
  identity.greenBright = identity;
  identity.yellowBright = identity;
  identity.redBright = identity;
  identity.cyanBright = identity;
  identity.blueBright = identity;
  identity.magentaBright = identity;
  identity.bgRed = identity;
  identity.bgGreen = identity;
  identity.bgYellow = identity;
  identity.bgBlue = identity;
  identity.bgMagenta = identity;
  identity.bgCyan = identity;
  identity.bgWhite = identity;
  identity.bgBlack = identity;
  // Pembangun warna: hex()/rgb()/ansi256() harus mengembalikan fungsi yang
  // bisa langsung dipanggil, bukan objek biasa.
  identity.hex = () => identity;
  identity.rgb = () => identity;
  identity.ansi256 = () => identity;
  identity.bgHex = () => identity;
  identity.visible = false;
  return identity;
})();

/**
 * Membuat painter sesuai mode warna.
 *
 * Ini adalah SATU pintu masuk untuk semua modul yang butuh pewarna
 * opsional (context, timeline, planMode, dsb.). Modul tidak perlu lagi
 * menentukan sendiri "pakai chalk atau tidak" — cukup declarative.
 *
 * @param {boolean} useColor - true untuk keluaran berwarna
 * @returns {import('chalk').Chalk & Record<string, any>} painter siap pakai
 */
export function createPainter(useColor = true) {
  return useColor ? chalk : NO_COLOR_PAINTER;
}

export { chalk };
export default chalk;
