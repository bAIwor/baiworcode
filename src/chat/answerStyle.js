import chalk from 'chalk';

/**
 * Pewarna jawaban asisten bergaya markdown (rasa opencode): judul, **tebal**,
 * *miring*, `kode` sebaris, blok kode, daftar berbutir, dan kutipan.
 *
 * - Hanya menambah kode ANSI; teks tak pernah rusak (kecuali penanda markdown
 *   yang memang disembunyikan seperti `**` dan `#`).
 * - Bekerja saat streaming, bukan menunggu jawaban utuh.
 * - Saat useColor=false (output dipipa) jadi pass-through murni.
 */

const HEADINGS = [
  chalk.hex('#FBBF24').bold, chalk.hex('#38BDF8').bold, chalk.hex('#A78BFA').bold,
  chalk.hex('#22D3EE').bold, chalk.hex('#2DD4BF').bold, chalk.hex('#2DD4BF').bold,
];
const BULLET = chalk.hex('#22D3EE');
const NUMBERED = chalk.hex('#34D399');
const QUOTE = chalk.gray.italic;
const FENCE = chalk.gray;
const CODE = chalk.hex('#F472B6');
const COMMENT = chalk.hex('#94A3B8').italic;
const STRING = chalk.hex('#86EFAC');
const NUMBER = chalk.hex('#FDBA74');
const KEYWORD = chalk.hex('#C084FC');

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
    this.lineStyle = null;
    this.inline = { bold: false, italic: false, strike: false, code: false };
    this.lastChar = '';
    this.codeBuf = '';
    this.fence = '```';
    this.fenceHeader = false;
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
      this.resolvePendingAtEol(out);
      this.flushRun(out);
    }
    return out.join('');
  }

  // ---- internal ----

  resetLine() {
    this.atLineStart = true;
    this.prefixBuf = '';
    this.pending = '';
    this.run = '';
    this.lineStyle = null;
    this.inline = { bold: false, italic: false, strike: false, code: false };
    this.lastChar = '';
  }

  styleRun() {
    if (this.lineStyle) return this.lineStyle;
    if (this.inline.code) return CODE;
    if (!this.inline.bold && !this.inline.italic && !this.inline.strike) return null;
    let c = chalk;
    if (this.inline.bold) c = c.bold;
    if (this.inline.italic) c = c.italic;
    if (this.inline.strike) c = c.strikethrough;
    return (t) => c(t);
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

    if (verdict === 'heading') {
      const level = Math.min((buf.match(/^#{1,6}/) || ['#'])[0].length, 6);
      this.lineStyle = HEADINGS[level - 1];
      return;
    }
    if (verdict === 'quote') {
      const m = buf.match(/^(\s*)>/);
      out.push(`${m ? m[1] : ''}${QUOTE('│')}`);
      this.lineStyle = QUOTE;
      return;
    }
    if (verdict === 'bullet') {
      const m = buf.match(/^(\s*)([-*+])\s/);
      out.push(`${m[1]}${BULLET('•')} `);
      return;
    }
    if (verdict === 'numbered') {
      const m = buf.match(/^(\s*)(\d+\.)\s/);
      out.push(`${m[1]}${NUMBERED(m[2])} `);
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

      if (this.lineStyle) {
        this.run += p;
        this.lastChar = p[p.length - 1];
        this.pending = '';
        return;
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
