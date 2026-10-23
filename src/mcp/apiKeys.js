/**
 * Validasi API key untuk penyedia MCP bawaan (Tavily, Firecrawl, TinyFish).
 *
 * Tujuannya mencegah KREDENSIAL YANG SALAH SLOT terkirim ke vendor lain:
 * kunci Firecrawl (`fc-…`) yang tersimpan di slot Tavily akan dikirim
 * sebagai header Authorization ke server Tavily, dan sebaliknya.
 *
 * Aturan yang dipakai sengaja konservatif:
 *  - Kunci yang polanya tidak dikenali tetap diterima (supaya format baru
 *    dari vendor tidak memblokir pengguna).
 *  - Kunci yang JELAS milik penyedia lain DITOLAK dengan pesan jelas.
 */

/**
 * @typedef {'tavily' | 'firecrawl' | 'tinyfish'} BuiltinMcpProvider
 */

/** Pola awalan kunci tiap penyedia bawaan. */
const POLA_KEY = {
  tavily: /^tvly-/i,
  firecrawl: /^fc-/i,
  tinyfish: /^sk-tinyfish-/i,
};

/**
 * Deteksi penyedia pemilik sebuah kunci berdasarkan awalannya.
 *
 * @param {string} apiKey
 * @returns {BuiltinMcpProvider|null} nama penyedia, atau null bila tidak dikenali
 */
export function detectBuiltinKeyProvider(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return null;
  for (const [name, pola] of Object.entries(POLA_KEY)) {
    if (pola.test(key)) return name;
  }
  return null;
}

/**
 * Periksa apakah sebuah kunci boleh dipakai untuk penyedia tertentu.
 *
 * @param {string} apiKey
 * @param {BuiltinMcpProvider} provider
 * @returns {{ ok: boolean, reason?: string, detected?: BuiltinMcpProvider|null }}
 */
export function validateBuiltinKeyForProvider(apiKey, provider) {
  const detected = detectBuiltinKeyProvider(apiKey);
  if (!detected) return { ok: true, detected: null };
  if (detected === provider) return { ok: true, detected };
  return {
    ok: false,
    detected,
    reason:
      `Kunci ini berawalan seperti kunci ${detected}, bukan ${provider}. ` +
      `Menyimpannya di slot ${provider} akan mengirim kredensial ${detected} ke server ${provider}.`,
  };
}
