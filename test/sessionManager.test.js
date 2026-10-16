import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getProjectKey,
  getProjectSessionDir,
  generateSessionId,
  deriveSessionTitle,
  saveSession,
  appendSessionMessage,
  loadSession,
  deleteSession,
  deleteAllSessions,
  listSessions,
  getLatestSession,
} from '../src/chat/sessionManager.js';

describe('SessionManager: Manajemen Sesi Persisten', () => {
  let tempBaseDir;
  let testProjectDir;

  beforeEach(() => {
    tempBaseDir = path.join(os.tmpdir(), `baiwor-test-base-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    testProjectDir = path.join(os.tmpdir(), `baiwor-project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    fs.mkdirSync(tempBaseDir, { recursive: true });
    fs.mkdirSync(testProjectDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    } catch {}
  });

  describe('getProjectKey & Direktori Sesi', () => {
    it('harus menghasilkan key proyek yang konsisten untuk path yang sama', () => {
      const key1 = getProjectKey(testProjectDir);
      const key2 = getProjectKey(testProjectDir);
      assert.equal(key1, key2);
      assert.match(key1, /^[a-zA-Z0-9_-]+-[a-f0-9]{8}$/);
    });

    it('harus menyamarkan home directory menjadi bcode-<hash>', () => {
      const homeKey = getProjectKey(os.homedir());
      assert.ok(homeKey.startsWith('bcode-'));
    });

    it('harus membuat direktori sesi jika belum ada', () => {
      const dir = getProjectSessionDir(testProjectDir, tempBaseDir);
      assert.ok(fs.existsSync(dir));
      assert.ok(dir.includes(tempBaseDir));
    });
  });

  describe('generateSessionId & deriveSessionTitle', () => {
    it('harus menghasilkan ID sesi unik dengan format brand baiwor_DD-MM-YYYY_<hex>', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      assert.notEqual(id1, id2);
      assert.match(id1, /^baiwor_\d{2}-\d{2}-\d{4}_[a-f0-9]{6}$/);
    });

    it('harus mengambil judul dari pesan user pertama dan memotong bila panjang', () => {
      const messages = [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'tolong buatkan fungsi untuk validasi email dan nomor telepon indonesia dengan benar' },
        { role: 'assistant', content: 'siap' },
      ];
      const title = deriveSessionTitle(messages);
      assert.ok(title.length <= 50);
      assert.ok(title.endsWith('...'));
      assert.ok(title.startsWith('tolong buatkan fungsi'));
    });

    it('harus mengembalikan fallback jika tidak ada pesan user', () => {
      assert.equal(deriveSessionTitle([], 'Default Title'), 'Default Title');
      assert.equal(deriveSessionTitle([{ role: 'system', content: 'test' }], 'Default'), 'Default');
    });
  });

  describe('saveSession & loadSession', () => {
    it('harus menyimpan dan memuat kembali sesi secara utuh', () => {
      const id = generateSessionId();
      const messages = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'halo bawor' },
        { role: 'assistant', content: 'halo juragan' },
      ];

      const saved = saveSession(
        {
          id,
          model: 'gemini-3.8-flash',
          provider: 'Agentik',
          messages,
        },
        { projectPath: testProjectDir, baseConfigDir: tempBaseDir }
      );

      assert.equal(saved.id, id);
      assert.equal(saved.title, 'halo bawor');
      assert.equal(saved.stats.turnCount, 1);
      assert.ok(saved.stats.tokensEstimate > 0);

      const loaded = loadSession(id, { projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.ok(loaded);
      assert.equal(loaded.id, id);
      assert.equal(loaded.model, 'gemini-3.8-flash');
      assert.equal(loaded.provider, 'Agentik');
      assert.equal(loaded.messages.length, 3);
      assert.equal(loaded.messages[1].content, 'halo bawor');
    });

    it('harus melempar error jika sessionData tidak memiliki ID', () => {
      assert.throws(() => {
        saveSession({}, { projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      }, /tidak memiliki id/);
    });

    it('harus mengembalikan null jika sesi tidak ditemukan', () => {
      const result = loadSession('ses_tidak_ada', { projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.equal(result, null);
    });
  });

  describe('listSessions & getLatestSession', () => {
    it('harus mengurutkan sesi berdasarkan updatedAt descending', async () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();

      saveSession(
        { id: id1, messages: [{ role: 'user', content: 'Sesi pertama' }] },
        { projectPath: testProjectDir, baseConfigDir: tempBaseDir }
      );

      // Beri jeda kecil agar updatedAt berbeda
      await new Promise((r) => setTimeout(r, 20));

      saveSession(
        { id: id2, messages: [{ role: 'user', content: 'Sesi kedua' }] },
        { projectPath: testProjectDir, baseConfigDir: tempBaseDir }
      );

      const list = listSessions({ projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.equal(list.length, 2);
      assert.equal(list[0].id, id2);
      assert.equal(list[1].id, id1);

      const latest = getLatestSession({ projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.ok(latest);
      assert.equal(latest.id, id2);
      assert.equal(latest.title, 'Sesi kedua');
      assert.ok(Array.isArray(latest.messages));
    });

    it('harus mengabaikan berkas korup tanpa melempar error', () => {
      const dir = getProjectSessionDir(testProjectDir, tempBaseDir);
      fs.writeFileSync(path.join(dir, 'corrupt.json'), 'BUKAN_JSON_VALID{', 'utf8');

      const list = listSessions({ projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.equal(list.length, 0);
    });
  });

  describe('appendSessionMessage & JSONL format', () => {
    it('harus menambahkan pesan secara incremental dengan appendSessionMessage', () => {
      const id = generateSessionId();
      saveSession(
        { id, messages: [{ role: 'user', content: 'pesan awal' }] },
        { projectPath: testProjectDir, baseConfigDir: tempBaseDir }
      );

      const appended = appendSessionMessage(
        id,
        { role: 'assistant', content: 'balasan asisten 1' },
        { projectPath: testProjectDir, baseConfigDir: tempBaseDir }
      );
      assert.equal(appended, true);

      const loaded = loadSession(id, { projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.ok(loaded);
      assert.equal(loaded.messages.length, 2);
      assert.equal(loaded.messages[1].content, 'balasan asisten 1');
    });

    it('harus tetap bisa membaca sesi format .json legacy', () => {
      const dir = getProjectSessionDir(testProjectDir, tempBaseDir);
      const legacyId = 'ses_legacy_123';
      const legacyPayload = {
        id: legacyId,
        title: 'Legacy Title',
        projectPath: testProjectDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [{ role: 'user', content: 'legacy content' }],
      };
      fs.writeFileSync(path.join(dir, `${legacyId}.json`), JSON.stringify(legacyPayload), 'utf8');

      const loaded = loadSession(legacyId, { projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.ok(loaded);
      assert.equal(loaded.id, legacyId);
      assert.equal(loaded.title, 'Legacy Title');
      assert.equal(loaded.messages.length, 1);
    });
  });

  describe('deleteSession', () => {
    it('harus menghapus berkas sesi yang ada', () => {
      const id = generateSessionId();
      saveSession(
        { id, messages: [{ role: 'user', content: 'Mau dihapus' }] },
        { projectPath: testProjectDir, baseConfigDir: tempBaseDir }
      );

      assert.ok(loadSession(id, { projectPath: testProjectDir, baseConfigDir: tempBaseDir }));

      const deleted = deleteSession(id, { projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.equal(deleted, true);

      assert.equal(loadSession(id, { projectPath: testProjectDir, baseConfigDir: tempBaseDir }), null);
    });

    it('harus mengembalikan false jika sesi memang tidak ada', () => {
      const deleted = deleteSession('ses_hantu', { projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.equal(deleted, false);
    });
  });

  describe('deleteAllSessions', () => {
    it('harus menghapus semua berkas sesi dan mengembalikan jumlah yang terhapus', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      saveSession({ id: id1, messages: [{ role: 'user', content: 'Sesi 1' }] }, { projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      saveSession({ id: id2, messages: [{ role: 'user', content: 'Sesi 2' }] }, { projectPath: testProjectDir, baseConfigDir: tempBaseDir });

      assert.equal(listSessions({ projectPath: testProjectDir, baseConfigDir: tempBaseDir }).length, 2);

      const count = deleteAllSessions({ projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.equal(count, 2);
      assert.equal(listSessions({ projectPath: testProjectDir, baseConfigDir: tempBaseDir }).length, 0);
    });

    it('harus mengembalikan 0 jika tidak ada sesi yang tersimpan', () => {
      const count = deleteAllSessions({ projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.equal(count, 0);
    });
  });

  describe('Integrasi Conversation: saveToDisk & loadFromDisk', () => {
    it('harus menyimpan sesi otomatis dari instance Conversation', async () => {
      const { Conversation } = await import('../src/chat/conversation.js');
      const conv = new Conversation();
      conv.addUserMessage('Tolong buatkan skema database user');
      conv.addAssistantMessage('Siap, ini skemanya...');

      const saved = conv.saveToDisk({
        model: 'gemini-3.8-flash',
        provider: 'Agentik',
        projectPath: testProjectDir,
        baseConfigDir: tempBaseDir,
      });

      assert.ok(saved);
      assert.equal(saved.id, conv.sessionId);
      assert.equal(saved.title, 'Tolong buatkan skema database user');

      // Instance baru yang memuat sesi tadi
      const conv2 = new Conversation();
      const loaded = conv2.loadFromDisk(conv.sessionId, {
        projectPath: testProjectDir,
        baseConfigDir: tempBaseDir,
      });

      assert.equal(loaded, true);
      assert.equal(conv2.sessionId, conv.sessionId);
      assert.equal(conv2.getMessages().length, 3);
      assert.equal(conv2.getMessages()[1].content, 'Tolong buatkan skema database user');
    });

    it('tidak boleh menyimpan sesi jika belum ada pesan user (sesi kosong)', async () => {
      const { Conversation } = await import('../src/chat/conversation.js');
      const conv = new Conversation();
      const saved = conv.saveToDisk({
        projectPath: testProjectDir,
        baseConfigDir: tempBaseDir,
      });
      assert.equal(saved, null);
    });

    it('harus dapat me-resume sesi paling baru dengan resumeLatest()', async () => {
      const { Conversation } = await import('../src/chat/conversation.js');
      const conv1 = new Conversation();
      conv1.addUserMessage('Sesi kemarin');
      conv1.saveToDisk({ projectPath: testProjectDir, baseConfigDir: tempBaseDir });

      await new Promise((r) => setTimeout(r, 20));

      const conv2 = new Conversation();
      conv2.addUserMessage('Sesi hari ini');
      conv2.saveToDisk({ projectPath: testProjectDir, baseConfigDir: tempBaseDir });

      const convResume = new Conversation();
      const resumed = convResume.resumeLatest({
        projectPath: testProjectDir,
        baseConfigDir: tempBaseDir,
      });

      assert.equal(resumed, true);
      assert.equal(convResume.sessionId, conv2.sessionId);
      assert.equal(convResume.getMessages()[1].content, 'Sesi hari ini');
    });
  });
});

