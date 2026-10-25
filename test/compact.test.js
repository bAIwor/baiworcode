import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation } from '../src/chat/conversation.js';
import { noteRealTokenUsage, getContextUsage } from '../src/chat/context.js';
import {
  formatHistoryForSummary,
  buildDeterministicSummary,
  compactConversation,
  shouldAutoCompact,
  autoCompactConversation,
  AUTO_COMPACT_THRESHOLD,
} from '../src/chat/compact.js';

describe('Context Compactor: Perangkuman Riwayat Cerdas (/compact)', () => {
  describe('formatHistoryForSummary', () => {
    it('harus memformat riwayat pesan tanpa menyertakan system prompt', () => {
      const messages = [
        { role: 'system', content: 'Rahasia internal prompt' },
        { role: 'user', content: 'Buat file server.js' },
        {
          role: 'assistant',
          content: 'Siap',
          tool_calls: [
            { function: { name: 'write_file', arguments: '{"path":"server.js"}' } },
          ],
        },
        { role: 'tool', content: 'File berhasil dibuat', name: 'write_file' },
      ];

      const formatted = formatHistoryForSummary(messages);
      assert.ok(!formatted.includes('Rahasia internal prompt'));
      assert.ok(formatted.includes('USER: Buat file server.js'));
      assert.ok(formatted.includes('write_file'));
      assert.ok(formatted.includes('File berhasil dibuat'));
    });
  });

  describe('buildDeterministicSummary', () => {
    it('harus menyusun ringkasan instruksi dan tools saat mode offline/fallback', () => {
      const messages = [
        { role: 'user', content: 'Refactor modul auth' },
        {
          role: 'assistant',
          content: 'Baik',
          tool_calls: [{ function: { name: 'read_file' } }],
        },
      ];

      const summary = buildDeterministicSummary(messages);
      assert.ok(summary.includes('Refactor modul auth'));
      assert.ok(summary.includes('read_file'));
    });
  });

  describe('compactConversation', () => {
    it('harus menolak kompresi jika riwayat masih terlalu pendek', async () => {
      const conv = new Conversation();
      const res = await compactConversation(conv);
      assert.equal(res.compacted, false);
      assert.match(res.reason, /terlalu singkat/);
    });

    it('mempertahankan prompt user terakhir saat preserveLastUserPrompt aktif', async () => {
      const conv = new Conversation();
      conv.addUserMessage('permintaan lama');
      conv.addAssistantMessage('jawaban lama');
      conv.addUserMessage('PERMINTAAN AKTIF YANG TIDAK BOLEH HILANG');
      const res = await compactConversation(conv, { preserveLastUserPrompt: true });
      assert.equal(res.compacted, true);
      const last = conv.messages[conv.messages.length - 1];
      assert.equal(last.role, 'user');
      assert.equal(last.content, 'PERMINTAAN AKTIF YANG TIDAK BOLEH HILANG');
    });

    it('membuang snapshot usage provider setelah rangkuman mengganti riwayat', async () => {
      const conv = new Conversation();
      conv.addUserMessage('permintaan lama');
      conv.addAssistantMessage('jawaban lama');
      conv.addUserMessage('prompt aktif');
      // Sebelum & sesudah compact sama-sama 4 pesan — tanpa invalidasi
      // eksplisit, snapshot usage lama akan dikira masih sahih.
      noteRealTokenUsage({ promptTokens: 9_000, messageCount: conv.messages.length });
      const res = await compactConversation(conv, { preserveLastUserPrompt: true });
      assert.equal(res.compacted, true);
      assert.equal(conv.messages.length, 4);
      assert.equal(
        getContextUsage(conv.messages, { contextWindow: 100_000 }).source,
        'estimate'
      );
    });

    it('harus berhasil merangkum dengan summarizeFn kustom', async () => {
      const conv = new Conversation();
      conv.addUserMessage('Tolong buatkan endpoint GET /users lengkap dengan schema database berikut:\n' + 'line of code\n'.repeat(50));
      conv.addAssistantMessage('Siap, ini kodenya:\n' + 'app.get("/users", handler);\n'.repeat(30));
      conv.addUserMessage('Tambahkan validasi token JWT');
      conv.addAssistantMessage('Validasi token sudah ditambahkan');

      const mockSummarize = async (history) => {
        assert.ok(history.includes('GET /users'));
        return '1. Endpoint GET /users dibuat.\n2. Validasi token ditambahkan.';
      };

      const res = await compactConversation(conv, { summarizeFn: mockSummarize });
      assert.equal(res.compacted, true);
      assert.ok(res.savedTokens > 0);
      assert.ok(res.tokensBefore > res.tokensAfter);
      assert.ok(res.summary.includes('Endpoint GET /users dibuat'));

      // Cek struktur pesan baru
      const msgs = conv.getMessages();
      assert.equal(msgs[0].role, 'system');
      assert.equal(msgs[1].role, 'user');
      assert.ok(msgs[1].content.includes('Rangkuman Konteks Percakapan Sebelumnya'));
      assert.equal(msgs[2].role, 'assistant');
    });

    it('harus bertahan dan memakai fallback jika summarizeFn mengalami error', async () => {
      const conv = new Conversation();
      conv.addUserMessage('Halo bAIwor, tolong cek bug ini');
      conv.addAssistantMessage('Oke, mari kita periksa');

      const failSummarize = async () => {
        throw new Error('Jaringan LLM putus');
      };

      const res = await compactConversation(conv, { summarizeFn: failSummarize });
      assert.equal(res.compacted, true);
      assert.ok(res.summary.includes('Auto-Compact Fallback'));
      assert.equal(conv.getMessages().length, 3);
    });
  });

  describe('Auto-Compact Trigger (autoCompactConversation & shouldAutoCompact)', () => {
    it('harus bernilai false bila token masih di bawah ambang batas 80%', () => {
      const conv = new Conversation();
      conv.addUserMessage('Pesan pendek');
      conv.addAssistantMessage('Balasan pendek');

      assert.equal(shouldAutoCompact(conv, { contextWindow: 100000 }), false);
    });

    it('harus bernilai true bila token melampaui ambang batas contextWindow', () => {
      const conv = new Conversation();
      // Tambahkan pesan yang cukup besar untuk melampaui contextWindow kecil (1000 token ≈ 4000 char)
      conv.addUserMessage('Instruksi panjang: ' + 'A'.repeat(3500));
      conv.addAssistantMessage('Balasan panjang: ' + 'B'.repeat(3500));

      // 7000 chars ≈ 1750 tokens, bila window 2000 maka usage > 80%
      assert.equal(shouldAutoCompact(conv, { contextWindow: 2000, threshold: 0.8 }), true);
    });

    it('harus memicu autoCompact dan menyimpan snapshot riwayat', async () => {
      const conv = new Conversation();
      conv.addUserMessage('Instruksi awal: ' + 'X'.repeat(3500));
      conv.addAssistantMessage('Balasan awal: ' + 'Y'.repeat(3500));

      let snapshotCalled = false;
      const mockSnapshotFn = async (c) => {
        snapshotCalled = true;
        return '/tmp/mock-snapshot.json';
      };

      const res = await autoCompactConversation(conv, {
        contextWindow: 2000,
        threshold: 0.8,
        snapshotFn: mockSnapshotFn,
      });

      assert.equal(res.triggered, true);
      assert.equal(snapshotCalled, true);
      assert.equal(res.snapshotPath, '/tmp/mock-snapshot.json');
      assert.ok(res.savedTokens > 0);
      assert.ok(res.percentBefore >= 80);
      assert.ok(res.percentAfter < res.percentBefore);
    });

    it('tidak memicu autoCompact bila token di bawah batas', async () => {
      const conv = new Conversation();
      conv.addUserMessage('Singkat saja');
      conv.addAssistantMessage('Oke');

      const res = await autoCompactConversation(conv, {
        contextWindow: 100000,
      });

      assert.equal(res.triggered, false);
      assert.ok(res.reason.includes('di bawah ambang batas'));
    });
  });
});
