/**
 * Pengingat penyelesaian daftar tugas (TODO).
 *
 * Adaptasi mekanisme `<task-completion-reminder>` dari MiniMax Code: selama
 * masih ada item `todo_list` yang aktif (`pending`/`in_progress`), model ditagih
 * secara berkala agar tidak menyatakan tugas tuntas sebelum semua item beres.
 *
 * Modul ini sengaja bebas dependensi dan menerima masukan sebagai argumen supaya
 * mudah diuji tanpa menyentuh state global.
 */

/** Interval giliran bawaan antar pengingat (bisa ditimpa lewat env). */
export const DEFAULT_TODO_REMINDER_INTERVAL = 5;

/**
 * Membaca interval pengingat dari environment.
 * Nilai tidak valid / kosong jatuh ke {@link DEFAULT_TODO_REMINDER_INTERVAL}.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function getTodoReminderInterval(env = process.env) {
  const raw = env?.BAIWOR_TODO_REMINDER_INTERVAL;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_TODO_REMINDER_INTERVAL;
  }
  const parsed = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TODO_REMINDER_INTERVAL;
}

/**
 * Meringkas status daftar tugas.
 *
 * @param {Array<{status?:string}>} items
 * @returns {{total:number, completed:number, cancelled:number, active:number}}
 */
export function summarizeTodos(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const total = list.length;
  const completed = list.filter((i) => i?.status === 'completed').length;
  const cancelled = list.filter((i) => i?.status === 'cancelled').length;
  return { total, completed, cancelled, active: total - completed - cancelled };
}

/**
 * Menentukan apakah pengingat perlu disuntikkan pada giliran ke-`turnCount`.
 *
 * @param {number} turnCount
 * @param {number} [interval]
 * @returns {boolean}
 */
export function shouldInjectTodoReminder(turnCount, interval = DEFAULT_TODO_REMINDER_INTERVAL) {
  const turn = Number.isFinite(turnCount) ? Math.floor(turnCount) : 0;
  const step =
    Number.isFinite(interval) && interval > 0
      ? Math.floor(interval)
      : DEFAULT_TODO_REMINDER_INTERVAL;
  return turn > 0 && turn % step === 0;
}

/**
 * Menyusun teks pengingat untuk disuntikkan ke konteks model.
 *
 * @param {{total:number, completed:number, cancelled:number, active:number}} stats
 * @returns {string}
 */
export function buildTodoReminder(stats) {
  const { total = 0, active = 0, completed = 0, cancelled = 0 } = stats || {};
  return [
    '<task-completion-reminder>',
    `Masih ada item todo_list yang aktif (${active}/${total} aktif; ${completed} selesai, ${cancelled} dibatalkan).`,
    'Jangan menyatakan tugas tuntas selama masih ada item berstatus `pending` atau `in_progress`.',
    'Lanjutkan pekerjaan yang belum selesai, atau perbarui `todo_list`: tandai pekerjaan yang benar-benar selesai sebagai `completed` dan yang sudah tidak relevan sebagai `cancelled`.',
    '</task-completion-reminder>',
  ].join(' ');
}
