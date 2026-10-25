import { getPresenterStats } from './presenter.js';

/**
 * Statistik ringkas satu sesi duduk (satu proses REPL) — dipakai kuitansi
 * saat /exit. Akumulasi sepanjang proses berjalan; /clear TIDAK meresetnya
 * (pengguna masih dalam sesi duduk yang sama, kerjanya tetap satu kuitansi).
 */

const state = {
  startedAt: Date.now(),
  userTurns: 0,
  toolCalls: 0,
  writtenFiles: new Set(),
  editedFiles: new Set(),
};

/** Menandai satu giliran pengguna (satu prompt masuk). */
export function recordUserTurn() {
  state.userTurns += 1;
}

/**
 * Mencatat satu pemanggilan tool. Tool tulis berkas memperbarui himpunan
 * berkas yang ditulis/diedit supaya kuitansi bisa menyebut berapa berkas
 * tersentuh.
 *
 * @param {string} name
 * @param {object} [args]
 */
export function recordToolCall(name, args = {}) {
  state.toolCalls += 1;
  const file = args && typeof args.file_path === 'string' ? args.file_path : null;
  if (!file) return;
  if (name === 'write_file') state.writtenFiles.add(file);
  else if (name === 'edit_file' || name === 'patch_file') state.editedFiles.add(file);
}

/** Mengembalikan statistik sesi saat ini (salinan aman). */
export function getSessionSummary() {
  return {
    durationMs: Date.now() - state.startedAt,
    userTurns: state.userTurns,
    toolCalls: state.toolCalls,
    writtenCount: state.writtenFiles.size,
    editedCount: state.editedFiles.size,
    presenters: getPresenterStats(),
  };
}

/** Reset penuh — untuk pengujian. */
export function resetSessionStats() {
  state.startedAt = Date.now();
  state.userTurns = 0;
  state.toolCalls = 0;
  state.writtenFiles = new Set();
  state.editedFiles = new Set();
}

/**
 * Memformat durasi pendek untuk kuitansi: "47 menit", "2 jam 5 mnt", "12 detik".
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) {
    const seconds = Math.max(1, Math.floor(ms / 1000));
    return `${seconds} detik`;
  }
  if (totalMinutes < 60) return `${totalMinutes} menit`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} jam ${minutes} mnt` : `${hours} jam`;
}

/**
 * Waktu relatif singkat: "baru saja", "2 jam lalu", "3 hari lalu".
 *
 * @param {number|Date} timestamp
 * @returns {string}
 */
export function formatRelativeTime(timestamp) {
  const time = timestamp instanceof Date ? timestamp.getTime() : Number(timestamp);
  if (!Number.isFinite(time)) return '-';
  const diffMs = Date.now() - time;
  if (diffMs < 60_000) return 'baru saja';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}
