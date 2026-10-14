import { getSystemPrompt } from './systemPrompt.js';
import { estimateMessagesTokens, resolveContextWindow } from './context.js';

/**
 * Pengelola riwayat percakapan (Conversation History) multi-turn.
 * Dirancang kompatibel dengan format pesan OpenAI Chat Completions
 * serta siap menerima tool_calls & role 'tool' untuk Tahap 3B.
 */
export class Conversation {
  constructor() {
    this.messages = [];
    this.reset();
  }

  /**
   * Mengosongkan riwayat percakapan dan menginisialisasi ulang dengan System Prompt.
   */
  reset() {
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
   * Mendukung opsi tool_calls untuk persiapan Tahap 3B.
   */
  addAssistantMessage(content, toolCalls = null) {
    const msg = {
      role: 'assistant',
      content: content || '',
    };
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      msg.tool_calls = toolCalls;
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
}

// Instance sesi percakapan tunggal untuk sesi CLI aktif
export const conversationSession = new Conversation();
