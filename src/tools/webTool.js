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

import { getTinyFishApiKey } from '../config.js';

const DEFAULT_MAX_CHARS = 20000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const FETCH_TIMEOUT_MS = 30000;

export const TINYFISH_SEARCH_ENDPOINT = 'https://api.search.tinyfish.ai';
export const TINYFISH_FETCH_ENDPOINT = 'https://api.fetch.tinyfish.ai';
export const TINYFISH_AUTOMATE_ENDPOINT = 'https://agent.tinyfish.ai/v1/automation/run';

const FETCH_USER_AGENT = 'bAIworCode/1.0 (+https://baiwor.my.id)';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
 * Mengambil isi URL menggunakan TinyFish Fetch API.
 * Mendukung eksekusi JavaScript, anti-bot bypass, dan konversi ke Markdown bersih.
 *
 * @param {{ url: string, max_chars?: number, apiKey: string, purpose?: string }} args
 * @returns {Promise<{success:boolean, output:string}|null>}
 */
async function fetchTinyFishFetch({ url, max_chars, apiKey, purpose }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const payload = { urls: [url], format: 'markdown' };
    if (purpose && typeof purpose === 'string' && purpose.trim()) {
      payload.purpose = purpose.trim();
    }

    const res = await globalThis.fetch(TINYFISH_FETCH_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        'user-agent': FETCH_USER_AGENT,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const page = data?.results?.[0];
    if (!page || typeof page.text !== 'string' || !page.text.trim()) {
      return null;
    }

    let text = page.text.trim();
    const maxChars = Math.max(500, Number(max_chars) || DEFAULT_MAX_CHARS);
    if (text.length > maxChars) {
      text = `${text.slice(0, maxChars)}\n\n… [isi dipotong pada ${maxChars} karakter]`;
    }

    const meta = [
      `HTTP 200 OK (via TinyFish Fetch)`,
      `URL: ${page.final_url || page.url || url}`,
    ];
    if (page.title) meta.push(`Judul: ${page.title}`);
    if (page.description) meta.push(`Deskripsi: ${page.description}`);
    meta.push(`Format: Markdown (JS-rendered & anti-bot bypassed)\n`);

    return { success: true, output: `${meta.join('\n')}\n${text}` };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mengambil isi sebuah URL dan mengembalikannya sebagai teks.
 * Secara otomatis memanfaatkan TinyFish Fetch API (bila dikonfigurasi) untuk
 * rendering JavaScript dan bypass anti-bot, dengan fallback ke fetch standar.
 *
 * @param {{url:string, max_chars?:number, raw?:boolean, purpose?:string}} args
 * @returns {Promise<{success:boolean, output:string}>}
 */
export async function handleWebFetch({ url, max_chars = DEFAULT_MAX_CHARS, raw = false, purpose = '' } = {}) {
  let target;
  try {
    target = assertHttpUrl(url);
  } catch (err) {
    return { success: false, output: `Error: ${err.message}` };
  }

  // Jika bukan mode raw dan TinyFish API key tersedia, utamakan TinyFish Fetch
  if (!raw) {
    const apiKey = getTinyFishApiKey();
    if (apiKey) {
      try {
        const tfResult = await fetchTinyFishFetch({
          url: target.href,
          max_chars,
          apiKey,
          purpose,
        });
        if (tfResult) return tfResult;
      } catch {}
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(target.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': FETCH_USER_AGENT, accept: 'text/html,application/json,text/plain,*/*' },
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
 * Mencari di web menggunakan TinyFish Search API.
 * Mengembalikan hasil terstruktur, berperingkat, dan relevan.
 *
 * @param {{ query: string, max_results?: number, apiKey: string, location?: string, language?: string, include_domains?: string, exclude_domains?: string }} args
 * @returns {Promise<{success:boolean, output:string}|null>}
 */
async function fetchTinyFishSearch({
  query,
  max_results = 5,
  apiKey,
  location,
  language,
  include_domains,
  exclude_domains,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const searchUrl = new URL(TINYFISH_SEARCH_ENDPOINT);
    searchUrl.searchParams.set('query', query);
    if (location) searchUrl.searchParams.set('location', location);
    if (language) searchUrl.searchParams.set('language', language);
    if (include_domains) searchUrl.searchParams.set('include_domains', include_domains);
    if (exclude_domains) searchUrl.searchParams.set('exclude_domains', exclude_domains);

    const res = await globalThis.fetch(searchUrl.href, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'X-API-Key': apiKey,
        'user-agent': FETCH_USER_AGENT,
        accept: 'application/json',
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    if (!results.length) return null;

    const maxResults = Math.min(10, Math.max(1, Number(max_results) || 5));
    const sliced = results.slice(0, maxResults);
    const lines = sliced.map((r, i) => {
      const snippet = r.snippet ? `\n   ${r.snippet}` : '';
      const site = r.site_name ? ` · ${r.site_name}` : '';
      const date = r.date ? ` [${r.date}]` : '';
      return `${i + 1}. ${r.title}${site}${date}\n   ${r.url}${snippet}`;
    });

    return {
      success: true,
      output: `Hasil untuk "${query}" (via TinyFish Search):\n\n${lines.join('\n\n')}`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mencari di web (didukung TinyFish Search API bila ada key, atau DuckDuckGo bawaan).
 * Menggunakan TinyFish Search sebagai jalur utama, dengan fallback ke DuckDuckGo.
 *
 * @param {{query:string, max_results?:number, location?:string, language?:string, include_domains?:string, exclude_domains?:string}} args
 * @returns {Promise<{success:boolean, output:string}>}
 */
export async function handleWebSearch({
  query,
  max_results = 5,
  location,
  language,
  include_domains,
  exclude_domains,
} = {}) {
  const q = String(query ?? '').trim();
  if (!q) return { success: false, output: 'Error: parameter "query" wajib diisi.' };

  // Jalur utama: TinyFish Search API jika API key tersedia
  const apiKey = getTinyFishApiKey();
  if (apiKey) {
    try {
      const tfResult = await fetchTinyFishSearch({
        query: q,
        max_results,
        apiKey,
        location,
        language,
        include_domains,
        exclude_domains,
      });
      if (tfResult) return tfResult;
    } catch {}
  }

  const maxResults = Math.min(10, Math.max(1, Number(max_results) || 5));
  const postEndpoint = 'https://html.duckduckgo.com/html/';
  const getEndpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let html = '';

    // Coba jalur 1: POST form-urlencoded (paling andal untuk multi-kata di DuckDuckGo HTML)
    try {
      const res = await globalThis.fetch(postEndpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'user-agent': BROWSER_USER_AGENT,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9,id;q=0.8',
        },
        body: `q=${encodeURIComponent(q)}`,
      });
      if (res.ok) {
        html = await res.text();
      }
    } catch {}

    // Jalur fallback 2: GET bila POST gagal atau kosong
    if (!html || !html.includes('result__a')) {
      try {
        const getRes = await globalThis.fetch(getEndpoint, {
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'user-agent': BROWSER_USER_AGENT,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9,id;q=0.8',
          },
        });
        if (getRes.ok) {
          html = await getRes.text();
        }
      } catch {}
    }

    const results = html ? parseDuckDuckGo(html, maxResults) : [];

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

/**
 * Menjalankan otomasi browser (Web Agent TinyFish / Mako).
 * Mengemudikan browser headless untuk menyelesaikan tugas interaktif pada situs target.
 *
 * @param {{ url: string, goal: string, browser_profile?: string, timeout_ms?: number }} args
 * @returns {Promise<{ success: boolean, output: string }>}
 */
export async function handleWebAutomate({
  url,
  goal,
  browser_profile = 'lite',
  timeout_ms = 120000,
} = {}) {
  let target;
  try {
    target = assertHttpUrl(url);
  } catch (err) {
    return { success: false, output: `Error: ${err.message}` };
  }

  const g = String(goal ?? '').trim();
  if (!g) {
    return { success: false, output: 'Error: parameter "goal" wajib diisi untuk otomasi web.' };
  }

  const apiKey = getTinyFishApiKey();
  if (!apiKey) {
    return {
      success: false,
      output:
        'Error: API Key TinyFish belum dikonfigurasikan. Otomasi web memerlukan TinyFish API Key.\n' +
        'Silakan simpan key dengan perintah /tinyfish key <apiKey> atau set environment variable TINYFISH_API_KEY.',
    };
  }

  const controller = new AbortController();
  const timeoutDuration = Math.max(10000, Number(timeout_ms) || 120000);
  const timer = setTimeout(() => controller.abort(), timeoutDuration);

  try {
    const res = await globalThis.fetch(TINYFISH_AUTOMATE_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        'user-agent': FETCH_USER_AGENT,
      },
      body: JSON.stringify({
        url: target.href,
        goal: g,
        browser_profile: browser_profile === 'stealth' ? 'stealth' : 'lite',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        success: false,
        output: `Otomasi web gagal (HTTP ${res.status}): ${errText || res.statusText}`,
      };
    }

    const data = await res.json();
    const status = data.status || 'UNKNOWN';
    const steps = data.num_of_steps || 1;
    const runId = data.run_id || '-';
    const formattedResult =
      typeof data.result === 'object'
        ? JSON.stringify(data.result, null, 2)
        : String(data.result || '(Tugas selesai tanpa data keluaran)');

    const output =
      `🤖 TinyFish Web Automation (${status}):\n` +
      `Target URL : ${target.href}\n` +
      `Goal       : ${g}\n` +
      `Langkah    : ${steps} langkah\n` +
      `Run ID     : ${runId}\n\n` +
      `Hasil:\n${formattedResult}`;

    return { success: status === 'COMPLETED', output };
  } catch (err) {
    const reason =
      err?.name === 'AbortError'
        ? `melebihi batas waktu ${Math.round(timeoutDuration / 1000)} detik`
        : err.message;
    return { success: false, output: `Otomasi web gagal: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
