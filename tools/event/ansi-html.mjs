/**
 * Emulator terminal minimal -> HTML.
 *
 * Tangkapan mentah dari CLI mengandung escape sequence: SGR (warna), gerakan
 * kursor, erase, ECH, dan TUI yang menggambar ulang frame demi frame. Kalau
 * dirender apa adanya, gambarnya jadi tumpukan frame yang tidak pernah
 * terhapus.
 *
 * Modul ini mensimulasikan layar terminal sungguhan: grid baris x sel dengan
 * viewport berbatas (seperti terminal asli) dan scrolling saat kursor melewati
 * baris bawah. Keluarnya dipakai untuk membuat satu <pre> HTML berisi <span>
 * per run warna.
 *
 * Didukung: SGR (bold/dim/italic/underline/inverse/strike), 30-37/90-97,
 * 38;5;N, 38;2;R;G;B, background 40-47/100-107/48;5;N/48;2;R;G;B,
 * EL (K), ED (J), ECH (X), DCH (P), cursor up/down/left/right (A/B/C/D),
 * cursor position (H/f), line position (d), column (G), save/restore (s/u),
 * ICH (@), tab, dan OSC 8 (hyperlink).
 */

const FG_BASE = {
  30: '#3b4048',
  31: '#e06c75',
  32: '#98c379',
  33: '#e5c07b',
  34: '#61afef',
  35: '#c678dd',
  36: '#56b6c2',
  37: '#abb2bf',
  90: '#5c6370',
  91: '#e06c75',
  92: '#98c379',
  93: '#e5c07b',
  94: '#61afef',
  95: '#c678dd',
  96: '#56b6c2',
  97: '#ffffff',
};

const BG_BASE = {
  40: '#1c2128',
  41: '#e06c75',
  42: '#98c379',
  43: '#e5c07b',
  44: '#61afef',
  45: '#c678dd',
  46: '#56b6c2',
  47: '#abb2bf',
  100: '#3b4048',
  101: '#e06c75',
  102: '#98c379',
  103: '#e5c07b',
  104: '#61afef',
  105: '#c678dd',
  106: '#56b6c2',
  107: '#ffffff',
};

/* Palet 256 warna xterm. */
function xterm256(n) {
  if (n < 16) {
    const base = [
      '#1c2128', '#e06c75', '#98c379', '#e5c07b',
      '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
      '#5c6370', '#e06c75', '#98c379', '#e5c07b',
      '#61afef', '#c678dd', '#56b6c2', '#ffffff',
    ];
    return base[n];
  }
  if (n < 232) {
    const i = n - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const r = steps[Math.floor(i / 36) % 6];
    const g = steps[Math.floor(i / 6) % 6];
    const b = steps[i % 6];
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  const v = 8 + (n - 232) * 10;
  return `#${v.toString(16).padStart(2, '0').repeat(3)}`;
}

const DEFAULT_STYLE = Object.freeze({
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strike: false,
  link: null,
});

const cloneStyle = (s) => ({ ...s });

function applySgr(style, params) {
  const nums = params.length ? params : [0];
  for (let i = 0; i < nums.length; i += 1) {
    const n = nums[i];
    if (n === 0) {
      const link = style.link;
      Object.assign(style, DEFAULT_STYLE);
      style.link = link;
    } else if (n === 1) style.bold = true;
    else if (n === 2) style.dim = true;
    else if (n === 3) style.italic = true;
    else if (n === 4) style.underline = true;
    else if (n === 7) style.inverse = true;
    else if (n === 9) style.strike = true;
    else if (n === 21 || n === 22) {
      style.bold = false;
      style.dim = false;
    } else if (n === 23) style.italic = false;
    else if (n === 24) style.underline = false;
    else if (n === 27) style.inverse = false;
    else if (n === 29) style.strike = false;
    else if (n >= 30 && n <= 37) style.fg = FG_BASE[n];
    else if (n === 39) style.fg = null;
    else if (n >= 40 && n <= 47) style.bg = BG_BASE[n];
    else if (n === 49) style.bg = null;
    else if (n >= 90 && n <= 97) style.fg = FG_BASE[n];
    else if (n >= 100 && n <= 107) style.bg = BG_BASE[n];
    else if (n === 38 || n === 48) {
      const mode = nums[i + 1];
      let color = null;
      if (mode === 5) {
        color = xterm256(nums[i + 2]);
        i += 2;
      } else if (mode === 2) {
        const [r, g, b] = [nums[i + 2], nums[i + 3], nums[i + 4]];
        color = `#${[r, g, b].map((v) => (v & 255).toString(16).padStart(2, '0')).join('')}`;
        i += 4;
      }
      if (color) {
        if (n === 38) style.fg = color;
        else style.bg = color;
      }
    }
  }
  return style;
}

export function styleToCss(style) {
  const css = [];
  let fg = style.fg;
  let bg = style.bg;
  if (style.inverse) {
    const f = fg || '#abb2bf';
    const b = bg || '#1c2128';
    fg = b;
    bg = f;
  }
  if (fg) css.push(`color:${fg}`);
  if (bg) css.push(`background-color:${bg}`);
  if (style.bold) css.push('font-weight:700');
  if (style.dim) css.push('opacity:.62');
  if (style.italic) css.push('font-style:italic');
  const decorations = [];
  if (style.underline) decorations.push('underline');
  if (style.strike) decorations.push('line-through');
  if (decorations.length) css.push(`text-decoration:${decorations.join(' ')}`);
  return css.join(';');
}

export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Menjalankan ANSI mentah pada grid terminal sungguhan (viewport berbatas).
 * @returns {Array<Array<{ch:string, style:object}|null>>}
 */
export function ansiToRows(input, opts = {}) {
  const cols = Number(opts.cols || 120);
  const rows = Math.max(1, Number(opts.rows || 40));

  const grid = [];
  for (let i = 0; i < rows; i += 1) grid.push([]);

  let row = 0;
  let col = 0;
  let style = cloneStyle(DEFAULT_STYLE);
  let saved = { row: 0, col: 0, style: cloneStyle(DEFAULT_STYLE) };

  const scrollUp = () => {
    grid.shift();
    grid.push([]);
  };

  const blankCell = () => ({
    ch: ' ',
    style: {
      ...style,
      fg: null,
      bold: false,
      dim: false,
      italic: false,
      underline: false,
      inverse: false,
      strike: false,
      link: null,
    },
  });

  const putChar = (ch) => {
    if (ch === '\n') {
      row += 1;
      col = 0;
      if (row >= rows) {
        scrollUp();
        row = rows - 1;
      }
      return;
    }
    if (ch === '\r') {
      col = 0;
      return;
    }
    if (ch === '\t') {
      col = Math.min(cols - 1, col + (8 - (col % 8)));
      return;
    }
    if (ch === '\b') {
      col = Math.max(0, col - 1);
      return;
    }
    if (ch < ' ') return;

    const r = grid[row];
    r[col] = { ch, style: cloneStyle(style) };
    col += 1;
    if (col >= cols) {
      col = 0;
      row += 1;
      if (row >= rows) {
        scrollUp();
        row = rows - 1;
      }
    }
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch !== '\x1b') {
      putChar(ch);
      i += 1;
      continue;
    }

    const next = input[i + 1];

    /* ---------------- CSI ---------------- */
    if (next === '[') {
      let j = i + 2;
      let paramsStr = '';
      while (j < input.length && !/[A-Za-z]/.test(input[j])) {
        paramsStr += input[j];
        j += 1;
      }
      const final = input[j];
      const params = paramsStr.split(';').map((p) => (p === '' ? 0 : Number(p)));
      const p0 = params[0] || 0;

      if (final === 'm') {
        applySgr(style, params);
      } else if (final === 'K') {
        const r = grid[row];
        if (p0 === 0) r.length = col;
        else if (p0 === 1) {
          for (let k = 0; k <= col && k < r.length; k += 1) r[k] = blankCell();
        } else if (p0 === 2) {
          r.length = 0;
        }
      } else if (final === 'X') {
        /* ECH: hapus N karakter mulai kursor, gaya latar dipertahankan. */
        const n = p0 || 1;
        const r = grid[row];
        for (let k = col; k < col + n; k += 1) r[k] = blankCell();
      } else if (final === 'P') {
        /* DCH: hapus N karakter di kursor, geser sisanya ke kiri. */
        const n = p0 || 1;
        const r = grid[row];
        r.splice(col, n);
      } else if (final === '@') {
        /* ICH: sisipkan N karakter kosong di kursor. */
        const n = p0 || 1;
        const r = grid[row];
        for (let k = 0; k < n; k += 1) r.splice(col, 0, null);
      } else if (final === 'J') {
        if (p0 === 0) {
          grid[row].length = col;
          for (let k = row + 1; k < rows; k += 1) grid[k].length = 0;
        } else if (p0 === 1) {
          for (let k = 0; k < row; k += 1) grid[k].length = 0;
          const r = grid[row];
          for (let k = 0; k <= col && k < r.length; k += 1) r[k] = blankCell();
        } else if (p0 === 2) {
          for (let k = 0; k < rows; k += 1) grid[k].length = 0;
          row = 0;
          col = 0;
        }
      } else if (final === 'A') {
        row = Math.max(0, row - (p0 || 1));
      } else if (final === 'B') {
        row = Math.min(rows - 1, row + (p0 || 1));
      } else if (final === 'C') {
        col = Math.min(cols - 1, col + (p0 || 1));
      } else if (final === 'D') {
        col = Math.max(0, col - (p0 || 1));
      } else if (final === 'G') {
        col = Math.max(0, Math.min(cols - 1, (p0 || 1) - 1));
      } else if (final === 'd') {
        row = Math.max(0, Math.min(rows - 1, (p0 || 1) - 1));
      } else if (final === 'H' || final === 'f') {
        row = Math.max(0, Math.min(rows - 1, (params[0] || 1) - 1));
        col = Math.max(0, Math.min(cols - 1, (params[1] || 1) - 1));
      } else if (final === 's') {
        saved = { row, col, style: cloneStyle(style) };
      } else if (final === 'u') {
        row = saved.row;
        col = saved.col;
        style = cloneStyle(saved.style);
      }

      i = j + 1;
      continue;
    }

    /* ---------------- OSC ---------------- */
    if (next === ']') {
      let j = i + 2;
      let payload = '';
      while (j < input.length) {
        if (input[j] === '\x07') break;
        if (input[j] === '\x1b' && input[j + 1] === '\\') break;
        payload += input[j];
        j += 1;
      }
      if (payload.startsWith('8;')) {
        const parts = payload.split(';');
        const uri = parts.slice(2).join(';');
        style.link = uri || null;
      }
      i = input[j] === '\x1b' ? j + 2 : j + 1;
      continue;
    }

    /* ---------------- ESC (charset, save/restore, dll) ---------------- */
    if (next === '(' || next === ')' || next === '#') {
      i += 3;
      continue;
    }
    i += 2;
  }

  /* Buang baris kosong di ekor, tapi pertahankan baris kosong di tengah. */
  while (grid.length > 1) {
    const last = grid[grid.length - 1];
    if (!last || last.length === 0) grid.pop();
    else break;
  }

  return grid;
}

/**
 * Versi yang mengembalikan HTML lengkap per baris (dengan span bergaya).
 */
export function ansiToHtml(input, opts = {}) {
  const grid = ansiToRows(input, opts);
  const out = [];

  for (const row of grid) {
    let html = '';
    let run = [];
    let runKey = null;
    let runCss = '';
    let runStyle = null;

    const flush = () => {
      if (!run.length) return;
      const text = run.join('');
      const attrs = [];
      if (runStyle?.link) {
        attrs.push(`href="${runStyle.link}"`);
        attrs.push('target="_blank"');
        attrs.push('rel="noopener"');
      }
      if (runCss) attrs.push(`style="${runCss}"`);
      html += attrs.length
        ? `<span ${attrs.join(' ')}>${escapeHtml(text)}</span>`
        : escapeHtml(text);
      run = [];
    };

    for (const cell of row) {
      const css = cell ? styleToCss(cell.style) : '';
      const key = `${css}|${cell?.style?.link || ''}`;
      if (runKey === null || key !== runKey) {
        flush();
        runKey = key;
        runCss = css;
        runStyle = cell ? cell.style : null;
      }
      run.push(cell ? cell.ch : ' ');
    }
    flush();
    out.push(html || '&nbsp;');
  }
  return out.join('\n');
}

/**
 * Baris sebagai teks polos — berguna untuk pengecekan cepat.
 */
export function ansiToLines(input, opts = {}) {
  return ansiToRows(input, opts).map((row) =>
    row
      .map((cell) => (cell ? cell.ch : ' '))
      .join('')
      .replace(/\s+$/, '')
  );
}
