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

export { chalk };
export default chalk;
