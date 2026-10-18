import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { estimateMessagesTokens, estimateTokens, getContextUsage } from './context.js';

export const COMPACT_SYSTEM_PROMPT = `Kamu adalah asisten perangkum memori konteks bAIwor Code.
Tugasmu adalah merangkum riwayat percakapan coding sebelumnya menjadi satu catatan status yang sangat padat, akurat, dan terstruktur.

Format rangkuman:
1. 🎯 Tujuan Utama & Permintaan Pengguna: (apa target yang sedang dikerjakan)
2. 📁 Berkas & Modifikasi Kode: (file apa saja yang sudah dibaca, dibuat, atau diubah)
3. ⚙️ Keputusan Teknis & Arsitektur: (library, format, atau aturan penting yang disepakati)
4. ⏳ Status Terkini & Langkah Selanjutnya: (apa yang sudah selesai dan apa yang masih tertunda)

Tulis dalam Bahasa Indonesia, to the point, padat informasi, tanpa basa-basi pembuka atau penutup.`;

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
export async function compactConversation(conversation, { summarizeFn = null, model = null, provider = null } = {}) {
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

  // Ganti seluruh riwayat lama dengan 1 pasangan rangkuman konteks
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
  ];

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
      fs.mkdirSync(snapDir, { recursive: true });
      const snapFile = `snapshot-${conversation.sessionId || 'session'}-${Date.now()}.json`;
      snapshotPath = path.join(snapDir, snapFile);
      fs.writeFileSync(snapshotPath, JSON.stringify(conversation.messages, null, 2), 'utf8');
    } catch {}
  }

  const compactRes = await compactConversation(conversation, options);
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
