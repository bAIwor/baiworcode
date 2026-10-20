import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertHttpUrl,
  assertSafeFetchUrl,
  isPrivateAddress,
  htmlToText,
  parseDuckDuckGo,
  handleWebFetch,
  handleWebSearch,
  handleWebAutomate,
} from '../src/tools/webTool.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Membuat Response tiruan untuk pengujian. */
function mockResponse({ status = 200, statusText = 'OK', url, contentType, body }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    url,
    headers: {
      get: (name) => (String(name).toLowerCase() === 'content-type' ? contentType ?? null : null),
    },
    arrayBuffer: async () => Buffer.from(body ?? '', 'utf8'),
    text: async () => String(body ?? ''),
    json: async () => JSON.parse(body ?? '{}'),
  };
}

describe('webTool: assertHttpUrl', () => {
  it('menerima http dan https', () => {
    assert.equal(assertHttpUrl('https://example.com/x').host, 'example.com');
    assert.equal(assertHttpUrl('http://localhost:3000').protocol, 'http:');
  });

  it('menolak skema lain dan URL rusak', () => {
    assert.throws(() => assertHttpUrl('ftp://example.com'), /Skema URL tidak didukung/);
    assert.throws(() => assertHttpUrl('bukan url'), /URL tidak valid/);
  });
});

describe('webTool: proteksi SSRF', () => {
  it('mengenali alamat privat/loopback/link-local dan metadata cloud', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:a9fe:a9fe',
    ]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });

  it('menolak URL ke localhost/IP privat dan menerima host publik', async () => {
    await assert.rejects(() => assertSafeFetchUrl('http://127.0.0.1:3000'), /SSRF|privat|loopback/i);
    await assert.rejects(() => assertSafeFetchUrl('http://localhost:3000'), /SSRF|localhost/i);
    await assert.rejects(() => assertSafeFetchUrl('http://169.254.169.254/latest/meta-data'), /SSRF|privat/i);
    const ok = await assertSafeFetchUrl('https://8.8.8.8/x', { skipDns: true });
    assert.equal(ok.hostname, '8.8.8.8');
  });

  it('handleWebFetch menolak redirect yang menuju localhost', async () => {
    globalThis.fetch = async (url) => {
      assert.equal(String(url), 'https://example.com/start');
      return {
        ok: false,
        status: 302,
        statusText: 'Found',
        url: String(url),
        headers: {
          get: (name) => (String(name).toLowerCase() === 'location' ? 'http://127.0.0.1/secret' : null),
        },
        body: { cancel: async () => {} },
        arrayBuffer: async () => Buffer.from(''),
      };
    };

    const res = await handleWebFetch({ url: 'https://example.com/start' });
    assert.equal(res.success, false);
    assert.match(res.output, /SSRF|privat|loopback/i);
  });
});

describe('webTool: htmlToText', () => {
  it('membuang skrip/gaya dan mempertahankan isi serta tautan', () => {
    const html =
      '<html><head><title>T</title><style>.x{}</style></head>' +
      '<body><h1>Judul</h1><p>Halo &amp; dunia</p>' +
      '<ul><li>Satu</li><li>Dua</li></ul>' +
      '<a href="https://x.test/doc">Tautan</a>' +
      '<script>var a = 1;</script></body></html>';
    const text = htmlToText(html);
    assert.match(text, /Judul/);
    assert.match(text, /Halo & dunia/);
    assert.match(text, /- Satu/);
    assert.match(text, /Tautan \(https:\/\/x\.test\/doc\)/);
    assert.doesNotMatch(text, /var a = 1/);
    assert.doesNotMatch(text, /\.x\{\}/);
  });

  it('menerjemahkan entitas heksadesimal', () => {
    assert.match(htmlToText('<p>it&#x27;s ok</p>'), /it's ok/);
  });
});

describe('webTool: parseDuckDuckGo', () => {
  it('mengekstrak judul, URL asli (buka redirect), dan ringkasan', () => {
    const html =
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc">Dokumentasi</a>' +
      '<a class="result__snippet">Penjelasan singkat</a>';
    const results = parseDuckDuckGo(html, 5);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Dokumentasi');
    assert.equal(results[0].url, 'https://example.com/doc');
    assert.equal(results[0].snippet, 'Penjelasan singkat');
  });
});

describe('webTool: handleWebFetch', () => {
  it('mengambil HTML lalu mengembalikannya sebagai teks', async () => {
    globalThis.fetch = async (url) =>
      mockResponse({
        url: String(url),
        contentType: 'text/html; charset=utf-8',
        body: '<h1>Halo</h1><p>Dunia</p>',
      });
    const res = await handleWebFetch({ url: 'https://example.com' });
    assert.equal(res.success, true);
    assert.match(res.output, /HTTP 200/);
    assert.match(res.output, /Halo/);
    assert.doesNotMatch(res.output, /<h1>/);
  });

  it('menghormati mode raw (tanpa pembersihan)', async () => {
    globalThis.fetch = async (url) =>
      mockResponse({ url: String(url), contentType: 'text/html', body: '<h1>Halo</h1>' });
    const res = await handleWebFetch({ url: 'https://example.com', raw: true });
    assert.match(res.output, /<h1>Halo<\/h1>/);
  });

  it('memotong isi sesuai max_chars', async () => {
    globalThis.fetch = async (url) =>
      mockResponse({ url: String(url), contentType: 'text/plain', body: 'x'.repeat(5000) });
    const res = await handleWebFetch({ url: 'https://example.com', max_chars: 500 });
    assert.match(res.output, /dipotong/);
  });

  it('mengembalikan pesan ramah saat URL tidak valid', async () => {
    const res = await handleWebFetch({ url: 'ftp://example.com' });
    assert.equal(res.success, false);
    assert.match(res.output, /Skema URL tidak didukung/);
  });

  it('menangkap kegagalan jaringan', async () => {
    globalThis.fetch = async () => {
      throw new Error('boom');
    };
    const res = await handleWebFetch({ url: 'https://example.com' });
    assert.equal(res.success, false);
    assert.match(res.output, /Gagal mengambil/);
  });
});

describe('webTool: handleWebSearch', () => {
  it('mengembalikan daftar hasil terformat', async () => {
    globalThis.fetch = async () =>
      mockResponse({
        contentType: 'text/html',
        body:
          '<a class="result__a" href="https://example.com/a">Hasil A</a>' +
          '<a class="result__snippet">Ringkasan A</a>' +
          '<a class="result__a" href="https://example.com/b">Hasil B</a>' +
          '<a class="result__snippet">Ringkasan B</a>',
      });
    const res = await handleWebSearch({ query: 'nodejs fetch' });
    assert.equal(res.success, true);
    assert.match(res.output, /Hasil A/);
    assert.match(res.output, /https:\/\/example\.com\/b/);
    assert.match(res.output, /Ringkasan B/);
  });

  it('menolak query kosong', async () => {
    const res = await handleWebSearch({ query: '   ' });
    assert.equal(res.success, false);
    assert.match(res.output, /query/);
  });

  it('memberi pesan jelas bila tak ada hasil terbaca', async () => {
    globalThis.fetch = async () => mockResponse({ contentType: 'text/html', body: '<html></html>' });
    const res = await handleWebSearch({ query: 'q' });
    assert.equal(res.success, true);
    assert.match(res.output, /Tidak ada hasil/);
  });
});

describe('webTool: Integrasi TinyFish', () => {
  it('handleWebSearch menggunakan TinyFish Search API saat key aktif', async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('api.search.tinyfish.ai')) {
        return mockResponse({
          contentType: 'application/json',
          body: JSON.stringify({
            results: [
              {
                title: 'Dokumentasi bAIwor',
                url: 'https://baiwor.my.id/docs',
                snippet: 'Panduan lengkap AI Agent Banyumasan.',
                site_name: 'baiwor.my.id',
              },
            ],
          }),
        });
      }
      return mockResponse({ status: 500, body: 'upstream error' });
    };

    const res = await handleWebSearch({ query: 'baiwor docs' });
    assert.equal(res.success, true);
    assert.match(res.output, /TinyFish Search/);
    assert.match(res.output, /Dokumentasi bAIwor/);
    assert.match(res.output, /https:\/\/baiwor\.my\.id\/docs/);
  });

  it('handleWebFetch menggunakan TinyFish Fetch API untuk ekstraksi markdown', async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('api.fetch.tinyfish.ai')) {
        return mockResponse({
          contentType: 'application/json',
          body: JSON.stringify({
            results: [
              {
                url: 'https://baiwor.my.id',
                title: 'bAIwor Official',
                description: 'AI Agent Banyumas',
                text: '# Selamat Datang di bAIwor\n\nAI tangguh berjiwa Bawor.',
              },
            ],
          }),
        });
      }
      return mockResponse({ status: 500, body: 'error' });
    };

    const res = await handleWebFetch({ url: 'https://baiwor.my.id' });
    assert.equal(res.success, true);
    assert.match(res.output, /TinyFish Fetch/);
    assert.match(res.output, /bAIwor Official/);
    assert.match(res.output, /AI tangguh berjiwa Bawor/);
  });

  it('handleWebAutomate menolak URL invalid dan goal kosong', async () => {
    const res1 = await handleWebAutomate({ url: 'bukan-url', goal: 'lakukan sesuatu' });
    assert.equal(res1.success, false);
    assert.match(res1.output, /URL tidak valid/);

    const res2 = await handleWebAutomate({ url: 'https://example.com', goal: '   ' });
    assert.equal(res2.success, false);
    assert.match(res2.output, /goal/);
  });

  it('handleWebAutomate mengeksekusi automasi dan mengembalikan hasil terstruktur', async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/v1/automation/run')) {
        return mockResponse({
          contentType: 'application/json',
          body: JSON.stringify({
            run_id: 'run-test-123',
            status: 'COMPLETED',
            num_of_steps: 3,
            result: {
              top_story: 'Berita Hebat Banyumas',
              url: 'https://news.example.com/1',
            },
          }),
        });
      }
      return mockResponse({ status: 500, body: 'upstream error' });
    };

    const res = await handleWebAutomate({
      url: 'https://news.example.com',
      goal: 'Ambil top story',
    });
    assert.equal(res.success, true);
    assert.match(res.output, /COMPLETED/);
    assert.match(res.output, /Berita Hebat Banyumas/);
    assert.match(res.output, /3 langkah/);
    assert.match(res.output, /run-test-123/);
  });
});
