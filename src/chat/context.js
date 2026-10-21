import { createPainter } from '../colors.js';
/**
 * Estimasi pemakaian context window.
 *
 * bAIwor Code sengaja TIDAK mengambil `usage` dari API. Sebagian besar
 * endpoint OpenAI-compatible hanya mengirim hitungan token kalau diminta lewat
 * `stream_options: { include_usage: true }`, dan tidak semuanya mendukungnya.
 * Lebih jauh, model kustom seperti `gemini-3.8-flash-high` tidak punya angka
 * context window yang bisa kita kutip dengan jujur.
 *
 * Jadi angka di sini adalah ESTIMASI dari jumlah karakter, bukan hasil hitungan.
 * Nilainya cocok untuk memberi gambaran berapa konteks yang tersisa, bukan untuk
 * keputusan presisi. Karena itu setiap label memakai tanda `≈` dan tidak pernah
 * disajikan sebagai fakta pasti.
 */

/** Rata-rata karakter per token untuk teks Latin/Indonesia. */
export const CHARS_PER_TOKEN = 4;

/** Context window default bila model tidak dikenali. */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * Peta kasar context window per family model.
 * Dicocokkan dengan `includes()` karena nama model biasanya berawalan family's.
 * Nilai yang tidak tercantum memakai DEFAULT_CONTEXT_WINDOW.
 */
const CONTEXT_WINDOWS = [
  { match: 'beam', window: 1000000 },
  { match: 'reflection', window: 1000000 },
  { match: 'gemini', window: 1000000 },
  { match: 'gpt-4o', window: 128000 },
  { match: 'gpt-4.1', window: 1000000 },
  { match: 'gpt-5', window: 400000 },
  { match: 'claude', window: 200000 },
  { match: 'deepseek', window: 128000 },
  { match: 'qwen', window: 128000 },
  { match: 'llama', window: 128000 },
  { match: 'mistral', window: 128000 },
  { match: 'grok', window: 131072 },
  { match: 'step', window: 128000 },
];

/**
 * Menentukan context window untuk sebuah model.
 *
 * @param {string|null|undefined} model
 * @returns {number}
 */
export function resolveContextWindow(model) {
  const name = String(model || '').toLowerCase();
  if (!name) return DEFAULT_CONTEXT_WINDOW;
  const hit = CONTEXT_WINDOWS.find((entry) => name.includes(entry.match));
  return hit ? hit.window : DEFAULT_CONTEXT_WINDOW;
}

/**
 * Memperkirakan jumlah token dari panjang teks.
 *
 * @param {string|null|undefined} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  if (Array.isArray(text)) {
    let total = 0;
    for (const part of text) {
      if (part?.type === 'text') total += estimateTokens(part.text);
      else if (part?.type === 'image_url') total += 500;
    }
    return total;
  }
  const length = String(text).length;
  if (length === 0) return 0;
  return Math.ceil(length / CHARS_PER_TOKEN);
}

/**
 * Memperkirakan token yang dipakai satu pesan.
 * `tool_calls` ikut dihitung karena ikut dikirim dan bisa berukuran besar.
 *
 * @param {object} message
 * @returns {number}
 */
export function estimateMessageTokens(message) {
  if (!message || typeof message !== 'object') return 0;

  let total = estimateTokens(message.content);

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    // Round-trip lewat JSON menangkap nama fungsi, argumen, dan id sekaligus.
    total += estimateTokens(JSON.stringify(message.tool_calls));
  }
  if (message.name) total += estimateTokens(message.name);
  if (message.tool_call_id) total += estimateTokens(message.tool_call_id);
  if (message.reasoning_content) total += estimateTokens(message.reasoning_content);

  // Setiap pesan membawa overhead role dan pembatas — kecil, tapi menumpuk.
  return total + 4;
}

/**
 * Memperkirakan total token dari seluruh daftar pesan.
 *
 * @param {Array<object>} messages
 * @returns {number}
 */
export function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

/**
 * Menghitung potongan pemakaian context.
 *
 * @param {Array<object>} messages
 * @param {{model?:string, contextWindow?:number}} [options]
 * @returns {{used:number, total:number, remaining:number, percentLeft:number, percentUsed:number, overBudget:boolean}}
 */
export function getContextUsage(messages, { model = null, contextWindow = null } = {}) {
  const total = Number.isFinite(contextWindow) && contextWindow > 0
    ? contextWindow
    : resolveContextWindow(model);
  const used = estimateMessagesTokens(messages);
  const remaining = Math.max(0, total - used);
  const percentLeft = total > 0 ? Math.round((remaining / total) * 100) : 0;

  return {
    used,
    total,
    remaining,
    percentLeft,
    percentUsed: 100 - percentLeft,
    overBudget: used > total,
  };
}

/**
 * Format label untuk status bar / baris konteks.
 * Angka dibulatkan ke ribuan terdekat agar tidak memberi presisi palsu.
 *
 * @param {{used:number,total:number,percentLeft:number,overBudget?:boolean}} usage
 * @param {{useColor?:boolean, detail?:boolean}} [options]
 * @returns {string}
 */
export function formatContextIndicator(usage, { useColor = true, detail = true } = {}) {
  if (!usage || typeof usage !== 'object') return '';
  const c = createPainter(useColor);

  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  const percent = Math.max(0, Math.min(100, usage.percentLeft ?? 0));

  let tone;
  if (usage.overBudget || percent <= 10) tone = c.red;
  else if (percent <= 25) tone = c.yellow;
  else tone = c.green;

  const base = tone(`Konteks ${percent}% tersisa`);
  // Rincian token adalah bagian pertama yang dikorbankan saat terminal sempit.
  if (!detail) return base;
  return `${base} ${c.gray(`≈ ${k(usage.used)}/${k(usage.total)} token`)}`;
}

/**
 * Pesan peringatan ketika konteks menipis.
 *
 * @param {{percentLeft:number,overBudget?:boolean}} usage
 * @param {{useColor?:boolean}} [options]
 * @returns {string} string kosong bila konteks masih lega
 */
export function formatContextWarning(usage, { useColor = true } = {}) {
  if (!usage || typeof usage !== 'object') return '';
  const c = createPainter(useColor);
  const percent = Math.max(0, Math.min(100, usage.percentLeft ?? 0));

  if (usage.overBudget) {
    return c.red(`⚠️  Konteks melebihi batas (${percent}% tersisa). Riwayat dipangkas otomatis — pertimbangkan ${c.bold('/clear')} untuk sesi baru.`);
  }
  if (percent <= 10) {
    return c.red(`⚠️  Konteks tinggal ${percent}% — pertimbangkan ${c.bold('/clear')} agar jawaban tetap tajam.`);
  }
  if (percent <= 25) {
    return c.yellow(`⚡ Konteks tinggal ${percent}%. Gunakan ${c.bold('/clear')} bila jawaban terasa kehilangan awalan.`);
  }
  return '';
}
