import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PlatformManager } from '../src/platforms/platformManager.js';

describe('Messaging Platforms', () => {
  let manager;

  beforeEach(() => {
    manager = new PlatformManager();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  describe('PlatformManager', () => {
    it('harus membuat instance baru', () => {
      assert.ok(manager);
      assert.deepEqual(manager.listPlatforms(), []);
      assert.deepEqual(manager.listRunning(), []);
    });

    it('harus register platform', () => {
      const mockPlatform = {
        start: async () => {},
        stop: async () => {},
        send: async () => {},
        on: () => {},
      };

      manager.register('test', mockPlatform);
      assert.deepEqual(manager.listPlatforms(), ['test']);
    });

    it('harus start platform yang terdaftar', async () => {
      let started = false;
      const mockPlatform = {
        start: async () => {
          started = true;
        },
        stop: async () => {},
        send: async () => {},
        on: () => {},
      };

      manager.register('test', mockPlatform);
      await manager.start('test', {});

      assert.equal(started, true);
      assert.equal(manager.isRunning('test'), true);
      assert.deepEqual(manager.listRunning(), ['test']);
    });

    it('harus stop platform yang berjalan', async () => {
      let stopped = false;
      const mockPlatform = {
        start: async () => {},
        stop: async () => {
          stopped = true;
        },
        send: async () => {},
        on: () => {},
      };

      manager.register('test', mockPlatform);
      await manager.start('test', {});
      await manager.stop('test');

      assert.equal(stopped, true);
      assert.equal(manager.isRunning('test'), false);
    });

    it('harus stopAll platforms', async () => {
      const stopped = [];
      const createMock = (name) => ({
        start: async () => {},
        stop: async () => {
          stopped.push(name);
        },
        send: async () => {},
        on: () => {},
      });

      manager.register('test1', createMock('test1'));
      manager.register('test2', createMock('test2'));

      await manager.start('test1', {});
      await manager.start('test2', {});
      await manager.stopAll();

      assert.equal(stopped.length, 2);
      assert.deepEqual(manager.listRunning(), []);
    });

    it('harus reject start platform yang tidak terdaftar', async () => {
      await assert.rejects(
        () => manager.start('nonexistent', {}),
        /tidak terdaftar/
      );
    });

    it('harus reject send ke platform yang tidak berjalan', async () => {
      const mockPlatform = {
        start: async () => {},
        stop: async () => {},
        send: async () => {},
        on: () => {},
      };

      manager.register('test', mockPlatform);

      await assert.rejects(
        () => manager.send('test', 'chat1', 'hello'),
        /tidak sedang berjalan/
      );
    });

    it('harus forward message events dari platform', async () => {
      const mockPlatform = {
        start: async () => {},
        stop: async () => {},
        send: async () => {},
        on: (event, handler) => {
          if (event === 'message') {
            // Simulate message
            setTimeout(() => {
              handler({
                chatId: '123',
                text: 'test message',
              });
            }, 10);
          }
        },
      };

      manager.register('test', mockPlatform);

      const messagePromise = new Promise((resolve) => {
        manager.on('message', (msg) => {
          resolve(msg);
        });
      });

      await manager.start('test', {});
      const msg = await messagePromise;

      assert.equal(msg.platform, 'test');
      assert.equal(msg.chatId, '123');
      assert.equal(msg.text, 'test message');
    });
  });

  describe('Telegram Bot (mock)', () => {
    it('harus throw error jika node-telegram-bot-api belum diinstall', async () => {
      // Ini test untuk memastikan error handling yang baik
      const { TelegramBot } = await import('../src/platforms/telegramBot.js');
      const bot = new TelegramBot();

      // Mock dynamic import failure
      const originalImport = globalThis.import;
      globalThis.import = async () => {
        throw new Error('Cannot find module');
      };

      try {
        await bot.start({ botToken: 'test-token' });
        assert.fail('Should have thrown error');
      } catch (err) {
        assert.ok(err.message.includes('node-telegram-bot-api belum diinstall'));
      } finally {
        globalThis.import = originalImport;
      }
    });
  });

  describe('WhatsApp Baileys (mock)', () => {
    it('harus throw error jika @whiskeysockets/baileys belum diinstall', async () => {
      const { WhatsAppBaileys } = await import('../src/platforms/whatsappBaileys.js');
      const wa = new WhatsAppBaileys();

      // Mock dynamic import failure
      const originalImport = globalThis.import;
      globalThis.import = async () => {
        throw new Error('Cannot find module');
      };

      try {
        await wa.start({});
        assert.fail('Should have thrown error');
      } catch (err) {
        assert.ok(err.message.includes('@whiskeysockets/baileys belum diinstall'));
      } finally {
        globalThis.import = originalImport;
      }
    });
  });
});
