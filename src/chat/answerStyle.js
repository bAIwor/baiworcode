import chalk from 'chalk';
import { theme, palette } from '../theme.js';

/**
 * Pewarna jawaban asisten bergaya markdown, memakai palet resmi tema
 * bAIwor Code (lihat `src/theme.js`):
 *   - Judul: ungu (accent) tebal
 *   - Bullet list: oranye (primary), numbered: cyan (info)
 *   - Blockquote: kuning (yellow)
 *   - Kode inline & string: hijau (green)
 *   - Komentar: abu-abu redup italic
 *   - Angka: oranye tua (warning)
 *   - Kata kunci: ungu (accent)
 *
 * - Hanya menambah kode ANSI; teks tak pernah rusak (kecuali penanda markdown
 *   yang memang disembunyikan seperti `**` dan `#`).
 * - Bekerja saat streaming, bukan menunggu jawaban utuh.
 * - Saat useColor=false (output dipipa) jadi pass-through murni.
 */

// Warna dasar per jenis baris. Dipakai BERSAMA pemformatan inline, sehingga
// **tebal** / *miring* / `kode` di dalam judul, kutipan, dan daftar tetap
// diproses (bukan tampil sebagai karakter literal).
const HEADING_BASE = { colorHex: palette.mdHeading, bold: true };
const QUOTE_BASE = { colorHex: palette.mdBlockQuote, italic: true };
const LIST_BASE = { colorHex: palette.mdListItem };
const BULLET = theme.bullet;
const NUMBERED = theme.numbered;
const QUOTE = theme.quote;
const FENCE = theme.rule;
const CODE = theme.code;
const COMMENT = theme.comment;
const STRING = theme.string;
const NUMBER = theme.number;
const KEYWORD = theme.keyword;

const KEYWORDS = new Set([
  'const','let','var','function','return','if','else','for','while','do','switch','case','break',
  'continue','class','extends','super','new','this','import','from','export','default','async',
  'await','try','catch','finally','throw','typeof','instanceof','in','of','yield','static','get',
  'set','null','undefined','true','false','void','delete','def','elif','lambda','pass','raise',
  'with','as','not','and','or','is','None','True','False','self','print','pub','fn','impl',
  'struct','enum','match','use','mut','crate','mod','trait','public','private','protected',
  'package','interface','implements','final','int','string','bool','float','double','char',
  'long','short','byte','echo','then','fi','done','esac','local','source',
]);

/**
 * Callout GitHub (GFM alerts) — `> [!NOTE]`, `> [!TIP]`, dst. — dirender
 * sebagai blok berwarna dengan ikon, bukan blockquote polos. System prompt
 * meminta model memakai callout ini, jadi menanganinya memberi dampak visual
 * langsung di hampir setiap jawaban.
 */
const CALLOUT_SPECS = {
  NOTE: { icon: '📘', label: 'NOTE', hex: palette.info },
  INFO: { icon: '📘', label: 'INFO', hex: palette.info },
  TIP: { icon: '💡', label: 'TIP', hex: palette.success },
  IMPORTANT: { icon: '❗', label: 'IMPORTANT', hex: palette.accent },
  WARNING: { icon: '⚠️', label: 'WARNING', hex: palette.warning },
  CAUTION: { icon: '🔥', label: 'CAUTION', hex: palette.error },
};
const CALLOUT_RULE_WIDTH = 32;

const TOKEN_RE =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|\b([A-Za-z_$][\w$]*)\b/g;

/** Mewarnai satu baris kode (komentar, string, angka, kata kunci). */
function highlightCode(line) {
  let out = '';
  let last = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m.index > last) out += line.slice(last, m.index);
    if (m[1] !== undefined) out += COMMENT(m[1]);
    else if (m[2] !== undefined) out += STRING(m[2]);
    else if (m[3] !== undefined) out += NUMBER(m[3]);
    else if (m[4] !== undefined) out += KEYWORDS.has(m[4]) ? KEYWORD(m[4]) : m[4];
    last = m.index + m[0].length;
  }
  out += line.slice(last);
  return out;
}

const isSpace = (c) => /\s/.test(c);

/** Menebak jenis awal baris markdown; 'wait' bila butuh karakter lagi. */
function classifyPrefix(buf) {
  if (!buf) return 'wait';
  if (buf.startsWith('```') || buf.startsWith('~~~')) return 'fence';
  if (/^[`~]+$/.test(buf)) return 'wait';
  if (/^#{1,6}$/.test(buf)) return 'wait';
  if (/^#{1,6} /.test(buf)) return 'heading';
  if (buf[0] === '#') return 'normal';
  if (/^\s*$/.test(buf)) return /^\s{5,}$/.test(buf) ? 'normal' : 'wait';
  if (/^ {0,3}>/.test(buf)) return 'quote';
  if (/^ {0,3}[-*+] /.test(buf)) return 'bullet';
  if (/^ {0,3}\d+\. /.test(buf)) return 'numbered';
  if (/^ {0,3}[-*+]$/.test(buf)) return 'wait';
  if (/^ {0,3}\d+\.?$/.test(buf)) return 'wait';
  return 'normal';
}

export class AnswerStyler {
  constructor({ useColor = true } = {}) {
    this.useColor = Boolean(useColor);
    this.reset();
  }

  reset() {
    this.mode = 'text';
    this.atLineStart = true;
    this.prefixBuf = '';
    this.pending = '';
    this.run = '';
    this.lineBase = null;
    this.inline = { bold: false, italic: false, strike: false, code: false };
    this.lastChar = '';
    this.codeBuf = '';
    this.fence = '```';
    this.fenceHeader = false;
    // Status blockquote/callout: bar ditunda sampai jelas apakah baris quote
    // membuka callout ([!NOTE] dst.) atau kutipan biasa.
    this.quoteLineStart = false;
    this.quoteIndent = '';
    this.quoteLead = '';
    this.calloutProbe = null;
    this.callout = null;
    this.calloutTitlePending = false;
  }

  /** Menelan sepotong token keluaran model, mengembalikan teks siap cetak. */
  push(chunk) {
    if (chunk == null) return '';
    const str = String(chunk);
    if (!this.useColor) return str;

    const out = [];
    let s = this.pending + str;
    this.pending = '';
    let i = 0;
    while (i < s.length) {
      if (this.mode === 'code') {
        i = this.consumeCode(out, s, i);
        continue;
      }
      if (this.atLineStart) {
        const c = s[i];
        if (c === '\n') {
          // Baris kosong mengakhiri blok callout yang sedang aktif.
          if (this.callout) out.push(this.closeCalloutRule(), '\n');
          out.push(this.prefixBuf, '\n');
          this.prefixBuf = '';
          this.resetLine();
          i++;
          continue;
        }
        this.prefixBuf += c;
        i++;
        const verdict = classifyPrefix(this.prefixBuf);
        if (verdict === 'wait') continue;
        this.emitPrefix(out, verdict);
        continue;
      }
      const c = s[i++];
      if (c === '\n') {
        // Baris quote tanpa konten (atau probe callout yang tidak jadi):
        // tetap cetak barnya dulu agar kutipan kosong tetap terlihat.
        if (this.quoteLineStart) {
          if (this.calloutProbe || this.quoteLead) {
            this.pending = this.quoteLead + (this.calloutProbe || '') + this.pending;
            this.calloutProbe = null;
            this.quoteLead = '';
          }
          this.emitQuoteBar(out);
          this.quoteLineStart = false;
        }
        this.resolvePendingAtEol(out);
        this.flushRun(out);
        out.push('\n');
        this.resetLine();
        continue;
      }
      this.pending += c;
      this.parseText(out);
    }
    this.flushRun(out);
    return out.join('');
  }

  /** Menutup sisa buffer (dipanggil saat giliran model selesai). */
  flush() {
    if (!this.useColor) return '';
    const out = [];
    if (this.mode === 'code') {
      if (this.codeBuf) {
        out.push(this.fenceHeader ? FENCE(this.codeBuf) : highlightCode(this.codeBuf));
        this.codeBuf = '';
      }
    } else {
      if (this.quoteLineStart) {
        if (this.calloutProbe || this.quoteLead) {
          this.pending = this.quoteLead + (this.calloutProbe || '') + this.pending;
          this.calloutProbe = null;
          this.quoteLead = '';
        }
        this.emitQuoteBar(out);
        this.quoteLineStart = false;
      }
      this.resolvePendingAtEol(out);
      this.flushRun(out);
      // Stream berakhir di tengah callout: tutup bloknya agar rapi.
      if (this.callout) out.push('\n' + this.closeCalloutRule());
    }
    return out.join('');
  }

  /**
   * True bila parser sedang berada di dalam blok kode berbatas (fence).
   *
   * Dipakai pemanggil untuk mematikan pembungkusan baris: kode harus tetap
   * utuh apa adanya — memotong sebuah pernyataan panjang atau menambahkan
   * indentasi lanjutan bisa membuat potongan kode yang disalin jadi rusak.
   */
  get inCodeBlock() {
    return this.mode === 'code';
  }

  // ---- internal ----

  /**
   * Mencetak bar pembuka baris blockquote: bar emas kutipan biasa, atau bar
   * warna callout bila sedang di dalam blok callout. Tanpa spasi tambahan —
   * spasi konten sesudah ">" dikembalikan lewat quoteLead agar tidak dobel.
   */
  emitQuoteBar(out) {
    if (this.callout) {
      const tint = chalk.hex(this.callout.hex);
      out.push(`${this.quoteIndent}${tint('│')}`);
      this.lineBase = { colorHex: this.callout.hex };
    } else {
      out.push(`${this.quoteIndent}${QUOTE('│')}`);
      this.lineBase = QUOTE_BASE;
    }
  }

  /** Garis penutup blok callout (sekalian mematikan status callout). */
  closeCalloutRule() {
    const hex = this.callout.hex;
    this.callout = null;
    return chalk.hex(hex).dim('─'.repeat(CALLOUT_RULE_WIDTH));
  }

  resetLine() {
    this.atLineStart = true;
    this.prefixBuf = '';
    this.pending = '';
    this.run = '';
    this.lineBase = null;
    this.inline = { bold: false, italic: false, strike: false, code: false };
    this.lastChar = '';
    this.quoteLineStart = false;
    this.quoteIndent = '';
    this.quoteLead = '';
    this.calloutProbe = null;
    this.calloutTitlePending = false;
  }

  styleRun() {
    if (this.inline.code) return CODE;
    const base = this.lineBase;
    const bold = this.inline.bold || Boolean(base && base.bold);
    const italic = this.inline.italic || Boolean(base && base.italic);
    const strike = this.inline.strike || Boolean(base && base.strike);
    const colorHex = base ? base.colorHex : null;
    if (!bold && !italic && !strike && !colorHex) return null;
    return (t) => {
      let c = colorHex ? chalk.hex(colorHex) : chalk;
      if (bold) c = c.bold;
      if (italic) c = c.italic;
      if (strike) c = c.strikethrough;
      return c(t);
    };
  }

  flushRun(out) {
    if (!this.run) return;
    const fn = this.styleRun();
    out.push(fn ? fn(this.run) : this.run);
    this.run = '';
  }

  toggle(out, name) {
    this.flushRun(out);
    this.inline[name] = !this.inline[name];
  }

  emitPrefix(out, verdict) {
    const buf = this.prefixBuf;
    this.prefixBuf = '';
    this.atLineStart = false;

    // Baris non-quote mengakhiri blok callout yang sedang aktif.
    if (this.callout && verdict !== 'quote') {
      out.push(this.closeCalloutRule(), '\n');
    }

    if (verdict === 'heading') {
      this.lineBase = HEADING_BASE;
      return;
    }
    if (verdict === 'quote') {
      // Bar quote DITUNDA: baris bisa jadi pembuka callout ([!TIP] dst.),
      // dan markernya baru terbaca setelah prefix "> " ini. Barnya dicetak
      // oleh emitQuoteBar() begitu jenis baris pasti.
      const m = buf.match(/^(\s*)>/);
      this.quoteIndent = m ? m[1] : '';
      this.quoteLineStart = true;
      this.lineBase = QUOTE_BASE;
      return;
    }
    if (verdict === 'bullet') {
      const m = buf.match(/^(\s*)([-*+])\s/);
      out.push(`${m[1]}${BULLET('•')} `);
      this.lineBase = LIST_BASE;
      return;
    }
    if (verdict === 'numbered') {
      const m = buf.match(/^(\s*)(\d+\.)\s/);
      out.push(`${m[1]}${NUMBERED(m[2])} `);
      this.lineBase = LIST_BASE;
      return;
    }
    if (verdict === 'fence') {
      out.push(FENCE(buf));
      this.fence = buf.trim().startsWith('~~~') ? '~~~' : '```';
      this.fenceHeader = true;
      this.codeBuf = '';
      this.mode = 'code';
      return;
    }
    this.pending += buf;
    this.parseText(out);
  }

  parseText(out) {
    for (;;) {
      const p = this.pending;
      if (!p.length) return;

      // Awal isi baris blockquote: Lewati dulu spasi setelah ">", lalu tentukan
      // kutipan biasa atau callout ([!TIP] dst.).
      if (this.quoteLineStart) {
        if (this.calloutProbe === null && p[0] === ' ') {
          this.quoteLead += ' ';
          this.pending = p.slice(1);
          continue;
        }
        if (this.calloutProbe !== null || p[0] === '[') {
          this.calloutProbe = (this.calloutProbe || '') + p[0];
          this.pending = p.slice(1);
          const probe = this.calloutProbe;
          const hit = probe.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO)\](\s?)/i);
          if (hit) {
            const spec = CALLOUT_SPECS[hit[1].toUpperCase()];
            const paint = chalk.hex(spec.hex);
            this.quoteLead = '';
            out.push(`${this.quoteIndent}${paint.bold(`${spec.icon} ${spec.label}`)}`);
            // Marker selalu membuka blok callout baru (termasuk marker kedua
            // dalam satu blockquote) — tint blok mengikuti marker terakhir.
            this.callout = { hex: spec.hex };
            if (this.pending.length) {
              out.push(paint(' ── '));
              this.lineBase = { colorHex: spec.hex, bold: true };
            } else {
              this.lineBase = null;
              // Judul kustom bisa menyusul di potongan stream berikutnya.
              this.calloutTitlePending = true;
            }
            this.quoteLineStart = false;
            this.calloutProbe = null;
            continue;
          }
          // Masih bisa jadi marker callout yang belum lengkap: tunggu karakter berikutnya.
          if (/^\[!?[A-Za-z]*$/.test(probe)) return;
          // Tidak jadi callout — kembalikan karakter probe sebagai teks quote biasa.
          this.pending = this.quoteLead + probe + this.pending;
          this.quoteLead = '';
          this.calloutProbe = null;
          this.emitQuoteBar(out);
          this.quoteLineStart = false;
          continue;
        }
        this.pending = this.quoteLead + this.pending;
        this.quoteLead = '';
        this.emitQuoteBar(out);
        this.quoteLineStart = false;
        continue;
      }

      // Judul kustom callout menyusul setelah marker (streaming): karakter
      // pertama judul menyalakan pemisah " ── " dan gaya tebal.
      if (this.calloutTitlePending) {
        if (!p.length) return;
        if (p[0] === ' ') {
          this.pending = p.slice(1); // spasi pemisah — telan
          continue;
        }
        const paint = chalk.hex(this.callout.hex);
        out.push(paint(' ── '));
        this.lineBase = { colorHex: this.callout.hex, bold: true };
        this.calloutTitlePending = false;
        continue;
      }

      // Di dalam `kode` sebaris: semua karakter literal kecuali backtick penutup.
      if (this.inline.code) {
        if (p[0] === '`') { this.toggle(out, 'code'); this.pending = p.slice(1); continue; }
        this.run += p[0];
        this.lastChar = p[0];
        this.pending = p.slice(1);
        continue;
      }

      if (p.startsWith('**') || p.startsWith('__')) {
        if (this.inline.bold) {
          if (this.lastChar && !isSpace(this.lastChar)) { this.toggle(out, 'bold'); this.pending = p.slice(2); continue; }
          this.run += p.slice(0, 2); this.lastChar = p[1]; this.pending = p.slice(2); continue;
        }
        if (p.length < 3) return; // tunggu karakter penentu
        if (isSpace(p[2])) { this.run += p.slice(0, 2); this.lastChar = p[1]; this.pending = p.slice(2); continue; }
        this.toggle(out, 'bold'); this.pending = p.slice(2); continue;
      }

      if (p.startsWith('~~')) {
        if (this.inline.strike) {
          if (this.lastChar && !isSpace(this.lastChar)) { this.toggle(out, 'strike'); this.pending = p.slice(2); continue; }
          this.run += '~~'; this.lastChar = '~'; this.pending = p.slice(2); continue;
        }
        if (p.length < 3) return;
        if (isSpace(p[2])) { this.run += '~~'; this.lastChar = '~'; this.pending = p.slice(2); continue; }
        this.toggle(out, 'strike'); this.pending = p.slice(2); continue;
      }

      if (p[0] === '`') {
        if (this.inline.code) { this.toggle(out, 'code'); this.pending = p.slice(1); continue; }
        if (p.length < 2) return;
        if (isSpace(p[1])) { this.run += '`'; this.lastChar = '`'; this.pending = p.slice(1); continue; }
        this.toggle(out, 'code'); this.pending = p.slice(1); continue;
      }

      if (p[0] === '*' || p[0] === '_') {
        const ch = p[0];
        const isWord = (c) => c !== undefined && c !== '' && /[\w]/.test(c);
        if (this.inline.italic) {
          // Penutup miring.
          if (ch === '_') {
            if (p.length < 2) return; // tunggu karakter setelahnya
            if (isWord(p[1])) { this.run += ch; this.lastChar = ch; this.pending = p.slice(1); continue; }
          }
          if (this.lastChar && !isSpace(this.lastChar)) { this.toggle(out, 'italic'); this.pending = p.slice(1); continue; }
          this.run += ch; this.lastChar = ch; this.pending = p.slice(1); continue;
        }
        // Pembuka miring — garis bawah di tengah kata (mis. edit_file) BUKAN penanda.
        if (ch === '_' && isWord(this.lastChar)) {
          this.run += ch; this.lastChar = ch; this.pending = p.slice(1); continue;
        }
        if (p.length < 2) return;
        if (isSpace(p[1])) {
          this.run += ch; this.lastChar = ch; this.pending = p.slice(1); continue;
        }
        this.toggle(out, 'italic'); this.pending = p.slice(1); continue;
      }

      this.run += p[0];
      this.lastChar = p[0];
      this.pending = p.slice(1);
    }
  }

  resolvePendingAtEol(out) {
    while (this.pending.length) {
      const p = this.pending;
      if (this.inline.bold && (p.startsWith('**') || p.startsWith('__')) && this.lastChar && !isSpace(this.lastChar)) {
        this.toggle(out, 'bold'); this.pending = p.slice(2); continue;
      }
      if (this.inline.strike && p.startsWith('~~') && this.lastChar && !isSpace(this.lastChar)) {
        this.toggle(out, 'strike'); this.pending = p.slice(2); continue;
      }
      if (this.inline.code && p[0] === '`') { this.toggle(out, 'code'); this.pending = p.slice(1); continue; }
      if (this.inline.italic && (p[0] === '*' || p[0] === '_') && this.lastChar && !isSpace(this.lastChar)) {
        this.toggle(out, 'italic'); this.pending = p.slice(1); continue;
      }
      this.run += p[0];
      this.lastChar = p[0];
      this.pending = p.slice(1);
    }
  }

  consumeCode(out, s, i) {
    const nl = s.indexOf('\n', i);
    if (nl === -1) {
      this.codeBuf += s.slice(i);
      return s.length;
    }
    this.codeBuf += s.slice(i, nl);
    if (this.fenceHeader) {
      out.push(FENCE(this.codeBuf));
      this.fenceHeader = false;
    } else if (this.codeBuf.trim().startsWith(this.fence)) {
      out.push(FENCE(this.codeBuf));
      this.mode = 'text';
      this.codeBuf = '';
      out.push('\n');
      this.resetLine();
      return nl + 1;
    } else {
      out.push(highlightCode(this.codeBuf));
    }
    out.push('\n');
    this.codeBuf = '';
    return nl + 1;
  }
}
