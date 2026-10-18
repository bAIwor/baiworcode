import { getSystemPrompt } from './systemPrompt.js';
import { estimateMessagesTokens, resolveContextWindow } from './context.js';
import {
  generateSessionId,
  deriveSessionTitle,
  saveSession,
  loadSession,
  getLatestSession,
} from './sessionManager.js';

/**
 * Pengelola riwayat percakapan (Conversation History) multi-turn.
 * Dirancang kompatibel dengan format pesan OpenAI Chat Completions
 * serta siap menerima tool_calls & role 'tool' untuk Tahap 3B.
 */
export class Conversation {
  constructor() {
    this.messages = [];
    this.sessionId = null;
    this.sessionTitle = null;
    this.reset();
  }

  /**
   * Mengosongkan riwayat percakapan dan menginisialisasi ulang dengan System Prompt.
   */
  reset() {
    this.sessionId = generateSessionId();
    this.sessionTitle = null;
    this.messages = [
      {
        role: 'system',
        content: getSystemPrompt(),
      },
    ];
  }

  /**
   * Memperbarui pesan system prompt (misal jika working directory berubah).
   */
  refreshSystemPrompt() {
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0].content = getSystemPrompt();
    } else {
      this.messages.unshift({
        role: 'system',
        content: getSystemPrompt(),
      });
    }
  }

  /**
   * Menambahkan pesan dari pengguna.
   */
  addUserMessage(content) {
    if (!content || typeof content !== 'string') return;
    this.messages.push({
      role: 'user',
      content: content.trim(),
    });
  }

  /**
   * Menambahkan pesan balasan asisten (AI).
   * Mendukung opsi tool_calls dan reasoning_content (untuk model penalaran/thinking).
   *
   * @param {string|object} content - Konten teks atau objek pesan lengkap
   * @param {Array|null} [toolCalls=null] - Daftar tool_calls jika ada
   * @param {string|null} [reasoningContent=null] - Konten reasoning/thinking jika ada
   * @returns {object}
   */
  addAssistantMessage(content, toolCalls = null, reasoningContent = null) {
    let msgContent = content;
    let msgToolCalls = toolCalls;
    let msgReasoning = reasoningContent;

    if (content && typeof content === 'object' && !Array.isArray(content)) {
      msgContent = content.content || '';
      msgToolCalls = toolCalls || content.tool_calls || content.toolCalls || null;
      msgReasoning = reasoningContent || content.reasoning_content || content.reasoning || null;
    }

    const msg = {
      role: 'assistant',
      content: typeof msgContent === 'string' ? msgContent : '',
    };
    if (msgToolCalls && Array.isArray(msgToolCalls) && msgToolCalls.length > 0) {
      msg.tool_calls = msgToolCalls;
    }
    if (msgReasoning && typeof msgReasoning === 'string' && msgReasoning.length > 0) {
      msg.reasoning_content = msgReasoning;
    }
    this.messages.push(msg);
    return msg;
  }

  /**
   * Menambahkan hasil eksekusi tool (persiapan Tahap 3B).
   */
  addToolResult(toolCallId, content, name = null) {
    const msg = {
      role: 'tool',
      tool_call_id: toolCallId,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    };
    if (name) {
      msg.name = name;
    }
    this.messages.push(msg);
    return msg;
  }

  /**
   * Mengambil salinan array pesan yang siap dikirimkan ke API LLM.
   */
  getMessages() {
    return this.messages.map((m) => {
      const copy = { role: m.role, content: m.content };
      if (m.tool_calls) copy.tool_calls = m.tool_calls;
      if (m.tool_call_id) copy.tool_call_id = m.tool_call_id;
      if (m.name) copy.name = m.name;
      if (m.reasoning_content !== undefined) copy.reasoning_content = m.reasoning_content;
      return copy;
    });
  }

  /**
   * Menghitung jumlah giliran percakapan user.
   */
  getUserTurnCount() {
    return this.messages.filter((m) => m.role === 'user').length;
  }

  /**
   * Menghapus pesan user terakhir dari riwayat.
   * Dipakai untuk rollback ketika request gagal, agar prompt yang gagal
   * tidak mengotori konteks percakapan berikutnya.
   * Pemindaian berhenti di system prompt sehingga konteks dasar tetap utuh.
   *
   * @returns {boolean} true jika ada pesan user yang dihapus.
   */
  removeLastUserMessage() {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const role = this.messages[i].role;
      if (role === 'user') {
        this.messages.splice(i, 1);
        return true;
      }
      if (role === 'system') break;
    }
    return false;
  }

  /**
   * Mengosongkan riwayat percakapan (nama publik untuk reset()).
   * Disiapkan agar pemanggil tidak perlu menyentuh properti internal.
   */
  clearHistory() {
    this.reset();
  }

  /**
   * Memangkas riwayat jika terlalu panjang agar tidak melebihi context window,
   * dengan tetap mempertahankan system prompt di indeks pertama.
   */
  trim(maxMessages = 40) {
    if (this.messages.length <= maxMessages) return;
    const systemMsg = this.messages[0];
    const recentMessages = this.messages.slice(-(maxMessages - 1));
    this.messages = [systemMsg, ...recentMessages];
  }

  /**
   * Memangkas riwayat berdasarkan perkiraan token, bukan jumlah pesan.
   *
   * `trim(maxMessages)` menghitung pesan, padahal ukuran tiap pesan bisa
   * berbeda jauh: satu hasil `read_file` bisa 40.000 karakter sementara
   * balasan pendek hanya beberapa ratus. Karena itu pemangkasan berbasis
   * pesan bisa menembus context window dan membuat request ditolak provider.
   *
   * Pemangkasan dilakukan dari depan (pesan terlama dibuang lebih dulu) dan
   * system prompt selalu dipertahankan. Pesan `tool` tidak pernah dilepas dari
   * pesan `assistant` yang memanggilnya — memotong pasangan itu membuat
   * provider menolak request dengan error "tool message without tool_call_id".
   *
   * @param {number} [budgetTokens]
   * @param {{model?:string, contextWindow?:number}} [options]
   * @returns {{trimmed:boolean, removed:number, stillOverBudget:boolean}}
   */
  trimToTokenBudget(budgetTokens, { model = null, contextWindow = null } = {}) {
    const base =
      Number.isFinite(contextWindow) && contextWindow > 0
        ? contextWindow
        : resolveContextWindow(model);

    // Sisakan 20% ruang supaya balasan model masih muat setelah riwayat dipangkas.
    const budget =
      Number.isFinite(budgetTokens) && budgetTokens > 0 ? budgetTokens : base * 0.8;

    const before = this.messages.length;
    if (estimateMessagesTokens(this.messages) <= budget) {
      return { trimmed: false, removed: 0, stillOverBudget: false };
    }

    const hasSystem = this.messages[0]?.role === 'system';
    const systemMsg = hasSystem ? this.messages[0] : null;
    const body = hasSystem ? this.messages.slice(1) : this.messages.slice();

    let start = 0;
    while (start < body.length) {
      const candidate = systemMsg ? [systemMsg, ...body.slice(start)] : body.slice(start);
      if (estimateMessagesTokens(candidate) <= budget) break;

      const dropped = body[start];
      start += 1;

      // Hasil tool menempel pada pesan assistant yang memanggilnya. Membuang
      // pemanggil tanpa membuang hasilnya membuat provider menolak request.
      if (dropped?.role === 'assistant' && Array.isArray(dropped.tool_calls) && dropped.tool_calls.length > 0) {
        while (start < body.length && body[start].role === 'tool') start += 1;
      }
    }

    this.messages = systemMsg ? [systemMsg, ...body.slice(start)] : body.slice(start);

    return {
      trimmed: true,
      removed: before - this.messages.length,
      stillOverBudget: estimateMessagesTokens(this.messages) > budget,
    };
  }

  /**
   * Menyimpan sesi aktif ke disk.
   * Hanya menyimpan jika sudah ada interaksi user (tidak menyimpan sesi kosong).
   *
   * @param {object} [options]
   * @param {string} [options.model]
   * @param {string} [options.provider]
   * @param {string} [options.projectPath]
   * @param {string} [options.baseConfigDir]
   * @returns {object|null}
   */
  saveToDisk({ model = null, provider = null, projectPath = process.cwd(), baseConfigDir } = {}) {
    if (this.getUserTurnCount() === 0) return null;
    return saveSession(
      {
        id: this.sessionId,
        title: this.sessionTitle || deriveSessionTitle(this.messages),
        model,
        provider,
        messages: this.messages,
      },
      { projectPath, baseConfigDir }
    );
  }

  /**
   * Memuat sesi dari disk berdasarkan ID sesi.
   *
   * @param {string} sessionId
   * @param {object} [options]
   * @param {string} [options.projectPath]
   * @param {string} [options.baseConfigDir]
   * @returns {boolean}
   */
  loadFromDisk(sessionId, { projectPath = process.cwd(), baseConfigDir } = {}) {
    const data = loadSession(sessionId, { projectPath, baseConfigDir });
    if (!data || !Array.isArray(data.messages)) return false;
    this.sessionId = data.id;
    this.sessionTitle = data.title || null;
    this.messages = data.messages;
    repairLegacyAssistantReasoning(this.messages);
    return true;
  }

  /**
   * Melanjutkan sesi terakhir yang paling baru diupdate untuk proyek ini.
   *
   * @param {object} [options]
   * @param {string} [options.projectPath]
   * @param {string} [options.baseConfigDir]
   * @returns {boolean}
   */
  resumeLatest({ projectPath = process.cwd(), baseConfigDir } = {}) {
    const data = getLatestSession({ projectPath, baseConfigDir });
    if (!data || !Array.isArray(data.messages)) return false;
    this.sessionId = data.id;
    this.sessionTitle = data.title || null;
    this.messages = data.messages;
    repairLegacyAssistantReasoning(this.messages);
    return true;
  }
}

/**
 * Memperbaiki pesan asisten dari sesi lama yang belum membukukan
 * `reasoning_content`.
 *
 * Model penalaran (Reflection, DeepSeek R1, maupun reasoning model lain)
 * menolak payload dengan error "Missing required parameter: reasoning_content"
 * bila salah satu pesan asisten tidak membawanya. Tanpa perbaikan di sini,
 * setiap giliran pada sesi resume membayar satu request 400 terbuang sebelum
 * auto-recovery di `client.js` berhasil. Perbaikan mengisi string kosong `''`
 * — sama seperti patch auto-recovery — hanya pada pesan yang memang belum
 * punya propertinya; reasoning asli tidak pernah diganggu.
 *
 * @param {Array} messages - Array pesan (dimutasi di tempat)
 * @returns {number} Jumlah pesan asisten yang diperbaiki
 */
export function repairLegacyAssistantReasoning(messages) {
  if (!Array.isArray(messages)) return 0;
  let repaired = 0;
  for (const m of messages) {
    if (m && m.role === 'assistant' && typeof m.reasoning_content !== 'string') {
      m.reasoning_content = '';
      repaired += 1;
    }
  }
  return repaired;
}

// Instance sesi percakapan tunggal untuk sesi CLI aktif
export const conversationSession = new Conversation();
