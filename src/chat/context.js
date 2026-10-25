import { createPainter } from '../colors.js';
import { palette } from '../theme.js';
/**
 * Estimasi pemakaian context window — dengan penajam usage provider.
 *
 * Dasarnya tetap estimasi karakter (±4 karakter/token) karena tidak semua
 * endpoint mengirim hitungan token. Namun bila provider MENGIRIM `usage` di
 * chunk SSE terakhir (DeepSeek, Groq, vLLM, dsb. — ditangkap pasif oleh
 * client tanpa meminta stream_options), angka ASLI itu dipakai sebagai basis:
 * exact saat jumlah pesan belum berubah, dan basis + estimasi delta saat
 * riwayat bertambah. Label `≈` hanya muncul saat angka masih mengandung
 * estimasi; angka real ditampilkan tanpa `≈`.
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
 * Estimasi token untuk satu part gambar.
 *
 * Sebelumnya semua gambar dihitung.flat 500 token. Gambar 5 MB menjadi ~6,7 MB
 * base64 (≈1,7 juta token) tetapi dihitung 500 token, sehingga trim/compact
 * tidak pernah terpicu dan request menembus batas konteks provider (HTTP 400).
 * Sekarang estimasi diturunkan dari ukuran data base64 yang benar-benar
 * dikirim, dibatasi bawah agar model gambar kecil tetap punya biaya wajar.
 *
 * @param {object} part
 * @returns {number}
 */
export function estimateImageTokens(part) {
  const url = part?.image_url?.url || part?.image_url || '';
  if (typeof url !== 'string' || !url) return 500;

  // Data URL: decode panjang base64 tanpa membuat salinan buffer besar.
  const base64Match = /^data:[^;]*;base64,(.*)$/s.exec(url);
  if (base64Match) {
    const b64Len = base64Match[1].length;
    const bytes = Math.floor((b64Len * 3) / 4);
    // ~1 token per 750 byte untuk representasi gambar generik.
    return Math.max(85, Math.ceil(bytes / 750));
  }

  // URL eksternal: biaya tidak diketahui → pakai nilai konservatif.
  return 1100;
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
      else if (part?.type === 'image_url') total += estimateImageTokens(part);
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
 * Snapshot usage terakhir yang dilaporkan provider. `prompt_tokens` adalah
 * hitungan token ASLI dari request terakhir — pasangan `messageCount` menyimpan
 * panjang daftar pesan saat angka itu diambil, sehingga angka tetap sahih
 * selama riwayat hanya bertambah (basis real + estimasi delta).
 */
let realUsage = null;

/**
 * Mencatat usage asli dari provider (dipanggil setelah tiap model turn).
 *
 * @param {{promptTokens:number, messageCount:number}} info
 */
export function noteRealTokenUsage({ promptTokens, messageCount } = {}) {
  if (!Number.isFinite(promptTokens) || promptTokens <= 0) return;
  if (!Number.isFinite(messageCount) || messageCount < 0) return;
  realUsage = { promptTokens: Math.round(promptTokens), messageCount };
}

/**
 * Membuang snapshot usage real. Dipanggil saat percakapan diganti/direset,
 * saat riwayat di-compact, atau oleh pengujian.
 */
export function clearRealTokenUsage() {
  realUsage = null;
}

/**
 * Menghitung potongan pemakaian context.
 *
 * @param {Array<object>} messages
 * @param {{model?:string, contextWindow?:number}} [options]
 * @returns {{used:number, total:number, remaining:number, percentLeft:number, percentUsed:number, overBudget:boolean, source:'real'|'blended'|'estimate'}}
 */
export function getContextUsage(messages, { model = null, contextWindow = null } = {}) {
  const total = Number.isFinite(contextWindow) && contextWindow > 0
    ? contextWindow
    : resolveContextWindow(model);
  const estimated = estimateMessagesTokens(messages);

  let used = estimated;
  let source = 'estimate';
  if (realUsage) {
    if (messages.length === realUsage.messageCount) {
      // Riwayat persis seperti saat provider menghitung → angka exact.
      used = realUsage.promptTokens;
      source = 'real';
    } else if (messages.length > realUsage.messageCount) {
      // Riwayat bertambah (hasil tool dsb.): basis real + estimasi tambahan.
      const delta = estimateMessagesTokens(messages.slice(realUsage.messageCount));
      used = realUsage.promptTokens + delta;
      source = 'blended';
    } else {
      // Riwayat menyusut (trim/compact/clear) → angka lama tak berlaku lagi.
      realUsage = null;
    }
  }

  const remaining = Math.max(0, total - used);
  const percentLeft = total > 0 ? Math.round((remaining / total) * 100) : 0;

  return {
    used,
    total,
    remaining,
    percentLeft,
    percentUsed: 100 - percentLeft,
    overBudget: used > total,
    source,
  };
}

/** Jumlah sel meter konteks. */
const METER_CELLS = 10;

/**
 * Warna meter per tingkat sisa konteks: lega → sempit.
 * @param {number} percentLeft
 * @returns {string} hex palet tema
 */
function meterToneHex(percentLeft) {
  if (percentLeft > 60) return palette.success; // hijau mint — lega
  if (percentLeft > 30) return palette.warning; // emas — mulai waspada
  if (percentLeft > 15) return palette.primary; // peach — menipis
  return palette.error; // merah — kritis
}

/**
 * Format label untuk status bar / baris konteks, dengan meter gradient:
 *
 *   Konteks ▓▓▓▓▓▓▓▓░░ 82%
 *
 * Bar menunjukkan porsi TERSISA dan berubah warna (hijau → emas → peach →
 * merah) saat konteks menyempit. Angka dibulatkan ke ribuan terdekat agar
 * tidak memberi presisi palsu; tanda `≈` hanya tampil bila angka masih
 * mengandung estimasi (angka real dari provider tampil tanpa `≈`).
 *
 * @param {{used:number,total:number,percentLeft:number,overBudget?:boolean,source?:string}} usage
 * @param {{useColor?:boolean, detail?:boolean}} [options]
 * @returns {string}
 */
export function formatContextIndicator(usage, { useColor = true, detail = true } = {}) {
  if (!usage || typeof usage !== 'object') return '';
  const c = createPainter(useColor);

  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  const percent = Math.max(0, Math.min(100, usage.percentLeft ?? 0));

  const tone = c.hex(meterToneHex(percent));
  const filled = Math.round((percent / 100) * METER_CELLS);
  const meter = '▓'.repeat(filled) + '░'.repeat(Math.max(0, METER_CELLS - filled));

  const base = tone(`Konteks ${meter} ${percent}%`);
  // Rincian token adalah bagian pertama yang dikorbankan saat terminal sempit.
  if (!detail) return base;
  const approx = usage.source === 'real' ? '' : '≈ ';
  return `${base} ${c.gray(`${approx}${k(usage.used)}/${k(usage.total)} token`)}`;
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
