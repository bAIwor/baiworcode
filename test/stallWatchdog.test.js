import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { streamChatCompletion } from '../src/chat/client.js';

describe('StallWatchdog: stream macet dibunuh dengan TimeoutError, bukan menggantung', () => {
  const servers = [];

  after(() => {
    for (const s of servers) {
      try { s.close(); } catch {}
    }
  });

  it('stream yang berhenti diam tanpa menutup koneksi → TimeoutError (bukan freeze)', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Kirim SATU chunk lalu tahan koneksi diam selamanya — persis kondisi
      // proxy/provider yang menggantung tanpa menutup TCP.
      res.write('data: {"choices":[{"delta":{"content":"Sedang m..."}}]}\n\n');
      // TIDAK ada flush lanjutan, TIDAK ada res.end() — sengaja menggantung.
    });
    servers.push(server);

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const startedAt = Date.now();
    try {
      await streamChatCompletion({
        credentials: {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          headers: { Authorization: 'Bearer test-token' },
          model: 'test-model',
        },
        messages: [{ role: 'user', content: 'test' }],
        // Batas diam pendek hanya untuk uji cepat.
        stallTimeoutMs: 250,
      });
      assert.fail('Harusnya throw TimeoutError, bukan kembali normal / menggantung');
    } catch (err) {
      assert.equal(err.name, 'TimeoutError');
      assert.match(err.message, /Stream macet/i);
    } finally {
      // Pesannya: uji berhenti cepat sesuai watchog, bukan menggantung.
      const elapsed = Date.now() - startedAt;
      assert.ok(
        elapsed < 10000,
        `Waktu selesai ${elapsed}ms — watchdog gagal memotong stream macet`
      );
    }
    server.close();
  });

  it('keep-alive (baris ": ping") men-reset watchdog — stream hidup tidak didenda', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Kirim keep-alive tiap 80ms — jauh lebih rapat daripada watchdog 250ms.
      const ping = setInterval(() => {
        res.write(': ping\n\n');
      }, 80);

      setTimeout(() => {
        clearInterval(ping);
        res.write('data: {"choices":[{"delta":{"content":"lambat tapi hidup"}}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      }, 500); // 2x lebih lama dari batas watchdog — harus tetap selamat
    });
    servers.push(server);

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const result = await streamChatCompletion({
      credentials: {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        headers: { Authorization: 'Bearer test-token' },
        model: 'test-model',
      },
      messages: [{ role: 'user', content: 'test' }],
      stallTimeoutMs: 250,
    });

    assert.equal(result.content, 'lambat tapi hidup');
    assert.equal(result.completed, true);
  });
});
