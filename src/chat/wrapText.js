/**
 * Pembungkusan baris (hard wrap) yang sadar ANSI.
 *
 * Kenapa perlu: keluaran AI sebelumnya mengandalkan *soft wrap* terminal.
 * Saat sebuah baris melebihi lebar terminal, terminal membungkusnya ke kolom 0
 * — tanpa indentasi apa pun. Akibatnya baris pertama jawaban terindentasi rapi,
 * sementara baris lanjutan mepet ke kiri dan tidak sejajar.
 *
 * Modul ini membungkus baris secara sadar supaya:
 *   - lebar baris tidak pernah melebihi budget terminal (aman dari wrap tak diinginkan),
 *   - baris lanjutan mendapat *hanging indent* yang sejajar dengan isi baris pertama,
 *   - kode warna ANSI tidak dihitung sebagai lebar tampilan dan tidak putus di tengah.
 */

/** Escape sequence ANSI (SGR dan lainnya) — diabaikan saat mengukur lebar. */
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * Membersihkan teks dari escape sequence/terminal control yang berasal dari
 * sumber tidak tepercaya (model, output tool, halaman web, perintah remote).
 *
 * Yang dibuang: OSC (termasuk hyperlink & clipboard OSC 52), DCS, CSI/ANSI,
 * escape ESC tunggal, karakter kontrol C0/C1, dan karakter bidi. Newline/tab
 * dipertahankan agar teks multi-baris tetap utuh.
 *
 * @param {unknown} value
 * @param {{preserveNewlines?:boolean}} [options]
 * @returns {string}
 */
export function sanitizeTerminalText(value, { preserveNewlines = true } = {}) {
  let text = String(value ?? '');
  text = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  text = text.replace(/\x1b\][^\x07]*\x07/g, '');
  text = text.replace(/\x1bP[\s\S]*?\x1b\\/g, '');
  text = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  text = text.replace(/\x1b[@-_]/g, '');
  text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  text = text.replace(/[\u0080-\u009f]/g, '');
  text = text.replace(/[\u202a-\u202e\u2066-\u2069]/g, '');
  if (preserveNewlines) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '');
  } else {
    text = text.replace(/[\r\n]+/g, ' ');
  }
  // Sisa ESC tunggal (termasuk sequence yang terpotong antar-chunk stream).
  return text.replace(/\x1b/g, '');
}

/** Escape sequence SGR (pengatur warna/gaya) — perlu dilacak antar baris. */
const SGR_RE = /^\x1b\[[0-9;]*m$/;

/** Reset gaya: `\x1b[0m` atau `\x1b[m`. */
const RESET_RE = /^\x1b\[0?m$/;

/**
 * Menghilangkan seluruh escape code ANSI dari sebuah string.
 *
 * @param {string} s
 * @returns {string}
 */
export function stripAnsi(s) {
  return String(s ?? '').replace(ANSI_RE, '');
}

/**
 * Lebar tampilan sebuah string dalam kolom terminal, mengabaikan ANSI.
 * Dihitung per code point (bukan per UTF-16 unit) agar emoji dan karakter
 * non-BMP tidak terhitung ganda.
 *
 * @param {string} s
 * @returns {number}
 */
export function visibleWidth(s) {
  return [...stripAnsi(s)].length;
}

/**
 * Memecah string menjadi token: potongan teks biasa, spasi, dan escape ANSI.
 * Pemisahan per-token membuat pengukuran lebar dan pemotongan menjadi aman
 * terhadap kode warna yang menempel di tengah kata.
 *
 * @param {string} s
 * @returns {Array<{t:string, ansi?:boolean, space?:boolean}>}
 */
function tokenize(s) {
  const tokens = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      tokens.push({ t: buf });
      buf = '';
    }
  };

  while (i < s.length) {
    const esc = /^\x1b\[[0-9;]*[A-Za-z]/.exec(s.slice(i));
    if (esc) {
      flush();
      tokens.push({ t: esc[0], ansi: true });
      i += esc[0].length;
      continue;
    }
    const ch = s[i];
    if (ch === ' ' || ch === '\t') {
      flush();
      tokens.push({ t: ch, space: true });
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return tokens;
}

/**
 * Membungkus sebuah baris logis menjadi beberapa baris fisik.
 *
 * Pemotongan terjadi di batas kata; kata yang sendirian lebih panjang dari
 * lebar baris dipotong paksa (hard break) agar tidak ada baris yang meluber
 * dan memicu soft wrap terminal.
 *
 * @param {string} text Baris logis (boleh memuat ANSI).
 * @param {{width:number, restWidth?:number}} [options]
 *   `width`      — budget kolom untuk baris pertama.
 *   `restWidth`  — budget kolom untuk baris lanjutan (default sama dengan `width`).
 * @returns {string[]} Baris-baris fisik; selalu minimal satu elemen.
 */
export function wrapText(text, { width, restWidth = width } = {}) {
  const s = String(text ?? '');
  if (!s) return [''];

  const firstWidth = Math.max(1, Math.floor(width));
  const nextWidth = Math.max(1, Math.floor(restWidth));

  const lines = [];
  let line = '';
  let lineWidth = 0;
  let sgr = ''; // SGR aktif; dibuka ulang di baris lanjutan
  let pendingSpace = '';

  const limit = () => (lines.length === 0 ? firstWidth : nextWidth);

  const pushLine = () => {
    // Tutup warna yang masih terbuka supaya tidak bocor ke baris berikutnya,
    // lalu buka kembali gaya yang sama di awal baris lanjutan.
    lines.push(line && sgr ? `${line}\x1b[0m` : line);
    line = line && sgr ? sgr : '';
    lineWidth = 0;
  };

  for (const tok of tokenize(s)) {
    if (tok.ansi) {
      line += tok.t;
      if (SGR_RE.test(tok.t)) sgr = RESET_RE.test(tok.t) ? '' : sgr + tok.t;
      continue;
    }

    if (tok.space) {
      // Spasi di awal baris dibuang — hasil pemotongan seharusnya tidak
      // diawali whitespace.
      if (lineWidth === 0) continue;
      pendingSpace += tok.t;
      continue;
    }

    let word = tok.t;
    while (word.length > 0) {
      const budget = limit();
      const gap = lineWidth === 0 ? '' : pendingSpace;
      const room = budget - lineWidth - gap.length;

      if (room <= 0) {
        if (lineWidth === 0) {
          // Budget sangat sempit dan baris masih kosong: tempatkan minimal satu
          // karakter agar loop tidak berputar tanpa kemajuan.
          line += word[0];
          lineWidth += 1;
          word = word.slice(1);
          continue;
        }
        pushLine();
        pendingSpace = '';
        continue;
      }

      if (word.length <= room) {
        line += gap + word;
        lineWidth += gap.length + word.length;
        pendingSpace = '';
        word = '';
        continue;
      }

      // Kata tidak muat di sisa baris ini. Kalau seluruh kata memang lebih
      // panjang dari lebar baris, ia dipotong paksa agar tidak ada baris yang
      // meluber dan memicu soft wrap terminal. Kalau tidak, kata utuh
      // dipindahkan ke baris berikutnya — memotongnya di sini akan
      // menghasilkan potongan seperti "t" + "iga" yang merusak kalimat.
      if (word.length > budget) {
        line += gap + word.slice(0, room);
        lineWidth += gap.length + room;
        pendingSpace = '';
        word = word.slice(room);
      }
      pushLine();
    }
  }

  pushLine();
  return lines.length ? lines : [''];
}

/**
 * Penanda awal baris yang butuh *hanging indent*: butir (`•`), nomor
 * (`1.`), dan kutipan (`│`). Baris lanjutan dari jenis ini disejajarkan
 * dengan teks setelah penanda, bukan dengan penanda itu sendiri.
 */
const MARKER_RE = /^(\s*(?:[•▪◦‣·●○]|\d+\.|[|│┃]|>)\s+)/;

/**
 * Menghitung jumlah kolom hanging indent untuk sebuah baris.
 *
 * @param {string} line Baris logis (boleh memuat ANSI; diabaikan saat mengukur).
 * @returns {number} 0 bila baris tidak diawali penanda daftar/kutipan.
 */
export function hangingIndent(line) {
  const m = MARKER_RE.exec(stripAnsi(line));
  return m ? visibleWidth(m[1]) : 0;
}
