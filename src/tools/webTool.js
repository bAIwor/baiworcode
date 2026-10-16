/**
 * Tool akses web untuk bAIwor Code: `webfetch` dan `websearch`.
 *
 * Tanpa tool ini, agen hanya bisa membaca internet lewat `run_command` + curl —
 * kaku, mudah kena sandbox/approval, dan menyisakan sampah HTML di konteks.
 * Modul ini memakai `fetch` bawaan Node (>=18) tanpa dependensi baru.
 *
 * Prinsip:
 *   - Hanya skema http/https.
 *   - Batas ukuran & waktu agar tidak menggantung atau membanjiri konteks.
 *   - HTML diubah menjadi teks sederhana (judul, tautan, isi) supaya hemat token.
 */

const DEFAULT_MAX_CHARS = 20000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const FETCH_TIMEOUT_MS = 30000;

const USER_AGENT = 'bAIworCode/1.0 (+https://baiwor.my.id)';

/**
 * Memvalidasi URL: harus http/https dan dapat diurai.
 * @param {string} raw
 * @returns {URL}
 */
export function assertHttpUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error(`URL tidak valid: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Skema URL tidak didukung (${url.protocol}). Gunakan http atau https.`);
  }
  return url;
}

/** Mengubah entitas HTML umum menjadi karakter aslinya. */
function decodeEntities(text) {
  const map = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };
  return String(text)
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z]+;/gi, (m) => map[m.toLowerCase()] ?? m);
}

/**
 * Mengubah HTML menjadi teks yang enak dibaca model: bookmark blok jadi baris,
 * daftar jadi butir, tautan mempertahankan URL-nya, tag dibuang.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  let s = String(html ?? '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ');
  // Tautan: pertahankan teks + tujuan.
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const text = decodeEntities(label.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return text ? `${text} (${href})` : href;
  });
  // Judul & blok → baris baru.
  s = s.replace(/<(h[1-6]|p|div|section|article|header|footer|tr|ul|ol|table|blockquote)[^>]*>/gi, '\n');
  s = s.replace(/<\/?(br|hr)\s*\/?>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n- ');
  // Sisa tag dibuang.
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  // Rapikan spasi & baris kosong beruntun.
  s = s.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/**
 * Mengambil isi sebuah URL dan mengembalikannya sebagai teks.
 *
 * @param {{url:string, max_chars?:number, raw?:boolean}} args
 * @returns {Promise<{success:boolean, output:string}>}
 */
export async function handleWebFetch({ url, max_chars = DEFAULT_MAX_CHARS, raw = false } = {}) {
  let target;
  try {
    target = assertHttpUrl(url);
  } catch (err) {
    return { success: false, output: `Error: ${err.message}` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(target.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json,text/plain,*/*' },
    });

    const contentType = res.headers?.get?.('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    const truncated = buf.length > MAX_BYTES;
    let text = buf.subarray(0, MAX_BYTES).toString('utf8');

    if (!raw && /html|xhtml/i.test(contentType)) {
      text = htmlToText(text);
    }

    const maxChars = Math.max(500, Number(max_chars) || DEFAULT_MAX_CHARS);
    if (text.length > maxChars) {
      text = `${text.slice(0, maxChars)}\n\n… [isi dipotong pada ${maxChars} karakter]`;
    }

    const header =
      `HTTP ${res.status} ${res.statusText || ''}\n` +
      `URL: ${res.url || target.href}\n` +
      `Tipe: ${contentType || 'tak diketahui'}${truncated ? ' (diambil 2 MB pertama)' : ''}\n\n`;

    return { success: res.ok, output: header + text };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'melebihi batas waktu 30 detik' : err.message;
    return { success: false, output: `Gagal mengambil ${target.href}: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Mengembalikan URL asli dari tautan hasil DuckDuckGo yang dibungkus redirect. */
function unwrapDdgUrl(href) {
  const raw = decodeEntities(String(href || ''));
  try {
    const u = new URL(raw, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : raw;
  } catch {
    return raw;
  }
}

/**
 * Mengekstrak hasil dari HTML DuckDuckGo (html.duckduckgo.com).
 * @param {string} html
 * @param {number} maxResults
 * @returns {Array<{title:string, url:string, snippet:string}>}
 */
export function parseDuckDuckGo(html, maxResults) {
  const results = [];
  const linkRe =
    /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe =
    /<(?:a|div)\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/gi;

  const snippets = [];
  let sm;
  while ((sm = snippetRe.exec(html)) !== null) {
    snippets.push(decodeEntities(sm[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
  }

  let m;
  while ((m = linkRe.exec(html)) !== null && results.length < maxResults) {
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const url = unwrapDdgUrl(m[1]);
    const snippet = snippets[results.length] || '';
    if (title && url) results.push({ title, url, snippet });
  }
  return results;
}

/**
 * Mencari di web (mesin DuckDuckGo, tanpa API key).
 *
 * @param {{query:string, max_results?:number}} args
 * @returns {Promise<{success:boolean, output:string}>}
 */
export async function handleWebSearch({ query, max_results = 5 } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return { success: false, output: 'Error: parameter "query" wajib diisi.' };

  const maxResults = Math.min(10, Math.max(1, Number(max_results) || 5));
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(endpoint, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
    });
    if (!res.ok) {
      return { success: false, output: `Pencarian gagal: HTTP ${res.status} ${res.statusText || ''}` };
    }
    const html = await res.text();
    const results = parseDuckDuckGo(html, maxResults);

    if (!results.length) {
      return {
        success: true,
        output: `Tidak ada hasil yang terbaca untuk "${q}". Mesin pencari mungkin memblokir atau formatnya berubah — coba kata kunci lain, atau gunakan webfetch pada URL spesifik.`,
      };
    }

    const lines = results.map((r, i) => {
      const snippet = r.snippet ? `\n   ${r.snippet}` : '';
      return `${i + 1}. ${r.title}\n   ${r.url}${snippet}`;
    });
    return { success: true, output: `Hasil untuk "${q}":\n\n${lines.join('\n\n')}` };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'melebihi batas waktu 30 detik' : err.message;
    return { success: false, output: `Pencarian gagal: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
