import { EventEmitter } from 'node:events';

/**
 * WhatsApp Baileys Platform untuk bAIwor Code.
 *
 * Integrasi dengan WhatsApp menggunakan Baileys library.
 * Menerima pesan dari user dan mengirim response dari bAIwor.
 *
 * Features:
 * - WhatsApp Web protocol (baileys)
 * - Session persistence (auto-reconnect)
 * - QR code authentication
 * - Support untuk text messages
 * - Typing indicator saat memproses
 *
 * Requirements:
 * - npm install @whiskeysockets/baileys
 * - Scan QR code untuk authentication
 */

export class WhatsAppBaileys extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {string} [options.sessionPath='./.baiwor/whatsapp-session'] - Path untuk session
   */
  constructor(options = {}) {
    super();
    this.sock = null;
    this.sessionPath = options.sessionPath || './.baiwor/whatsapp-session';
    this.running = false;
    this.authState = null;
  }

  /**
   * Start WhatsApp client.
   *
   * @param {{sessionPath?: string}} [config]
   */
  async start(config = {}) {
    const sessionPath = config.sessionPath || this.sessionPath;

    // Dynamic import untuk menghindari error jika package belum diinstall
    let baileys;
    try {
      baileys = await import('@whiskeysockets/baileys');
    } catch (err) {
      throw new Error(
        '@whiskeysockets/baileys belum diinstall. Jalankan: npm install @whiskeysockets/baileys'
      );
    }

    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

    // Load or create auth state
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    this.authState = state;

    // Get latest Baileys version
    const { version } = await fetchLatestBaileysVersion();

    // Create socket
    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
    });

    this.running = true;

    // Handle connection updates
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('[WhatsApp] Scan QR code ini untuk authenticate:');
        console.log(qr);
        this.emit('qr', qr);
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`[WhatsApp] Connection closed. Reconnecting: ${shouldReconnect}`);

        if (shouldReconnect) {
          await this.start(config);
        } else {
          this.running = false;
          this.emit('disconnected');
        }
      } else if (connection === 'open') {
        console.log('[WhatsApp] Connection opened');
        this.emit('connected');
      }
    });

    // Handle credentials update
    this.sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    this.sock.ev.on('messages.upsert', async (m) => {
      for (const msg of m.messages) {
        await this.#handleMessage(msg);
      }
    });
  }

  /**
   * Handle pesan masuk dari WhatsApp.
   *
   * @param {Object} msg - WhatsApp message object
   */
  async #handleMessage(msg) {
    // Skip jika bukan pesan baru
    if (!msg.message) return;

    // Skip jika pesan dari diri sendiri
    if (msg.key.fromMe) return;

    // Extract text dari message
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      msg.message.documentMessage?.caption ||
      null;

    if (!text) return; // Skip non-text messages

    const chatId = msg.key.remoteJid;
    const messageId = msg.key.id;

    // Emit message event
    this.emit('message', {
      chatId,
      text,
      messageId,
      metadata: {
        from: msg.key.participant || chatId,
        timestamp: msg.messageTimestamp,
        pushName: msg.pushName,
      },
    });
  }

  /**
   * Stop WhatsApp client.
   */
  async stop() {
    if (!this.sock) return;

    this.running = false;
    await this.sock.end(undefined);
    this.sock = null;
    console.log('[WhatsApp] Client stopped');
  }

  /**
   * Kirim pesan ke chat tertentu.
   *
   * @param {string} chatId - Chat ID tujuan (format: number@s.whatsapp.net)
   * @param {string} text - Pesan yang akan dikirim
   * @param {Object} [options]
   * @param {string} [options.quotedMessageId] - Message ID untuk quote/reply
   */
  async send(chatId, text, options = {}) {
    if (!this.sock || !this.running) {
      throw new Error('WhatsApp client tidak sedang berjalan');
    }

    const sendOptions = {};

    // TODO: Implement quoted message jika dibutuhkan

    await this.sock.sendMessage(chatId, { text }, sendOptions);
  }

  /**
   * Tampilkan typing indicator.
   *
   * @param {string} chatId - Chat ID
   */
  async sendTyping(chatId) {
    if (!this.sock || !this.running) return;

    try {
      await this.sock.sendPresenceUpdate('composing', chatId);
      // Stop typing after 2 seconds
      setTimeout(async () => {
        if (this.sock && this.running) {
          await this.sock.sendPresenceUpdate('available', chatId);
        }
      }, 2000);
    } catch (err) {
      // Ignore error
    }
  }

  /**
   * Cek apakah client sudah authenticated.
   *
   * @returns {boolean}
   */
  isAuthenticated() {
    return this.authState?.creds?.registered || false;
  }
}
