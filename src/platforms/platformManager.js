import { EventEmitter } from 'node:events';

/**
 * Platform Manager untuk bAIwor Code.
 *
 * Abstraction layer untuk multi-platform messaging integration.
 * Mendukung Telegram Bot dan WhatsApp (Baileys) dengan unified API.
 *
 * Arsitektur:
 *   1. PlatformManager mengelola lifecycle semua platforms
 *   2. Setiap platform emit 'message' event saat ada pesan masuk
 *   3. PlatformManager route pesan ke handleUserChat
 *   4. Response dikirim balik ke platform yang sama
 *
 * Usage:
 *   const manager = new PlatformManager();
 *   manager.on('message', async (msg) => {
 *     const response = await handleUserChat(msg.text);
 *     manager.send(msg.platform, msg.chatId, response);
 *   });
 *   await manager.start('telegram', { botToken: '...' });
 */

/**
 * @typedef {Object} PlatformMessage
 * @property {string} platform - 'telegram' | 'whatsapp'
 * @property {string} chatId - Unique chat/user ID
 * @property {string} text - Pesan dari user
 * @property {string} [messageId] - Message ID (untuk reply/edit)
 * @property {Object} [metadata] - Platform-specific metadata
 */

/**
 * @typedef {Object} PlatformConfig
 * @property {string} botToken - Telegram bot token
 * @property {string} [sessionPath] - Path untuk WhatsApp session
 */

export class PlatformManager extends EventEmitter {
  constructor() {
    super();
    this.platforms = new Map(); // platform name -> platform instance
    this.running = new Set();
  }

  /**
   * Register platform instance.
   *
   * @param {string} name - Platform name ('telegram' | 'whatsapp')
   * @param {Object} platform - Platform instance dengan start/stop/send methods
   */
  register(name, platform) {
    this.platforms.set(name, platform);
  }

  /**
   * Start platform dengan konfigurasi tertentu.
   *
   * @param {string} name - Platform name
   * @param {PlatformConfig} config - Konfigurasi platform
   * @returns {Promise<void>}
   */
  async start(name, config) {
    const platform = this.platforms.get(name);
    if (!platform) {
      throw new Error(`Platform '${name}' tidak terdaftar. Register dulu dengan register().`);
    }

    if (this.running.has(name)) {
      console.warn(`[Platform] ${name} sudah berjalan`);
      return;
    }

    await platform.start(config);
    this.running.add(name);

    // Forward messages dari platform ke PlatformManager
    platform.on('message', (msg) => {
      this.emit('message', { ...msg, platform: name });
    });

    console.log(`[Platform] ${name} started`);
  }

  /**
   * Stop platform yang sedang berjalan.
   *
   * @param {string} name - Platform name
   * @returns {Promise<void>}
   */
  async stop(name) {
    const platform = this.platforms.get(name);
    if (!platform) {
      throw new Error(`Platform '${name}' tidak terdaftar`);
    }

    if (!this.running.has(name)) {
      console.warn(`[Platform] ${name} tidak sedang berjalan`);
      return;
    }

    await platform.stop();
    this.running.delete(name);
    console.log(`[Platform] ${name} stopped`);
  }

  /**
   * Stop semua platforms yang sedang berjalan.
   *
   * @returns {Promise<void>}
   */
  async stopAll() {
    for (const name of this.running) {
      await this.stop(name);
    }
  }

  /**
   * Kirim pesan ke platform tertentu.
   *
   * @param {string} name - Platform name
   * @param {string} chatId - Chat/user ID tujuan
   * @param {string} text - Pesan yang akan dikirim
   * @param {Object} [options] - Opsi tambahan (replyTo, format, dll)
   * @returns {Promise<void>}
   */
  async send(name, chatId, text, options = {}) {
    const platform = this.platforms.get(name);
    if (!platform) {
      throw new Error(`Platform '${name}' tidak terdaftar`);
    }

    if (!this.running.has(name)) {
      throw new Error(`Platform '${name}' tidak sedang berjalan`);
    }

    await platform.send(chatId, text, options);
  }

  /**
   * Cek status platform.
   *
   * @param {string} name - Platform name
   * @returns {boolean}
   */
  isRunning(name) {
    return this.running.has(name);
  }

  /**
   * Dapatkan daftar platforms yang terdaftar.
   *
   * @returns {string[]}
   */
  listPlatforms() {
    return Array.from(this.platforms.keys());
  }

  /**
   * Dapatkan daftar platforms yang sedang berjalan.
   *
   * @returns {string[]}
   */
  listRunning() {
    return Array.from(this.running);
  }
}

/**
 * Singleton instance untuk digunakan di seluruh aplikasi.
 */
export const platformManager = new PlatformManager();
