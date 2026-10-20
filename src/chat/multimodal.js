import fs from 'node:fs';
import path from 'node:path';

/**
 * Modul Multi-Modal & Media Asset Ingestion untuk bAIwor Code.
 *
 * Mendeteksi lampiran berkas gambar (@gambar.png atau perintah /image <path>),
 * mengonversinya menjadi base64 data URI, dan menyusun payload multi-modal
 * sesuai standar OpenAI & Gemini API.
 */

export const SUPPORTED_IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
]);

export const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB per gambar

/**
 * Memeriksa apakah path mengarah ke ekstensi gambar yang didukung.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function isImagePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_IMAGE_EXTS.has(ext);
}

/**
 * Membaca berkas gambar dan mengonversinya ke base64 data.
 *
 * @param {string} filePath - Path absolut atau relatif
 * @param {Object} [options]
 * @param {string} [options.baseDir=process.cwd()] - Direktori dasar untuk resolve path relatif
 * @param {number} [options.maxBytes=MAX_IMAGE_BYTES]
 * @returns {{
 *   success: boolean,
 *   mimeType?: string,
 *   base64?: string,
 *   sizeBytes?: number,
 *   path?: string,
 *   error?: string
 * }}
 */
export function readImageAsBase64(filePath, options = {}) {
  const { baseDir = process.cwd(), maxBytes = MAX_IMAGE_BYTES } = options;
  if (!filePath) return { success: false, error: 'Path berkas gambar kosong.' };

  const resolved = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(baseDir, filePath);

  if (!fs.existsSync(resolved)) {
    return { success: false, error: `Berkas gambar tidak ditemukan: ${filePath}` };
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    return { success: false, error: `Gagal membaca informasi berkas: ${err.message}` };
  }

  if (!stat.isFile()) {
    return { success: false, error: `Jalur bukan merupakan berkas: ${filePath}` };
  }

  if (stat.size > maxBytes) {
    return {
      success: false,
      error: `Ukuran gambar terlalu besar (${(stat.size / (1024 * 1024)).toFixed(1)} MB). Maksimum ${maxBytes / (1024 * 1024)} MB.`,
    };
  }

  const ext = path.extname(resolved).toLowerCase();
  const mimeType = MIME_MAP[ext] || 'application/octet-stream';

  try {
    const buf = fs.readFileSync(resolved);
    return {
      success: true,
      mimeType,
      base64: buf.toString('base64'),
      sizeBytes: stat.size,
      path: resolved,
    };
  } catch (err) {
    return { success: false, error: `Gagal membaca isi berkas gambar: ${err.message}` };
  }
}

/**
 * Mengekstrak referensi gambar dari teks prompt pengguna (@image.png atau /image <path>).
 *
 * Pola yang dikenali:
 *   - `/image <path> [prompt...]` di awal teks
 *   - `@path/ke/gambar.png`
 *   - `@"path dengan spasi/gambar.png"`
 *   - `@'path/ke/gambar.png'`
 *
 * @param {string} text - Teks prompt input pengguna
 * @param {Object} [options]
 * @param {string} [options.baseDir=process.cwd()]
 * @returns {{
 *   cleanText: string,
 *   images: Array<{ path: string, mimeType: string, base64: string, sizeBytes: number }>,
 *   errors: Array<string>
 * }}
 */
export function extractImageAttachments(text = '', options = {}) {
  const baseDir = options.baseDir || process.cwd();
  let remainingText = String(text ?? '').trim();
  const images = [];
  const errors = [];
  const seenPaths = new Set();

  // 1. Dukungan sintaks perintah `/image <path> [prompt...]`
  if (remainingText.startsWith('/image')) {
    const afterCmd = remainingText.slice(6).trim();
    // Tangkap argumen path (bisa dalam tanda kutip atau spasi pertama)
    let imgPath = '';
    let restOfPrompt = '';

    if (afterCmd.startsWith('"')) {
      const closingQuote = afterCmd.indexOf('"', 1);
      if (closingQuote !== -1) {
        imgPath = afterCmd.slice(1, closingQuote);
        restOfPrompt = afterCmd.slice(closingQuote + 1).trim();
      }
    } else if (afterCmd.startsWith("'")) {
      const closingQuote = afterCmd.indexOf("'", 1);
      if (closingQuote !== -1) {
        imgPath = afterCmd.slice(1, closingQuote);
        restOfPrompt = afterCmd.slice(closingQuote + 1).trim();
      }
    }

    if (!imgPath) {
      const parts = afterCmd.split(/\s+/);
      imgPath = parts[0] || '';
      restOfPrompt = parts.slice(1).join(' ').trim();
    }

    if (imgPath) {
      const res = readImageAsBase64(imgPath, { baseDir });
      if (res.success) {
        if (!seenPaths.has(res.path)) {
          seenPaths.add(res.path);
          images.push(res);
        }
      } else {
        errors.push(res.error);
      }
      remainingText = restOfPrompt;
    }
  }

  // 2. Dukungan sintaks `@path/gambar.ext` di tengah atau akhir teks prompt
  // Regex mencari @"..." atau @'...' atau @non-whitespace yang berakhiran ekstensi gambar
  const imageRegex = /@(?:"([^"]+\.(?:png|jpg|jpeg|webp|gif|svg))"|'([^']+\.(?:png|jpg|jpeg|webp|gif|svg))'|([^\s"']+\.(?:png|jpg|jpeg|webp|gif|svg)))/gi;

  remainingText = remainingText.replace(imageRegex, (match, pQuotedDouble, pQuotedSingle, pPlain) => {
    const rawPath = pQuotedDouble || pQuotedSingle || pPlain;
    if (!rawPath) return match;

    const res = readImageAsBase64(rawPath, { baseDir });
    if (res.success) {
      if (!seenPaths.has(res.path)) {
        seenPaths.add(res.path);
        images.push(res);
      }
      return ''; // Hapus penanda @gambar dari teks prompt
    }

    errors.push(res.error);
    return match; // Biarkan apa adanya jika bukan berkas valid
  });

  // Bersihkan spasi ganda yang tertinggal
  const cleanText = remainingText.replace(/\s+/g, ' ').trim();

  return {
    cleanText,
    images,
    errors,
  };
}

/**
 * Menyusun konten pesan pengguna dalam format multi-modal standar OpenAI / Gemini.
 * Jika tidak ada gambar, mengembalikan teks murni (string) tanpa overhead objek.
 *
 * @param {string} text - Teks pertanyaan/instruksi pengguna
 * @param {Array<{mimeType:string, base64:string}>} [images=[]] - Daftar gambar terlampir
 * @returns {string|Array<Object>}
 */
export function buildMultimodalContent(text, images = []) {
  if (!images || images.length === 0) {
    return text || '';
  }

  const promptText = text && text.trim() ? text.trim() : 'Tolong analisis gambar ini:';
  const parts = [
    {
      type: 'text',
      text: promptText,
    },
  ];

  for (const img of images) {
    parts.push({
      type: 'image_url',
      image_url: {
        url: `data:${img.mimeType};base64,${img.base64}`,
      },
    });
  }

  return parts;
}

/**
 * Memproses prompt pengguna menjadi format siap kirim (string atau multimodal array).
 *
 * @param {string} promptText
 * @param {Object} [options]
 * @returns {{
 *   content: string|Array<Object>,
 *   cleanText: string,
 *   images: Array<Object>,
 *   errors: Array<string>
 * }}
 */
export function processMultimodalPrompt(promptText, options = {}) {
  const { cleanText, images, errors } = extractImageAttachments(promptText, options);
  const content = buildMultimodalContent(cleanText, images);
  return {
    content,
    cleanText,
    images,
    errors,
  };
}
