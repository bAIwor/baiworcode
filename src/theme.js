import chalk from 'chalk';

/**
 * Palet warna resmi tema `opencode` (mode gelap).
 *
 * Nilai hex di bawah disalin apa adanya dari sumber tema opencode:
 *   packages/tui/src/theme/assets/opencode.json
 * sehingga tampilan bAIwor Code benar-benar setara dengan TUI opencode —
 * bukan sekadar mirip. Semua elemen antarmuka (judul, kode, daftar, input
 * pengguna, status, diff) mengambil warna dari SATU sumber ini agar
 * konsisten dan mudah diubah di kemudian hari.
 */
export const palette = Object.freeze({
  // ---- hue dasar (token semantik) ----
  primary: '#fab283', // oranye utama — pesan pengguna, item daftar
  secondary: '#5c9cf5', // biru — penelusuran berkas
  accent: '#9d7cd8', // ungu — judul markdown & kata kunci kode
  error: '#e06c75', // merah — galat & perintah dijalankan
  warning: '#f5a742', // oranye tua — peringatan, angka
  success: '#7fd88f', // hijau — sukses, tulis/ubah berkas
  info: '#56b6c2', // cyan — informasi, baca, enumerasi
  gold: '#f5c451', // kuning emas — nama karakter Tim Punakawan AI
  text: '#eeeeee', // teks utama
  textMuted: '#808080', // teks redup / komentar
  border: '#484848', // garis tepi

  // ---- diff ----
  diffAdded: '#4fd6be', // latar penanda tambah
  diffRemoved: '#c53b53', // latar penanda hapus
  diffContext: '#828bb8', // konteks tak berubah
  diffHunkHeader: '#828bb8', // header hunk (@@ … @@)
  diffHighlightAdded: '#b8db87', // baris ditambahkan (terang)
  diffHighlightRemoved: '#e26a75', // baris dihapus (terang)

  // ---- markdown ----
  mdHeading: '#9d7cd8',
  mdText: '#eeeeee',
  mdLink: '#fab283',
  mdLinkText: '#56b6c2',
  mdCode: '#7fd88f',
  mdBlockQuote: '#e5c07b',
  mdEmph: '#e5c07b',
  mdStrong: '#f5a742',
  mdHorizontalRule: '#808080',
  mdListItem: '#fab283',
  mdListEnumeration: '#56b6c2',
  mdImage: '#fab283',
  mdImageText: '#56b6c2',
  mdCodeBlock: '#eeeeee',

  // ---- sintaks kode ----
  synComment: '#808080',
  synKeyword: '#9d7cd8',
  synFunction: '#fab283',
  synVariable: '#e06c75',
  synString: '#7fd88f',
  synNumber: '#f5a742',
  synType: '#e5c07b',
  synOperator: '#56b6c2',
  synPunctuation: '#eeeeee',
});

const hex = (value) => chalk.hex(value);

/**
 * Pewarna siap pakai. Setiap properti adalah fungsi chalk yang bisa langsung
 * dipanggil: `theme.heading('Judul')`.
 *
 * Level warna chalk dievaluasi saat pemanggilan (bukan saat modul dimuat),
 * jadi `ensureColorSupport()` di `colors.js` tetap berlaku walau modul ini
 * di-import lebih dulu.
 */
export const theme = {
  // pesan / input pengguna
  user: hex(palette.primary),
  // aksen oranye utama (mis. nama model di baris status)
  primary: hex(palette.primary),
  // teks input yang sedang diketik pengguna (putih, bukan oranye)
  input: hex(palette.text),

  // markdown
  heading: hex(palette.mdHeading).bold,
  text: hex(palette.mdText),
  link: hex(palette.mdLink),
  linkText: hex(palette.mdLinkText),
  code: hex(palette.mdCode),
  quote: hex(palette.mdBlockQuote).italic,
  strong: hex(palette.mdStrong),
  emph: hex(palette.mdEmph),
  rule: hex(palette.mdHorizontalRule),
  bullet: hex(palette.mdListItem),
  numbered: hex(palette.mdListEnumeration),
  image: hex(palette.mdImage),
  imageText: hex(palette.mdImageText),
  codeBlock: hex(palette.mdCodeBlock),

  // sintaks kode
  comment: hex(palette.synComment).italic,
  keyword: hex(palette.synKeyword),
  fn: hex(palette.synFunction),
  variable: hex(palette.synVariable),
  string: hex(palette.synString),
  number: hex(palette.synNumber),
  type: hex(palette.synType),
  operator: hex(palette.synOperator),
  punctuation: hex(palette.synPunctuation),

  // status & aksen
  info: hex(palette.info),
  success: hex(palette.success),
  warning: hex(palette.warning),
  error: hex(palette.error),
  accent: hex(palette.accent),
  secondary: hex(palette.secondary),
  gold: hex(palette.gold),
  muted: hex(palette.textMuted),
  border: hex(palette.border),
};

/**
 * Mewarnai satu baris diff mengikuti konvensi opencode:
 *   `+++` / `---`  → abu konteks (header berkas)
 *   `@@ … @@`      → header hunk
 *   `+…`           → hijau (baris ditambahkan)
 *   `-…`           → merah (baris dihapus)
 *   lainnya        → konteks abu
 *
 * @param {string} line
 * @returns {string}
 */
export function paintDiffLine(line) {
  const s = String(line ?? '');
  if (s.startsWith('+++') || s.startsWith('---')) return hex(palette.diffContext)(s);
  if (s.startsWith('@@')) return hex(palette.diffHunkHeader)(s);
  if (s.startsWith('+')) return hex(palette.diffHighlightAdded)(s);
  if (s.startsWith('-')) return hex(palette.diffHighlightRemoved)(s);
  return hex(palette.diffContext)(s);
}

/**
 * Mewarnai teks diff multi-baris sekaligus.
 * @param {string} text
 * @returns {string}
 */
export function paintDiff(text) {
  return String(text ?? '')
    .split('\n')
    .map(paintDiffLine)
    .join('\n');
}

export default theme;
