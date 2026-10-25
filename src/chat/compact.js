import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { estimateMessagesTokens, getContextUsage, clearRealTokenUsage } from './context.js';

/**
 * Membentuk teks riwayat percakapan yang siap dikirimkan ke model untuk dirangkum.
 *
 * @param {Array<{role:string, content:string, tool_calls?:Array}>} messages
 * @returns {string}
 */
export function formatHistoryForSummary(messages = []) {
  const nonSystem = messages.filter((m) => m && m.role !== 'system');
  const lines = [];

  for (const msg of nonSystem) {
    const roleLabel = msg.role === 'user' ? 'USER' : msg.role === 'assistant' ? 'AI' : 'TOOL';
    let text = typeof msg.content === 'string' ? msg.content.trim() : '';

    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      const calls = msg.tool_calls
        .map((tc) => `${tc?.function?.name || 'tool'}(${tc?.function?.arguments || ''})`)
        .join(', ');
      text = text ? `${text} [Panggilan Tool: ${calls}]` : `[Panggilan Tool: ${calls}]`;
    }

    if (msg.role === 'tool') {
      const shortContent = text.length > 200 ? `${text.slice(0, 197)}...` : text;
      lines.push(`TOOL (${msg.name || msg.tool_call_id || 'result'}): ${shortContent}`);
    } else if (text) {
      lines.push(`${roleLabel}: ${text}`);
    }
  }

  return lines.join('\n\n');
}

/**
 * Perangkum deterministik (offline fallback) bila panggilan LLM tidak tersedia atau gagal.
 * Mengekstrak riwayat interaksi, daftar tool yang dipanggil, dan file yang disentuh.
 *
 * @param {Array} messages
 * @returns {string}
 */
export function buildDeterministicSummary(messages = []) {
  const userPrompts = [];
  const toolsUsed = new Set();

  for (const m of messages) {
    if (m?.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      userPrompts.push(m.content.trim());
    }
    if (m?.tool_calls && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (tc?.function?.name) {
          toolsUsed.add(tc.function.name);
        }
      }
    }
  }

  const promptList = userPrompts.slice(-5).map((p, i) => `  ${i + 1}. ${p.length > 80 ? p.slice(0, 77) + '...' : p}`).join('\n');
  const toolsList = toolsUsed.size > 0 ? Array.from(toolsUsed).join(', ') : 'Tidak ada tool khusus';

  return `🎯 Ringkasan Konteks Sebelumnya (Auto-Compact Fallback):
- Riwayat Instruksi Terakhir:
${promptList || '  (Tidak ada instruksi khusus)'}
- Tool yang Dilibatkan: ${toolsList}
- Catatan: Riwayat obrolan lama telah dikompresi untuk menghemat ruang token. Lanjutkan pekerjaan berikutnya.`;
}

/**
 * Melakukan kompresi cerdas pada objek Conversation.
 * Mengganti riwayat panjang menjadi satu blok rangkuman status proyek yang padat.
 *
 * @param {object} conversation Instance Conversation
 * @param {object} [options]
 * @param {Function} [options.summarizeFn] Fungsi pemanggil LLM: async (historyText) => summaryText
 * @param {string} [options.model]
 * @param {string} [options.provider]
 * @returns {Promise<{compacted:boolean, reason?:string, tokensBefore?:number, tokensAfter?:number, savedTokens?:number, summary?:string}>}
 */
export async function compactConversation(
  conversation,
  { summarizeFn = null, model = null, provider = null, preserveLastUserPrompt = false } = {}
) {
  if (!conversation || !Array.isArray(conversation.messages)) {
    return { compacted: false, reason: 'Conversation tidak valid' };
  }

  // Cek apakah percakapan cukup panjang untuk dikompresi (minimal 1 pesan user & 1 respon)
  if (conversation.getUserTurnCount() < 1 || conversation.messages.length <= 2) {
    return { compacted: false, reason: 'Percakapan masih terlalu singkat untuk dirangkum' };
  }

  const tokensBefore = estimateMessagesTokens(conversation.messages);
  const historyText = formatHistoryForSummary(conversation.messages);

  let summary = '';
  if (typeof summarizeFn === 'function') {
    try {
      summary = await summarizeFn(historyText);
    } catch {
      summary = buildDeterministicSummary(conversation.messages);
    }
  } else {
    summary = buildDeterministicSummary(conversation.messages);
  }

  if (!summary || typeof summary !== 'string') {
    summary = buildDeterministicSummary(conversation.messages);
  }

  // Pertahankan system prompt di indeks 0
  const systemMsg = conversation.messages[0]?.role === 'system'
    ? conversation.messages[0]
    : { role: 'system', content: 'bAIwor Code System' };

  // Prompt user yang sedang dikerjakan harus tetap terlihat verbatim oleh
  // model. Tanpa ini, auto-compact di tengah giliran bisa mengganti request
  // aktif dengan rangkuman + balasan "siap", sehingga tugas tidak dikerjakan.
  let preservedUser = null;
  if (preserveLastUserPrompt) {
    for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
      if (conversation.messages[i]?.role === 'user') {
        preservedUser = conversation.messages[i];
        break;
      }
    }
  }

  // Ganti seluruh riwayat lama dengan rangkuman; prompt aktif (bila diminta)
  // ditempatkan setelah blok rangkuman.
  conversation.messages = [
    systemMsg,
    {
      role: 'user',
      content: `[Rangkuman Konteks Percakapan Sebelumnya]:\n${summary}`,
    },
    {
      role: 'assistant',
      content: 'Konteks sebelumnya telah dipahami dan disimpan. Silakan berikan instruksi selanjutnya, saya siap melanjutkan pekerjaan!',
      reasoning_content: 'Konteks sebelumnya telah diringkas dan dipahami.',
    },
    ...(preservedUser ? [preservedUser] : []),
  ];
  // Isi percakapan diganti rangkuman — snapshot usage provider lama tidak lagi
  // mewakili riwayat ini, bahkan bila kebetulan jumlah pesannya sama.
  clearRealTokenUsage();

  const tokensAfter = estimateMessagesTokens(conversation.messages);
  const savedTokens = Math.max(0, tokensBefore - tokensAfter);

  return {
    compacted: true,
    tokensBefore,
    tokensAfter,
    savedTokens,
    summary,
  };
}

export const AUTO_COMPACT_THRESHOLD = 0.8; // 80% dari context window

/**
 * Mengecek apakah percakapan sudah mencapai ambang batas auto-compact.
 *
 * @param {object} conversation Instance Conversation
 * @param {object} [options]
 * @param {number} [options.threshold=0.8] Rasio ambang batas (default: 0.8 = 80%)
 * @param {string} [options.model] Nama model aktif
 * @param {number} [options.contextWindow] Override ukuran context window
 * @returns {boolean}
 */
export function shouldAutoCompact(conversation, { threshold = AUTO_COMPACT_THRESHOLD, model = null, contextWindow = null } = {}) {
  if (!conversation || !Array.isArray(conversation.messages)) return false;
  if (conversation.getUserTurnCount() < 1 || conversation.messages.length <= 2) return false;

  const usage = getContextUsage(conversation.messages, { model, contextWindow });
  const ratio = usage.total > 0 ? usage.used / usage.total : 0;
  return ratio >= threshold;
}

/**
 * Jumlah file snapshot yang dipertahankan.
 */
const MAX_SNAPSHOT_FILES = 50;

/**
 * Menghapus snapshot lama agar direktori snapshot tidak tumbuh tanpa batas.
 *
 * Tanpa rotasi ini, setiap auto-compact menambah satu file permanen yang
 * tidak pernah dihapus (direktori snapshot juga dikecualikan dari daftar
 * sesi, jadi file-nya tidak terlihat pengguna).
 *
 * @param {string} snapDir
 */
function pruneOldSnapshots(snapDir) {
  try {
    const entries = fs
      .readdirSync(snapDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.startsWith('snapshot-'))
      .map((e) => {
        const full = path.join(snapDir, e.name);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {}
        return { full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (const stale of entries.slice(MAX_SNAPSHOT_FILES)) {
      try {
        fs.unlinkSync(stale.full);
      } catch {}
    }
  } catch {}
}

/**
 * Memicu pemadatan konteks otomatis jika penggunaan token melampaui ambang batas.
 * Otomatis mengambil snapshot sesi sebelum dirangkum agar riwayat asli tidak pernah hilang.
 *
 * @param {object} conversation Instance Conversation
 * @param {object} [options]
 * @param {number} [options.threshold=0.8]
 * @param {Function} [options.summarizeFn]
 * @param {string} [options.model]
 * @param {number} [options.contextWindow]
 * @param {Function} [options.snapshotFn] Fungsi snapshot kustom bila ada
 * @returns {Promise<{ triggered: boolean, snapshotPath?: string, percentBefore?: number, percentAfter?: number, tokensBefore?: number, tokensAfter?: number, savedTokens?: number, summary?: string, reason?: string }>}
 */
export async function autoCompactConversation(conversation, options = {}) {
  const { threshold = AUTO_COMPACT_THRESHOLD, model = null, contextWindow = null, snapshotFn = null } = options;

  if (!shouldAutoCompact(conversation, { threshold, model, contextWindow })) {
    return { triggered: false, reason: 'Penggunaan token masih di bawah ambang batas' };
  }

  const usageBefore = getContextUsage(conversation.messages, { model, contextWindow });
  const percentBefore = Math.round((usageBefore.used / usageBefore.total) * 100);

  // Buat snapshot sesi sebelum compact
  let snapshotPath = null;
  if (typeof snapshotFn === 'function') {
    try {
      snapshotPath = await snapshotFn(conversation);
    } catch {}
  } else {
    try {
      const snapDir = path.join(os.homedir(), '.baiwor', 'sessions', 'snapshots');
      fs.mkdirSync(snapDir, { recursive: true, mode: 0o700 });
      try {
        fs.chmodSync(snapDir, 0o700);
      } catch {}
      pruneOldSnapshots(snapDir);
      const safeSession = String(conversation.sessionId || 'session')
        .replace(/[^A-Za-z0-9_-]/g, '_')
        .slice(0, 80);
      const snapFile = `snapshot-${safeSession}-${Date.now()}.json`;
      snapshotPath = path.join(snapDir, snapFile);
      // Snapshot hanya menyimpan METADATA (peran + panjang isi), bukan isi
      // mentah. Sebelumnya seluruh `conversation.messages` ditulis apa adanya,
      // sehingga output tool seperti isi berkas `.env` atau file kredensial
      // ikut terduplikasi ke disk di luar berkas sesi.
      const metadata = (Array.isArray(conversation.messages) ? conversation.messages : []).map(
        (m) => ({
          role: m?.role || 'unknown',
          length: typeof m?.content === 'string' ? m.content.length : 0,
          hasToolCalls: Array.isArray(m?.tool_calls) && m.tool_calls.length > 0,
        })
      );
      fs.writeFileSync(
        snapshotPath,
        JSON.stringify({ sessionId: safeSession, createdAt: new Date().toISOString(), messages: metadata }, null, 2),
        {
          encoding: 'utf8',
          mode: 0o600,
        }
      );
    } catch {}
  }

  // Auto-compact terjadi setelah prompt user aktif ditambahkan; pertahankan
  // prompt itu agar request tidak hilang dari konteks model.
  const compactRes = await compactConversation(conversation, {
    ...options,
    preserveLastUserPrompt: true,
  });
  if (!compactRes.compacted) {
    return { triggered: false, reason: compactRes.reason };
  }

  const usageAfter = getContextUsage(conversation.messages, { model, contextWindow });
  const percentAfter = Math.round((usageAfter.used / usageAfter.total) * 100);

  return {
    triggered: true,
    snapshotPath,
    percentBefore,
    percentAfter,
    tokensBefore: compactRes.tokensBefore,
    tokensAfter: compactRes.tokensAfter,
    savedTokens: compactRes.savedTokens,
    summary: compactRes.summary,
  };
}
