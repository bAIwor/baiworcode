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
  listAllProjectsSessions,
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

  describe('Keamanan ID sesi dan izin berkas', () => {
    it('menolak ID yang mencoba path traversal / karakter aneh', () => {
      for (const id of ['../../outside', '..', 'foo/bar', 'foo\\bar', 'nama sesi']) {
        assert.throws(
          () => saveSession({ id, messages: [{ role: 'user', content: 'x' }] }, {
            projectPath: testProjectDir,
            baseConfigDir: tempBaseDir,
          }),
          /tidak valid/i,
          `ID seharusnya ditolak: ${id}`
        );
        assert.equal(appendSessionMessage(id, { role: 'assistant', content: 'x' }, {
          projectPath: testProjectDir,
          baseConfigDir: tempBaseDir,
        }), false);
        assert.equal(loadSession(id, {
          projectPath: testProjectDir,
          baseConfigDir: tempBaseDir,
        }), null);
        assert.equal(deleteSession(id, {
          projectPath: testProjectDir,
          baseConfigDir: tempBaseDir,
        }), false);
      }
    });

    it('menulis transkrip dengan mode 0600 di POSIX', { skip: process.platform === 'win32' }, () => {
      const id = generateSessionId();
      saveSession({
        id,
        messages: [{ role: 'user', content: 'halo' }],
      }, { projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      const dir = getProjectSessionDir(testProjectDir, tempBaseDir);
      const mode = fs.statSync(path.join(dir, `${id}.jsonl`)).mode & 0o777;
      assert.equal(mode, 0o600);
    });
  });

  describe('deleteAllSessions lintas proyek tidak menyentuh snapshot', () => {
    it('menghapus sesi semua proyek tetapi mempertahankan folder snapshots', () => {
      const id = generateSessionId();
      saveSession({
        id,
        messages: [{ role: 'user', content: 'halo' }],
      }, { projectPath: testProjectDir, baseConfigDir: tempBaseDir });

      const snapshotsDir = path.join(tempBaseDir, 'sessions', 'snapshots');
      fs.mkdirSync(snapshotsDir, { recursive: true });
      const snapshotFile = path.join(snapshotsDir, 'snapshot-test.json');
      fs.writeFileSync(snapshotFile, '[]');

      const deleted = deleteAllSessions({ allProjects: true, baseConfigDir: tempBaseDir });
      assert.ok(deleted >= 1);
      assert.equal(fs.existsSync(snapshotFile), true, 'snapshot tidak boleh ikut terhapus');
    });
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

    it('harus menghapus sesi dari proyek lain lewat fallback pencarian global', () => {
      const otherProjectDir = path.join(tempBaseDir, 'other-project');
      const id = generateSessionId();
      saveSession({ id, messages: [{ role: 'user', content: 'Sesi di folder lain' }] }, { projectPath: otherProjectDir, baseConfigDir: tempBaseDir });

      const deleted = deleteSession(id, { projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.equal(deleted, true);
      assert.equal(loadSession(id, { projectPath: testProjectDir, baseConfigDir: tempBaseDir }), null);
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

    it('harus menghapus seluruh sesi lintas proyek bila allProjects bernilai true', () => {
      const projA = path.join(tempBaseDir, 'projA');
      const projB = path.join(tempBaseDir, 'projB');
      saveSession({ id: generateSessionId(), messages: [{ role: 'user', content: 'Sesi A' }] }, { projectPath: projA, baseConfigDir: tempBaseDir });
      saveSession({ id: generateSessionId(), messages: [{ role: 'user', content: 'Sesi B' }] }, { projectPath: projB, baseConfigDir: tempBaseDir });

      assert.equal(listAllProjectsSessions({ baseConfigDir: tempBaseDir }).length, 2);
      const count = deleteAllSessions({ baseConfigDir: tempBaseDir, allProjects: true });
      assert.equal(count, 2);
      assert.equal(listAllProjectsSessions({ baseConfigDir: tempBaseDir }).length, 0);
    });

    it('harus mengembalikan 0 jika tidak ada sesi yang tersimpan', () => {
      const count = deleteAllSessions({ projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      assert.equal(count, 0);
    });
  });

  describe('listAllProjectsSessions (Sesi Global Lintas Workspace)', () => {
    it('harus dapat mengumpulkan sesi dari berbagai folder proyek secara terpadu', () => {
      const projA = path.join(tempBaseDir, 'projA');
      const projB = path.join(tempBaseDir, 'projB');
      const idA = generateSessionId();
      const idB = generateSessionId();

      saveSession({ id: idA, messages: [{ role: 'user', content: 'Fitur A' }] }, { projectPath: projA, baseConfigDir: tempBaseDir });
      saveSession({ id: idB, messages: [{ role: 'user', content: 'Fitur B' }] }, { projectPath: projB, baseConfigDir: tempBaseDir });

      const all = listAllProjectsSessions({ baseConfigDir: tempBaseDir });
      assert.equal(all.length, 2);
      const ids = all.map((s) => s.id);
      assert.ok(ids.includes(idA));
      assert.ok(ids.includes(idB));
    });
  });

  describe('Penjaga resume lintas proyek', () => {
    it('TIDAK boleh mengambil sesi proyek lain saat resumeLatest dipanggil tanpa izin', () => {
      const otherProject = path.join(tempBaseDir, 'proyek-lain');
      const idLain = generateSessionId();
      saveSession(
        { id: idLain, messages: [{ role: 'user', content: 'Konteks proyek lain' }] },
        { projectPath: otherProject, baseConfigDir: tempBaseDir }
      );

      // Folder ini belum punya sesi sendiri → resumeLatest harus TIDAK
      // mengambil sesi proyek lain secara diam-diam.
      const emptyProject = path.join(tempBaseDir, 'proyek-kosong');
      const latest = getLatestSession({
        projectPath: emptyProject,
        baseConfigDir: tempBaseDir,
      });
      assert.equal(latest, null);

      // Gullible: sesi proyek lain hanya bisa diambil bila diizinkan eksplisit.
      const latestExplicit = getLatestSession({
        projectPath: emptyProject,
        baseConfigDir: tempBaseDir,
        allowCrossProject: true,
      });
      assert.ok(latestExplicit);
      assert.equal(latestExplicit.id, idLain);
    });

    it('loadSession tidak mencari lintas proyek tanpa allowCrossProject', () => {
      const otherProject = path.join(tempBaseDir, 'proyek-lain-2');
      const idLain = generateSessionId();
      saveSession(
        { id: idLain, messages: [{ role: 'user', content: 'Konteks proyek lain 2' }] },
        { projectPath: otherProject, baseConfigDir: tempBaseDir }
      );

      const emptyProject = path.join(tempBaseDir, 'proyek-kosong-2');
      assert.equal(loadSession(idLain, { projectPath: emptyProject, baseConfigDir: tempBaseDir }), null);
      assert.ok(
        loadSession(idLain, {
          projectPath: emptyProject,
          baseConfigDir: tempBaseDir,
          allowCrossProject: true,
        })
      );
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

  describe('Persistensi inkremental: kemajuan giliran panjang tidak hilang', () => {
    it('harus menulis pesan ke disk SEBELUM giliran selesai', async () => {
      const { Conversation } = await import('../src/chat/conversation.js');
      const conv = new Conversation();
      const opts = { projectPath: testProjectDir, baseConfigDir: tempBaseDir };

      // Belum ada apa-apa di disk.
      const dir = getProjectSessionDir(testProjectDir, tempBaseDir);
      assert.equal(fs.existsSync(path.join(dir, `${conv.sessionId}.jsonl`)), false);

      conv.addUserMessage('Tolong audit proyek ini'); // belum aktif → tidak ditulis
      assert.equal(fs.existsSync(path.join(dir, `${conv.sessionId}.jsonl`)), false);

      conv.enableIncrementalSave({ model: 'Beam-1.0-501B-A23B', provider: 'Reflection', ...opts });
      conv.addAssistantMessage('', [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }]);
      conv.addToolResult('c1', 'isi berkas', 'read_file');

      // Berkas sudah ada walau giliran agentic belum berakhir.
      const filePath = path.join(dir, `${conv.sessionId}.jsonl`);
      assert.equal(fs.existsSync(filePath), true, 'sesi harus sudah ditulis di tengah giliran');

      let isi = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/);
      assert.equal(JSON.parse(isi[0]).type, 'session');
      // header + system + user + assistant + hasil tool
      assert.equal(isi.length, 5, 'seluruh riwayat harus sudah tertulis di tengah giliran');

      // Pesan berikutnya di-append, bukan menulis ulang seluruh berkas.
      conv.addAssistantMessage('Lanjut ya');
      isi = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/);
      assert.equal(isi.length, 6);
      assert.equal(JSON.parse(isi[5]).message.content, 'Lanjut ya');

      // Muat ulang dari disk harus menghasilkan riwayat yang utuh.
      const conv2 = new Conversation();
      assert.equal(conv2.loadFromDisk(conv.sessionId, opts), true);
      assert.equal(conv2.getMessages().length, conv.getMessages().length);
      assert.equal(conv2.getMessages().at(-1).content, 'Lanjut ya');
    });

    it('tidak menulis apa pun selama persistensi belum diaktifkan', async () => {
      const { Conversation } = await import('../src/chat/conversation.js');
      const conv = new Conversation();
      conv.addUserMessage('Gagal di provider, jadi harus di-rollback');
      conv.removeLastUserMessage();

      const dir = getProjectSessionDir(testProjectDir, tempBaseDir);
      assert.equal(fs.existsSync(path.join(dir, `${conv.sessionId}.jsonl`)), false);
    });

    it('reset() mematikan persistensi inkremental dari sesi lama', async () => {
      const { Conversation } = await import('../src/chat/conversation.js');
      const conv = new Conversation();
      const lama = conv.sessionId;
      conv.enableIncrementalSave({ projectPath: testProjectDir, baseConfigDir: tempBaseDir });
      conv.addUserMessage('pesan pertama');
      conv.addAssistantMessage('balasan');

      const dir = getProjectSessionDir(testProjectDir, tempBaseDir);
      assert.equal(fs.existsSync(path.join(dir, `${lama}.jsonl`)), true);

      conv.reset();
      assert.equal(conv.incrementalSave, null);
      assert.notEqual(conv.sessionId, lama);
      conv.addAssistantMessage('pesan di sesi baru');
      assert.equal(fs.existsSync(path.join(dir, `${conv.sessionId}.jsonl`)), false);
    });
  });
});

