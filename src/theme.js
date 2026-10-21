import chalk from 'chalk';

/**
 * Palet warna resmi tema bAIwor Code (mode gelap).
 *
 * Semua elemen antarmuka (judul, kode, daftar, input pengguna, status, diff)
 * mengambil warna dari SATU sumber ini agar konsisten dan mudah diubah.
 */
export const palette = Object.freeze({
  // ---- hue dasar (token semantik bAIwor Code Hibrida) ----
  primary: '#f6ad55', // peach amber lembut — pesan pengguna, item daftar, prompt
  secondary: '#63b3ed', // soft sky blue — penelusuran berkas, list, search
  accent: '#b794f4', // lavender lembut — judul markdown & kata kunci kode
  error: '#e53e3e', // bawor crimson — galat & konfirmasi perintah destruktif
  warning: '#ecc94b', // emas wayang lembut — peringatan, angka
  success: '#68d391', // pastel mint green — sukses, tulis/ubah berkas
  info: '#4fd1c5', // soft teal/cyan — informasi, baca berkas, enumerasi
  gold: '#ecc94b', // punakawan gold — nama karakter Tim Punakawan AI (semAIr, bAIwor, pAItruk, gAIreng)
  text: '#eeeeee', // teks utama
  textBright: '#f5f5f5', // teks utama terang (padanan whiteBright)
  textMuted: '#808080', // teks redup / komentar
  border: '#484848', // garis tepi
  thinking: '#f472b6', // pastel pink — label penalaran AI (💭 Thinking:)

  // ---- aksen khusus CLI (help/doctor/update) — dipetakan dari hex liar audit ----
  cliTitle: '#FBBF24', // amber judul CLI: header help, "Doctor", "Pembaruan"
  cliVersion: '#F59E0B', // amber pekat: nomor versi di header help
  cliLink: '#38BDF8', // sky: aksi tautan khusus di menu model

  // ---- permission mode (pastel warna brand Google, 4 nilai) ----
  permSafe: '#93C5FD', // pastel blue (Google blue) — mode safe, persetujuan ditanya
  permAuto: '#86EFAC', // pastel green (Google green) — mode auto, edit berkas lancar
  permPlan: '#FDE68A', // pastel yellow (Google yellow) — mode plan, read-only
  permYolo: '#FCA5A5', // pastel red (Google red) — mode yolo, full access tanpa tanya

  // ---- diff (dipertahankan agar membaca kode tetap nyaman) ----
  diffAdded: '#4fd6be', // latar penanda tambah
  diffRemoved: '#c53b53', // latar penanda hapus
  diffContext: '#828bb8', // konteks tak berubah
  diffHunkHeader: '#828bb8', // header hunk (@@ … @@)
  diffHighlightAdded: '#b8db87', // baris ditambahkan (terang)
  diffHighlightRemoved: '#e26a75', // baris dihapus (terang)

  // ---- markdown ----
  mdHeading: '#b794f4', // lavender lembut
  mdText: '#eeeeee',
  mdLink: '#f6ad55', // peach amber
  mdLinkText: '#4fd1c5', // soft teal
  mdCode: '#68d391', // mint green
  mdBlockQuote: '#ecc94b', // punakawan gold
  mdEmph: '#ecc94b',
  mdStrong: '#f6ad55',
  mdHorizontalRule: '#808080',
  mdListItem: '#f6ad55',
  mdListEnumeration: '#4fd1c5',
  mdImage: '#f6ad55',
  mdImageText: '#4fd1c5',
  mdCodeBlock: '#eeeeee',

  // ---- sintaks kode (pastel harmonis tanpa meredupkan konten) ----
  synComment: '#808080',
  synKeyword: '#b794f4',
  synFunction: '#f6ad55',
  synVariable: '#e53e3e',
  synString: '#68d391',
  synNumber: '#ecc94b',
  synType: '#ecc94b',
  synOperator: '#4fd1c5',
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
  // teks terang (judul baris, label utama)
  textBright: hex(palette.textBright),

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

  // aksen khusus CLI (help/doctor/update)
  cliTitle: hex(palette.cliTitle).bold,
  cliVersion: hex(palette.cliVersion).bold,
  cliLink: hex(palette.cliLink),

  // permission mode (pastel Google)
  permSafe: hex(palette.permSafe).bold,
  permAuto: hex(palette.permAuto).bold,
  permPlan: hex(palette.permPlan).bold,
  permYolo: hex(palette.permYolo).bold,

  // penalaran AI (thinking)
  thinking: hex(palette.thinking).bold,
};

/**
 * Mewarnai satu baris diff mengikuti konvensi bAIwor Code:
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
