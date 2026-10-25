import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARS_PER_TOKEN,
  DEFAULT_CONTEXT_WINDOW,
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  resolveContextWindow,
  getContextUsage,
  formatContextIndicator,
  formatContextWarning,
  noteRealTokenUsage,
  clearRealTokenUsage,
} from '../src/chat/context.js';
import { Conversation } from '../src/chat/conversation.js';

describe('Context: Estimasi Token', () => {
  it('harus memperkirakan dari panjang teks dengan rasio karakter per token', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('a'.repeat(CHARS_PER_TOKEN * 10)), 10);
    assert.equal(estimateTokens('a'.repeat(CHARS_PER_TOKEN * 10 + 1)), 11);
  });

  it('harus mengembalikan 0 untuk masukan kosong', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
  });

  it('harus memperkirakan gambar dari ukuran base64, bukan flat 500 token', () => {
    // Gambar kecil: biaya wajar, tidak nol.
    const kecil = estimateTokens([
      { type: 'text', text: 'lihat' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(1000)}` } },
    ]);

    // Gambar besar (≈5 MB): harus jauh melampaui 500 token agar trim/compact
    // terpicu sebelum request menembus batas konteks.
    const besar = estimateTokens([
      { type: 'text', text: 'lihat' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(5 * 1024 * 1024)}` } },
    ]);

    assert.ok(kecil > 0);
    // 5 MB base64 ≈ 3,9 MB data gambar ≈ 5.245 token pada rasio 750 byte/token.
    // Yang penting: JAUH di atas 500 token flat, sehingga trim/compact terpicu.
    assert.ok(besar > 5000, `gambar besar harus diestimasi jauh di atas 500 token, dapat ${besar}`);
    assert.ok(besar > kecil);
  });

  it('harus memakai biaya konservatif untuk URL gambar eksternal', () => {
    const tokens = estimateTokens([
      { type: 'image_url', image_url: { url: 'https://contoh.com/gambar.png' } },
    ]);
    assert.ok(tokens > 500);
  });

  it('harus menghitung tool_calls sebagai bagian dari ukuran pesan', () => {
    const kecil = { role: 'assistant', content: 'ok' };
    const besar = {
      role: 'assistant',
      content: 'ok',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' } },
      ],
    };
    assert.ok(estimateMessageTokens(besar) > estimateMessageTokens(kecil));
  });

  it('harus menghitung reasoning_content sebagai bagian dari ukuran pesan', () => {
    const tanpaReasoning = { role: 'assistant', content: 'Jawaban' };
    const denganReasoning = {
      role: 'assistant',
      content: 'Jawaban',
      reasoning_content: 'Langkah berpikir analitis mendalam '.repeat(20),
    };
    assert.ok(estimateMessageTokens(denganReasoning) > estimateMessageTokens(tanpaReasoning));
  });

  it('harus menjumlahkan seluruh pesan', () => {
    const messages = [
      { role: 'system', content: 'a'.repeat(400) },
      { role: 'user', content: 'b'.repeat(400) },
      { role: 'assistant', content: 'c'.repeat(400) },
    ];
    assert.equal(estimateMessagesTokens(messages), estimateMessagesTokens(messages));
    assert.ok(estimateMessagesTokens(messages) > 300);
  });

  it('harus menangani masukan bukan array tanpa melempar error', () => {
    assert.equal(estimateMessagesTokens(null), 0);
    assert.equal(estimateMessagesTokens(undefined), 0);
    assert.equal(estimateMessagesTokens('bukan array'), 0);
  });
});

describe('Context: Resolusi Context Window', () => {
  it('harus memakai default untuk model yang tidak dikenali', () => {
    assert.equal(resolveContextWindow('model-tak-dikenal-xyz'), DEFAULT_CONTEXT_WINDOW);
    assert.equal(resolveContextWindow(null), DEFAULT_CONTEXT_WINDOW);
    assert.equal(resolveContextWindow(''), DEFAULT_CONTEXT_WINDOW);
  });

  it('harus mengenali beberapa keluarga model', () => {
    assert.equal(resolveContextWindow('gemini-3.8-flash-high'), 1000000);
    assert.equal(resolveContextWindow('gpt-4o-mini'), 128000);
    assert.equal(resolveContextWindow('claude-sonnet-4'), 200000);
    assert.equal(resolveContextWindow('deepseek-r1'), 128000);
    assert.equal(resolveContextWindow('Beam-1.0-501B-A23B'), 1000000);
    assert.equal(resolveContextWindow('reflection-v1'), 1000000);
  });

  it('harus mencocokkan sebagian nama model tanpa memandang huruf besar-kecil', () => {
    assert.equal(resolveContextWindow('GEMINI-2.5-PRO'), 1000000);
    assert.equal(resolveContextWindow('BEAM-1.0'), 1000000);
  });
});

describe('Context: Pemakaian Konteks', () => {
  const pesanPendek = [{ role: 'system', content: 'halo' }];

  it('harus melaporkan sisa konteks dalam persen', () => {
    const usage = getContextUsage(pesanPendek, { contextWindow: 1000 });
    assert.equal(usage.total, 1000);
    assert.ok(usage.used > 0);
    assert.equal(usage.percentLeft + usage.percentUsed, 100);
    assert.equal(usage.overBudget, false);
  });

  it('harus menandai overBudget saat melebihi jendela', () => {
    const usage = getContextUsage(
      [{ role: 'user', content: 'x'.repeat(80_000) }],
      { contextWindow: 1000 }
    );
    assert.equal(usage.overBudget, true);
    assert.equal(usage.remaining, 0);
    assert.equal(usage.percentLeft, 0);
  });

  it('harus menghormati contextWindow eksplisit di atas model', () => {
    const usage = getContextUsage(pesanPendek, { model: 'gemini-3.8-flash-high', contextWindow: 5000 });
    assert.equal(usage.total, 5000);
  });

  it('harus memakai context window dari model bila tidak diberi angka', () => {
    const usage = getContextUsage(pesanPendek, { model: 'gemini-3.8-flash-high' });
    assert.equal(usage.total, 1000000);
  });
});

describe('Context: Format Label', () => {
  const usage = getContextUsage([{ role: 'user', content: 'x'.repeat(4000) }], { contextWindow: 10_000 });

  it('harus menampilkan persentase sisa konteks dengan meter', () => {
    const out = formatContextIndicator(usage, { useColor: false });
    assert.match(out, /Konteks [▓░]+ \d+%/);
  });

  it('harus menandai angka sebagai perkiraan (≈) selama masih estimasi', () => {
    assert.match(formatContextIndicator(usage, { useColor: false }), /≈/);
  });

  it('angka REAL dari provider tampil tanpa tanda ≈', () => {
    noteRealTokenUsage({ promptTokens: 2500, messageCount: 1 });
    const real = getContextUsage([{ role: 'user', content: 'x'.repeat(4000) }], { contextWindow: 10_000 });
    assert.equal(real.source, 'real');
    const out = formatContextIndicator(real, { useColor: false, detail: true });
    assert.ok(!out.includes('≈'), `tidak boleh memuat ≈: ${out}`);
    assert.match(out, /2\.5k\/10k token/);
    clearRealTokenUsage();
  });

  it('meter terisi penuh saat konteks lega dan kosong saat habis', () => {
    const lega = { percentLeft: 100, used: 0, total: 100, source: 'estimate' };
    const habis = { percentLeft: 0, used: 100, total: 100, overBudget: true, source: 'estimate' };
    assert.match(formatContextIndicator(lega, { useColor: false, detail: false }), /Konteks ▓{10} 100%/);
    assert.match(formatContextIndicator(habis, { useColor: false, detail: false }), /Konteks ░{10} 0%/);
  });

  it('harus membulatkan angka besar ke satuan ribuan', () => {
    // 800.000 karakter ≈ 200.000 token, melampaui jendela 128.000.
    const besar = getContextUsage([{ role: 'user', content: 'x'.repeat(800_000) }], {
      contextWindow: 128_000,
    });
    const out = formatContextIndicator(besar, { useColor: false });
    assert.match(out, /≈ 200k\/128k token/);
  });

  it('harus tidak menghasilkan escape ANSI saat useColor false', () => {
    const out = formatContextIndicator(usage, { useColor: false });
    assert.equal(/\x1b\[/.test(out), false);
  });

  it('harus mengembalikan string kosong untuk masukan tidak valid', () => {
    assert.equal(formatContextIndicator(null, { useColor: false }), '');
    assert.equal(formatContextWarning(undefined, { useColor: false }), '');
  });
});

describe('Context: Usage Real dari Provider', () => {
  beforeEach(() => clearRealTokenUsage());

  it('jumlah pesan sama persis → angka exact (source real)', () => {
    noteRealTokenUsage({ promptTokens: 7_500, messageCount: 2 });
    const usage = getContextUsage(
      [
        { role: 'user', content: 'x'.repeat(4000) },
        { role: 'assistant', content: 'y'.repeat(4000) },
      ],
      { contextWindow: 10_000 }
    );
    assert.equal(usage.source, 'real');
    assert.equal(usage.used, 7500);
    assert.equal(usage.percentLeft, 25);
  });

  it('riwayat bertambah → basis real + estimasi delta (source blended)', () => {
    noteRealTokenUsage({ promptTokens: 5_000, messageCount: 1 });
    const usage = getContextUsage(
      [
        { role: 'user', content: 'x'.repeat(4000) },
        { role: 'user', content: 'y'.repeat(4000) }, // +≈1000 token estimasi
      ],
      { contextWindow: 10_000 }
    );
    assert.equal(usage.source, 'blended');
    assert.ok(usage.used >= 5900 && usage.used <= 6100, `used=${usage.used}`);
  });

  it('riwayat menyusut (trim/clear) → usage real dibuang, kembali estimasi', () => {
    noteRealTokenUsage({ promptTokens: 9_000, messageCount: 3 });
    const usage = getContextUsage([{ role: 'user', content: 'kecil' }], { contextWindow: 10_000 });
    assert.equal(usage.source, 'estimate');
  });

  it('masukan tidak valid diabaikan', () => {
    noteRealTokenUsage({ promptTokens: -5, messageCount: 1 });
    noteRealTokenUsage({ promptTokens: 100 });
    const usage = getContextUsage([{ role: 'user', content: 'a' }], { contextWindow: 1000 });
    assert.equal(usage.source, 'estimate');
  });

  it('reset/ganti percakapan membuang snapshot usage lama walau jumlah pesan sama', () => {
    const conv = new Conversation();
    noteRealTokenUsage({ promptTokens: 9_000, messageCount: conv.getMessages().length });
    conv.reset(); // /clear, /reset, dan resume semuanya lewat jalur ini
    const usage = getContextUsage(conv.getMessages(), { contextWindow: 10_000 });
    assert.equal(usage.source, 'estimate');
  });
});

describe('Context: Peringatan Konteks Menipis', () => {
  it('harus diam saat konteks masih lega', () => {
    const usage = getContextUsage([{ role: 'user', content: 'pendek' }], { contextWindow: 128_000 });
    assert.equal(formatContextWarning(usage, { useColor: false }), '');
  });

  it('harus memberi peringatan kuning saat konteks di bawah 25%', () => {
    // 320.000 karakter ≈ 80.000 token dari jendela 100.000 → sisa 20%.
    const usage = getContextUsage([{ role: 'user', content: 'x'.repeat(320_000) }], {
      contextWindow: 100_000,
    });
    const warn = formatContextWarning(usage, { useColor: false });
    assert.match(warn, /^⚡ Konteks tinggal 20%/);
    assert.match(warn, /\/clear/);
  });

  it('harus memberi peringatan merah saat konteks di bawah 10%', () => {
    // 380.000 karakter ≈ 95.000 token dari jendela 100.000 → sisa 5%.
    const usage = getContextUsage([{ role: 'user', content: 'x'.repeat(380_000) }], {
      contextWindow: 100_000,
    });
    const warn = formatContextWarning(usage, { useColor: false });
    assert.match(warn, /^⚠️  Konteks tinggal 5%/);
  });

  it('harus memberi peringatan khusus saat konteks melampaui batas', () => {
    // 500.000 karakter ≈ 125.000 token, melampaui jendela 100.000.
    const usage = getContextUsage([{ role: 'user', content: 'x'.repeat(500_000) }], {
      contextWindow: 100_000,
    });
    assert.equal(usage.overBudget, true);
    assert.match(formatContextWarning(usage, { useColor: false }), /Riwayat dipangkas otomatis/);
  });

  it('harus diam pada level 50% yang masih aman', () => {
    const usage = getContextUsage([{ role: 'user', content: 'x'.repeat(200_000) }], {
      contextWindow: 100_000,
    });
    assert.equal(usage.percentLeft, 50);
    assert.equal(formatContextWarning(usage, { useColor: false }), '');
  });

  it('harus tidak menghasilkan escape ANSI saat useColor false', () => {
    const usage = getContextUsage([{ role: 'user', content: 'x'.repeat(380_000) }], {
      contextWindow: 100_000,
    });
    assert.equal(/\x1b\[/.test(formatContextWarning(usage, { useColor: false })), false);
  });
});

describe('Context: Pemangkasan Sadar-Token', () => {
  /** Invarian utama: setiap pesan `tool` harus punya pasangan assistant. */
  const assertToolPairsIntact = (messages) => {
    const seenCallIds = new Set();
    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) seenCallIds.add(tc.id);
      }
      if (msg.role === 'tool') {
        assert.ok(
          seenCallIds.has(msg.tool_call_id),
          `pesan tool '${msg.tool_call_id}' kehilangan pasangan assistant-nya`
        );
      }
    }
  };

  const buatPercakapan = () => {
    const conv = new Conversation();
    conv.addUserMessage('tanya pertama');
    conv.addAssistantMessage('', [
      { id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' } },
      { id: 'call_b', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.js"}' } },
    ]);
    conv.addToolResult('call_a', 'hasil file a '.repeat(200), 'read_file');
    conv.addToolResult('call_b', 'hasil file b '.repeat(200), 'read_file');
    conv.addUserMessage('tanya kedua');
    conv.addAssistantMessage('jawaban kedua');
    return conv;
  };

  const ukuranPenuh = () => estimateMessagesTokens(buatPercakapan().getMessages());

  it('harus tidak memangkas saat riwayat masih di bawah anggaran', () => {
    const conv = buatPercakapan();
    const before = conv.getMessages().length;
    const result = conv.trimToTokenBudget(ukuranPenuh() + 1000);
    assert.equal(result.trimmed, false);
    assert.equal(result.removed, 0);
    assert.equal(conv.getMessages().length, before);
  });

  it('harus memangkas pesan terlama saat melampaui anggaran', () => {
    const conv = buatPercakapan();
    const before = conv.getMessages().length;
    const result = conv.trimToTokenBudget(ukuranPenuh() - 50);
    assert.equal(result.trimmed, true);
    assert.ok(result.removed > 0);
    assert.ok(conv.getMessages().length < before);
  });

  it('harus selalu mempertahankan system prompt', () => {
    const conv = buatPercakapan();
    conv.trimToTokenBudget(ukuranPenuh() - 100);
    const messages = conv.getMessages();
    assert.equal(messages[0].role, 'system');
    assert.ok(messages.length >= 1);
  });

  it('harus menjaga pasangan tool pada sapuan anggaran melintasi batas pemotongan', () => {
    // Disapu rapat karena memangkas di tengah blok tool adalah kasus paling rawan.
    const total = ukuranPenuh();
    for (let step = 0; step <= 80; step += 1) {
      const conv = buatPercakapan();
      conv.trimToTokenBudget(Math.max(1, total - step * 25));
      assertToolPairsIntact(conv.getMessages());
    }
  });

  it('harus membuang blok tool secara utuh, bukan separuh', () => {
    // Kalau hanya pesan assistant-nya yang dibuang, pesan tool menggantung
    // dan provider akan menolak request.
    const conv = buatPercakapan();
    conv.trimToTokenBudget(ukuranPenuh() - 400);
    const messages = conv.getMessages();
    const orphanTools = messages.filter((m) => m.role === 'tool');
    const callIds = new Set(
      messages.flatMap((m) => (Array.isArray(m.tool_calls) ? m.tool_calls.map((t) => t.id) : []))
    );
    for (const t of orphanTools) {
      assert.ok(callIds.has(t.tool_call_id), `tool ${t.tool_call_id} menggantung tanpa pemanggil`);
    }
  });

  it('harus melaporkan masihOverBudget bila system prompt saja sudah terlalu besar', () => {
    const conv = buatPercakapan();
    const result = conv.trimToTokenBudget(1);
    assert.equal(result.stillOverBudget, true);
    const messages = conv.getMessages();
    // Prompt user terakhir selalu dipertahankan agar request tidak hilang.
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
  });

  it('harus menjamin anggaran terpenuhi setelah pemangkasan', () => {
    const budget = ukuranPenuh() - 300;
    const conv = buatPercakapan();
    const result = conv.trimToTokenBudget(budget);
    assert.equal(result.stillOverBudget, false);
    assert.ok(estimateMessagesTokens(conv.getMessages()) <= budget);
  });

  it('harus memakai 80% context window model bila anggaran tidak diberikan', () => {
    const conv = buatPercakapan();
    const result = conv.trimToTokenBudget(undefined, { model: 'gemini-3.8-flash-high' });
    // Jendela 1.000.000 dengan budget 80% = 800.000 token; riwayat kecil tidak kena.
    assert.equal(result.trimmed, false);
  });

  it('harus memakai budget 80% dari jendela model saat pemangkasan dipanggil', () => {
    // Satu hasil tool besar: ~125.000 token. Di bawah jendela 128k * 80% = 102.400
    // untuk gpt-4o-mini (jadi terpangkas), tapi jauh di bawah 1.000.000 * 80%
    // untuk Gemini (jadi tidak tersentuh).
    const buatBesar = () => {
      const conv = new Conversation();
      conv.addUserMessage('minta baca berkas besar');
      conv.addAssistantMessage('', [
        { id: 'call_big', type: 'function', function: { name: 'read_file', arguments: '{"path":"besar.js"}' } },
      ]);
      conv.addToolResult('call_big', 'x'.repeat(500_000), 'read_file');
      return conv;
    };

    assert.equal(buatBesar().trimToTokenBudget(undefined, { model: 'gpt-4o-mini' }).trimmed, true);
    assert.equal(buatBesar().trimToTokenBudget(undefined, { model: 'gemini-3.8-flash-high' }).trimmed, false);
  });

  it('harus menghormati contextWindow eksplisit pada pemangkasan', () => {
    const conv = buatPercakapan();
    const result = conv.trimToTokenBudget(undefined, { contextWindow: 1000 });
    assert.equal(result.trimmed, true);
    assert.equal(result.stillOverBudget, true, 'system prompt sendiri sudah melewati 1.000 token');
  });

  it('harus tetap aman pada percakapan tanpa tool sama sekali', () => {
    const conv = new Conversation();
    for (let i = 0; i < 20; i++) {
      conv.addUserMessage(`pertanyaan ${i} ${'x'.repeat(100)}`);
      conv.addAssistantMessage(`jawaban ${i} ${'y'.repeat(100)}`);
    }
    const budget = estimateMessagesTokens(conv.getMessages()) - 200;
    const result = conv.trimToTokenBudget(budget);
    assert.equal(result.trimmed, true);
    assertToolPairsIntact(conv.getMessages());
    assert.equal(conv.getMessages()[0].role, 'system');
    assert.ok(estimateMessagesTokens(conv.getMessages()) <= budget);
  });
});
