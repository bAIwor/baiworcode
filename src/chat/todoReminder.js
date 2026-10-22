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
 * Jumlah panggilan tool bawaan sebelum model ditagih menyusun rencana, bila ia
 * sama sekali belum memakai `todo_list`. Adaptasi aturan mcode yang menuntut
 * `todowrite` wajib pada pekerjaan multi-langkah.
 */
export const DEFAULT_PLAN_NUDGE_TOOL_CALLS = 5;

/**
 * Membaca ambang nudge perencanaan dari environment.
 * Nilai tidak valid / kosong jatuh ke {@link DEFAULT_PLAN_NUDGE_TOOL_CALLS}.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function getPlanNudgeThreshold(env = process.env) {
  const raw = env?.BAIWOR_PLAN_NUDGE_TOOL_CALLS;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_PLAN_NUDGE_TOOL_CALLS;
  }
  const parsed = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PLAN_NUDGE_TOOL_CALLS;
}

/**
 * Menentukan apakah model perlu ditagih menyusun rencana.
 *
 * Dipicu berulang tiap kelipatan `threshold` panggilan tool selama model belum
 * menyusun daftar tugas sama sekali — jadi rencana tidak bisa "ditunda terus".
 *
 * @param {object} params
 * @param {number} params.toolCalls - Jumlah tool yang sudah dieksekusi pada giliran ini.
 * @param {number} params.lastNudgeAt - Nilai toolCalls saat nudge terakhir diberikan.
 * @param {number} [params.threshold]
 * @returns {boolean}
 */
export function shouldInjectPlanningNudge({
  toolCalls = 0,
  lastNudgeAt = 0,
  threshold = DEFAULT_PLAN_NUDGE_TOOL_CALLS,
} = {}) {
  const calls = Number.isFinite(toolCalls) ? Math.floor(toolCalls) : 0;
  const last = Number.isFinite(lastNudgeAt) ? Math.floor(lastNudgeAt) : 0;
  const step =
    Number.isFinite(threshold) && threshold > 0
      ? Math.floor(threshold)
      : DEFAULT_PLAN_NUDGE_TOOL_CALLS;
  return calls - last >= step;
}

/**
 * Menyusun teguran agar model menyusun rencana kerja lebih dulu.
 *
 * @param {object} params
 * @param {number} params.toolCalls
 * @returns {string}
 */
export function buildPlanningReminder({ toolCalls = 0 } = {}) {
  return [
    '<planning-reminder>',
    `Kamu sudah menjalankan ${toolCalls} panggilan tool tanpa pernah menyusun rencana di \`todo_list\`.`,
    'Berhenti sejenak dan panggil `todo_list` SEKARANG untuk memecah pekerjaan menjadi langkah-langkah konkret (minimal 3 item bila tugasnya multi-langkah).',
    'Tandai tepat satu item sebagai `in_progress`, perbarui statusnya seiring progres, dan jangan mengakhiri giliran sebelum daftar itu tuntas atau diperbarui.',
    '</planning-reminder>',
  ].join(' ');
}

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

/**
 * Teguran sekali saat model hendak menutup giliran dengan todo yang masih aktif.
 *
 * Berbeda dari {@link buildTodoReminder} yang berkala tiap beberapa giliran, ini
 * menargetkan momen "jawaban akhir": model harus memilih melanjutkan pekerjaan
 * atau menurunkan `in_progress` menjadi `pending` bila benar-benar menunggu
 * keputusan pengguna — supaya daftar tidak tampak menggantung.
 *
 * @param {{total:number, active:number}} stats
 * @returns {string}
 */
export function buildTodoTurnEndReminder(stats) {
  const { total = 0, active = 0 } = stats || {};
  return [
    '<todo-turn-end-reminder>',
    `Kamu hendak menutup giliran, tetapi masih ada ${active} dari ${total} item todo_list yang aktif.`,
    'Jangan mengakhiri giliran dengan item berstatus `in_progress` yang tidak sedang dikerjakan.',
    'Pilih salah satu: (a) lanjutkan pekerjaan yang tersisa sekarang, atau (b) bila menunggu keputusan pengguna, ubah item `in_progress` menjadi `pending` melalui todo_list lalu jawab singkat apa yang kamu tunggu.',
    '</todo-turn-end-reminder>',
  ].join(' ');
}
