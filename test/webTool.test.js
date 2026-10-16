import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertHttpUrl,
  htmlToText,
  parseDuckDuckGo,
  handleWebFetch,
  handleWebSearch,
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
