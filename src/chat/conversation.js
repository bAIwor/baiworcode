import { getSystemPrompt } from './systemPrompt.js';

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
   * Memangkas riwayat jika terlalu panjang agar tidak melebihi context window,
   * dengan tetap mempertahankan system prompt di indeks pertama.
   */
  trim(maxMessages = 40) {
    if (this.messages.length <= maxMessages) return;
    const systemMsg = this.messages[0];
    const recentMessages = this.messages.slice(-(maxMessages - 1));
    this.messages = [systemMsg, ...recentMessages];
  }
}

// Instance sesi percakapan tunggal untuk sesi CLI aktif
export const conversationSession = new Conversation();
