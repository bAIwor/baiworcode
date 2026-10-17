import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildChatEndpoint, streamChatCompletion } from '../src/chat/client.js';
import { isNetworkError } from '../src/chat/index.js';
import { Conversation } from '../src/chat/conversation.js';
import { getSystemPrompt } from '../src/chat/systemPrompt.js';

describe('Tahap 3A: System Prompt & Karakter bAIwor', () => {
  it('harus memuat filosofi Punakawan Banyumasan dan petunjuk teknis', () => {
    const prompt = getSystemPrompt();
    assert.match(prompt, /Jiwa Punakawan, Pikiran AI, Guardian Banyumas/i);
    assert.match(prompt, /blakasuta/i);
    assert.match(prompt, /bAIwor Code/i);
    assert.match(prompt, /Workspace \/ CWD/i);
  });

  it('harus memuat informasi model & provider aktif dan instruksi 100% Bahasa Indonesia', () => {
    const prompt = getSystemPrompt({ model: 'step-5-preview', provider: 'StepFun' });
    assert.match(prompt, /Model AI Aktif\s*:\s*step-5-preview/);
    assert.match(prompt, /Provider Aktif\s*:\s*StepFun/);
    assert.match(prompt, /100% Bahasa Indonesia/);
  });
});

describe('Tahap 3A: Conversation Manager & Memory', () => {
  it('harus menginisialisasi dengan pesan role system', () => {
    const conv = new Conversation();
    const msgs = conv.getMessages();
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].role, 'system');
  });

  it('harus dapat menambah pesan user dan assistant', () => {
    const conv = new Conversation();
    conv.addUserMessage('Halo bAIwor');
    conv.addAssistantMessage('Halo lur! Ana sing bisa dibantu?');

    const msgs = conv.getMessages();
    assert.equal(msgs.length, 3);
    assert.equal(msgs[1].role, 'user');
    assert.equal(msgs[1].content, 'Halo bAIwor');
    assert.equal(msgs[2].role, 'assistant');
    assert.equal(msgs[2].content, 'Halo lur! Ana sing bisa dibantu?');
  });

  it('harus kompatibel dengan tool_calls dan role tool (persiapan Tahap 3B)', () => {
    const conv = new Conversation();
    const toolCalls = [
      {
        id: 'call_123',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"index.js"}' },
      },
    ];

    conv.addAssistantMessage('', toolCalls);
    conv.addToolResult('call_123', 'console.log("hello")', 'read_file');

    const msgs = conv.getMessages();
    assert.equal(msgs.length, 3);
    assert.deepEqual(msgs[1].tool_calls, toolCalls);
    assert.equal(msgs[2].role, 'tool');
    assert.equal(msgs[2].tool_call_id, 'call_123');
    assert.equal(msgs[2].name, 'read_file');
    assert.equal(msgs[2].content, 'console.log("hello")');
  });

  it('harus memangkas pesan lama saat trim() dengan mempertahankan system prompt', () => {
    const conv = new Conversation();
    for (let i = 0; i < 10; i++) {
      conv.addUserMessage(`User ${i}`);
      conv.addAssistantMessage(`Bot ${i}`);
    }
    // Total: 1 (system) + 20 = 21 messages
    assert.equal(conv.getMessages().length, 21);

    conv.trim(5);
    const trimmed = conv.getMessages();
    assert.equal(trimmed.length, 5);
    assert.equal(trimmed[0].role, 'system');
    assert.equal(trimmed[4].role, 'assistant');
    assert.equal(trimmed[4].content, 'Bot 9');
  });

  it('harus mengosongkan riwayat saat reset()', () => {
    const conv = new Conversation();
    conv.addUserMessage('Tanya 1');
    conv.reset();
    assert.equal(conv.getMessages().length, 1);
    assert.equal(conv.getMessages()[0].role, 'system');
  });
});

describe('Tahap 3A: Endpoint Builder', () => {
  it('harus menambahkan /chat/completions jika berakhiran /v1', () => {
    assert.equal(
      buildChatEndpoint('https://agentik.my.id/v1'),
      'https://agentik.my.id/v1/chat/completions'
    );
  });

  it('harus menambahkan /v1/chat/completions jika base URL umum', () => {
    assert.equal(
      buildChatEndpoint('https://agentik.my.id'),
      'https://agentik.my.id/v1/chat/completions'
    );
  });

  it('harus membiarkan URL yang sudah berakhiran /chat/completions', () => {
    assert.equal(
      buildChatEndpoint('https://openrouter.ai/api/v1/chat/completions'),
      'https://openrouter.ai/api/v1/chat/completions'
    );
  });

  it('harus menangani segmen versi lain seperti /v1beta (Google Gemini)', () => {
    assert.equal(
      buildChatEndpoint('https://generativelanguage.googleapis.com/v1beta/openai'),
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    );
    assert.equal(
      buildChatEndpoint('https://contoh.example.com/v1beta'),
      'https://contoh.example.com/v1beta/chat/completions'
    );
  });

  it('tidak boleh menyuntik /v1 ganda pada segmen yang mirip versi', () => {
    // '/v1x' bukan segmen versi → tetap diperlakukan sebagai base URL umum
    assert.equal(
      buildChatEndpoint('https://contoh.example.com/v1x'),
      'https://contoh.example.com/v1x/v1/chat/completions'
    );
  });
});

describe('Tahap 3A: SSE Streaming & Line Buffering Parser', () => {
  let server;
  let serverPort;

  it('harus meng-stream token secara utuh meskipun chunk SSE terbelah di tengah JSON', async () => {
    // Buat mock server lokal yang sengaja membelah paket TCP di tengah data JSON
    server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      // Split 1: chunk sengaja terpotong di tengah JSON
      res.write('data: {"choices":[{"delta":{"reasoning_content":"Pikir');
      setTimeout(() => {
        res.write('kan dulu..."}}]}\n\n');

        // Split 2: chunk konten utama
        res.write('data: {"choices":[{"delta":{"content":"Sugeng');
        setTimeout(() => {
          res.write(' enjang"}}]}\n\n');

          // Split 3: token penutup [DONE]
          res.write('data: [DONE]\n\n');
          res.end();
        }, 30);
      }, 30);
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    let started = false;
    let deltas = '';
    let reasoning = '';

    const result = await streamChatCompletion({
      credentials: {
        baseUrl: `http://127.0.0.1:${serverPort}/v1`,
        headers: { Authorization: 'Bearer test-token' },
        model: 'test-model',
      },
      messages: [{ role: 'user', content: 'test' }],
      onStart: () => { started = true; },
      onReasoning: (chunk) => { reasoning += chunk; },
      onDelta: (chunk) => { deltas += chunk; },
    });

    server.close();

    assert.equal(started, true);
    assert.equal(reasoning, 'Pikirkan dulu...');
    assert.equal(deltas, 'Sugeng enjang');
    assert.equal(result.content, 'Sugeng enjang');
    assert.equal(result.reasoning, 'Pikirkan dulu...');
    assert.equal(result.completed, true);
  });

  it('harus dapat dibatalkan di tengah jalan via AbortController dengan partialContent', async () => {
    const abortServer = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      res.write('data: {"choices":[{"delta":{"content":"Awal pesan "}}]}\n\n');
      // Jangan end, biarkan menggantung untuk di-abort
    });

    await new Promise((resolve) => abortServer.listen(0, '127.0.0.1', resolve));
    const port = abortServer.address().port;

    const controller = new AbortController();
    let received = '';

    const promise = streamChatCompletion({
      credentials: {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        headers: {},
        model: 'test-model',
      },
      messages: [{ role: 'user', content: 'test' }],
      signal: controller.signal,
      onDelta: (chunk) => {
        received += chunk;
        if (received.length > 3) {
          controller.abort();
        }
      },
    });

    await assert.rejects(
      promise,
      (err) => {
        assert.equal(err.name, 'AbortError');
        assert.equal(err.partialContent, 'Awal pesan ');
        return true;
      }
    );

    abortServer.close();
  });

  it('harus menangani HTTP Error (401/429/500) dengan status code yang tepat', async () => {
    const errServer = http.createServer((req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Rate limit exceeded' } }));
    });

    await new Promise((resolve) => errServer.listen(0, '127.0.0.1', resolve));
    const port = errServer.address().port;

    await assert.rejects(
      streamChatCompletion({
        credentials: {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          headers: {},
          model: 'test',
        },
        messages: [{ role: 'user', content: 'test' }],
      }),
      (err) => {
        assert.equal(err.status, 429);
        assert.match(err.message, /Rate limit exceeded/);
        return true;
      }
    );

    errServer.close();
  });

  it('harus mengurai reasoning & tool_calls pada baris terakhir tanpa [DONE]', async () => {
    const tailServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Halo "}}]}\n\n');
      // Baris terakhir sengaja tanpa newline penutup dan tanpa [DONE].
      res.write(
        'data: {"choices":[{"delta":{"reasoning_content":"pikir","tool_calls":[{"index":0,"id":"call_tail","type":"function","function":{"name":"read_file","arguments":"{}"}}]}}]}'
      );
      res.end();
    });

    await new Promise((resolve) => tailServer.listen(0, '127.0.0.1', resolve));
    const port = tailServer.address().port;

    const result = await streamChatCompletion({
      credentials: { baseUrl: `http://127.0.0.1:${port}/v1`, headers: {}, model: 'test' },
      messages: [{ role: 'user', content: 'test' }],
    });

    tailServer.close();
    assert.equal(result.content, 'Halo ');
    assert.equal(result.reasoning, 'pikir');
    assert.ok(result.tool_calls && result.tool_calls.length === 1);
    assert.equal(result.tool_calls[0].function.name, 'read_file');
  });
});

describe('Tahap 3A: Retry & Backoff Klien Streaming', () => {
  it('harus mencoba ulang saat provider mengembalikan 5xx lalu berhasil', async () => {
    let attempts = 0;
    const srv = http.createServer((req, res) => {
      attempts += 1;
      if (attempts === 1) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'temporarily unavailable' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Pulih"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = srv.address().port;

    const result = await streamChatCompletion({
      credentials: { baseUrl: `http://127.0.0.1:${port}/v1`, headers: {}, model: 'test' },
      messages: [{ role: 'user', content: 'test' }],
      retryDelayMs: 0,
    });

    srv.close();
    assert.equal(result.content, 'Pulih');
    assert.equal(attempts, 2, 'harus mengirim ulang tepat sekali setelah 503');
  });

  it('harus menyerah setelah batas retry tercapai (1 awal + 2 retry)', async () => {
    let attempts = 0;
    const srv = http.createServer((req, res) => {
      attempts += 1;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'boom' } }));
    });

    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = srv.address().port;

    await assert.rejects(
      streamChatCompletion({
        credentials: { baseUrl: `http://127.0.0.1:${port}/v1`, headers: {}, model: 'test' },
        messages: [{ role: 'user', content: 'test' }],
        maxRetries: 2,
        retryDelayMs: 0,
      }),
      (err) => {
        assert.equal(err.status, 500);
        return true;
      }
    );

    srv.close();
    assert.equal(attempts, 3);
  });

  it('tidak boleh mengulang permintaan 4xx klien', async () => {
    let attempts = 0;
    const srv = http.createServer((req, res) => {
      attempts += 1;
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'bad request' } }));
    });

    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = srv.address().port;

    await assert.rejects(
      streamChatCompletion({
        credentials: { baseUrl: `http://127.0.0.1:${port}/v1`, headers: {}, model: 'test' },
        messages: [{ role: 'user', content: 'test' }],
        retryDelayMs: 0,
      }),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );

    srv.close();
    assert.equal(attempts, 1, '4xx bukan gangguan sesaat, tidak diulang');
  });
});

describe('Klasifikasi Error Jaringan', () => {
  it('harus mengenali timeout & kode transport, dan menolak error HTTP biasa', () => {
    assert.equal(isNetworkError(Object.assign(new Error('x'), { name: 'TimeoutError' })), true);
    assert.equal(isNetworkError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), true);
    assert.equal(
      isNetworkError(Object.assign(new Error('x'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })),
      true
    );
    assert.equal(isNetworkError(Object.assign(new Error('x'), { status: 401 })), false);
    assert.equal(isNetworkError(null), false);
  });
});
