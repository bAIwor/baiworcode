/**
 * Helper URL model bersama untuk menu /model dan /doctor.
 */

/**
 * Menyusun endpoint /models dari base URL yang mungkin ditempel pengguna secara
 * lengkap (`…/chat/completions`, `…/responses`, atau `…/models`). Tanpa
 * normalisasi, probe menuju path yang tidak ada (404) sehingga menu/doctor
 * melaporkan "tidak bisa mengambil daftar model" padahal kredensial benar.
 *
 * @param {string} baseUrl
 * @returns {string}
 */
export function modelsEndpoint(baseUrl) {
  let base = String(baseUrl || '').trim().replace(/\/+$/, '');
  base = base
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/models$/i, '');
  return `${base.replace(/\/+$/, '')}/models`;
}
