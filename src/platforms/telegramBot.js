import { EventEmitter } from 'node:events';

/**
 * Telegram Bot Platform untuk bAIwor Code.
 *
 * Integrasi dengan Telegram Bot API menggunakan node-telegram-bot-api.
 * Menerima pesan dari user dan mengirim response dari bAIwor.
 *
 * Features:
 * - Long polling untuk menerima pesan real-time
 * - Support untuk text messages
 * - Markdown formatting untuk response
 * - Typing indicator saat memproses
 *
 * Requirements:
 * - npm install node-telegram-bot-api
 * - Bot token dari @BotFather
 */

export class TelegramBot extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {number} [options.pollingInterval=1000] - Interval polling dalam ms
   */
  constructor(options = {}) {
    super();
    this.bot = null;
    this.pollingInterval = options.pollingInterval || 1000;
    this.running = false;
  }

  /**
   * Start Telegram bot dengan token yang diberikan.
   *
   * @param {{botToken: string}} config
   */
  async start(config) {
    if (!config.botToken) {
      throw new Error('botToken is required for Telegram bot');
    }

    // Dynamic import untuk menghindari error jika package belum diinstall
    let TelegramBotAPI;
    try {
      const module = await import('node-telegram-bot-api');
      TelegramBotAPI = module.default || module;
    } catch (err) {
      throw new Error(
        'node-telegram-bot-api belum diinstall. Jalankan: npm install node-telegram-bot-api'
      );
    }

    this.bot = new TelegramBotAPI(config.botToken, {
      polling: {
        interval: this.pollingInterval,
        params: {
          timeout: 10,
        },
      },
    });

    this.running = true;

    // Listen untuk pesan masuk
    this.bot.on('message', (msg) => {
      this.#handleMessage(msg);
    });

    // Listen untuk error
    this.bot.on('error', (err) => {
      console.error('[Telegram] Error:', err.message);
      this.emit('error', err);
    });

    // Get bot info
    try {
      const me = await this.bot.getMe();
      console.log(`[Telegram] Bot started: @${me.username} (${me.first_name})`);
    } catch (err) {
      console.error('[Telegram] Gagal mendapatkan bot info:', err.message);
    }
  }

  /**
   * Handle pesan masuk dari Telegram.
   *
   * @param {Object} msg - Telegram message object
   */
  #handleMessage(msg) {
    // Skip jika bukan text message
    if (!msg.text) return;

    // Skip jika pesan dari bot itu sendiri
    if (msg.from?.is_bot) return;

    const chatId = msg.chat.id.toString();
    const text = msg.text;
    const messageId = msg.message_id.toString();

    // Emit message event
    this.emit('message', {
      chatId,
      text,
      messageId,
      metadata: {
        from: msg.from,
        chat: msg.chat,
        date: msg.date,
      },
    });
  }

  /**
   * Stop Telegram bot.
   */
  async stop() {
    if (!this.bot) return;

    this.running = false;
    await this.bot.stopPolling();
    this.bot = null;
    console.log('[Telegram] Bot stopped');
  }

  /**
   * Kirim pesan ke chat tertentu.
   *
   * @param {string} chatId - Chat ID tujuan
   * @param {string} text - Pesan yang akan dikirim
   * @param {Object} [options]
   * @param {string} [options.replyTo] - Message ID untuk reply
   * @param {string} [options.format='Markdown'] - Parse mode (Markdown/HTML)
   */
  async send(chatId, text, options = {}) {
    if (!this.bot || !this.running) {
      throw new Error('Telegram bot tidak sedang berjalan');
    }

    const sendOptions = {
      parse_mode: options.format || 'Markdown',
    };

    if (options.replyTo) {
      sendOptions.reply_to_message_id = parseInt(options.replyTo, 10);
    }

    try {
      await this.bot.sendMessage(chatId, text, sendOptions);
    } catch (err) {
      // Fallback ke plain text jika Markdown formatting gagal
      if (err.message.includes('can\'t parse entities')) {
        await this.bot.sendMessage(chatId, text, {
          ...sendOptions,
          parse_mode: undefined,
        });
      } else {
        throw err;
      }
    }
  }

  /**
   * Tampilkan typing indicator.
   *
   * @param {string} chatId - Chat ID
   */
  async sendTyping(chatId) {
    if (!this.bot || !this.running) return;

    try {
      await this.bot.sendChatAction(chatId, 'typing');
    } catch (err) {
      // Ignore error
    }
  }
}
