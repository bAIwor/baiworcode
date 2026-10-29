/**
 * Membangun HTML bergaya terminal dari tangkapan ANSI mentah.
 *
 * Dipakai dua kali: render-shot.mjs (satu gambar statis) dan
 * pty-frames.mjs (rangkaian frame untuk video).
 */

import { ansiToRows, styleToCss, escapeHtml } from './ansi-html.mjs';

export const FONT_SIZE = 14.5;
export const LINE_HEIGHT = 1.55;
const BAR_HEIGHT = 45;
const PAD_Y = 40;

/**
 * Tinggi viewport (CSS px) yang pas untuk sejumlah baris terminal.
 */
export function viewportHeight(rows) {
  return Math.ceil(BAR_HEIGHT + PAD_Y + rows * FONT_SIZE * LINE_HEIGHT + 12);
}

/**
 * @returns {{html:string, rows:number, height:number}}
 */
export function buildTerminalHtml(raw, { cols = 120, rows = 200, title = 'terminal', fill = false } = {}) {
  const grid = ansiToRows(raw, { cols, rows });

  /* Buang baris kosong di ekor, pertahankan yang di tengah. */
  while (grid.length > 1) {
    const last = grid[grid.length - 1];
    if (!last || last.length === 0) grid.pop();
    else break;
  }

  const body = grid
    .map((row) => {
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
      return html || '&nbsp;';
    })
    .join('\n');

  const height = Math.ceil(BAR_HEIGHT + PAD_Y + grid.length * FONT_SIZE * LINE_HEIGHT + 12);

  const fillCss = fill
    ? `html, body { height: 100%; }
  .frame { height: 100vh; display: flex; flex-direction: column; border-radius: 0; }
  pre { flex: 1; overflow: hidden; }`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #0d1117; }
  .frame {
    display: inline-block;
    min-width: 100%;
    background: #161b22;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 24px 70px rgba(0,0,0,.55);
    border: 1px solid #2b3440;
  }
  .bar {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px;
    background: linear-gradient(180deg, #1c222b 0%, #171d25 100%);
    border-bottom: 1px solid #2b3440;
  }
  .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  .d1 { background: #ff5f57; } .d2 { background: #febc2e; } .d3 { background: #28c840; }
  .title {
    flex: 1; text-align: center; margin-right: 44px;
    font: 500 13px/1 'Segoe UI', system-ui, sans-serif;
    color: #8b949e; letter-spacing: .2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  pre {
    margin: 0; padding: 20px 22px;
    font-family: 'Cascadia Code', 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace;
    font-size: ${FONT_SIZE}px; line-height: ${LINE_HEIGHT};
    color: #c9d1d9; white-space: pre; tab-size: 8;
    font-variant-ligatures: none;
  }
  pre a { color: #79c0ff; text-decoration: underline; }
  ${fillCss}
</style>
</head>
<body>
  <div class="frame">
    <div class="bar">
      <span class="dot d1"></span><span class="dot d2"></span><span class="dot d3"></span>
      <div class="title" id="ttl">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>
    </div>
    <pre id="term">${body}</pre>
  </div>
</body>
</html>`;

  return { html, rows: grid.length, height };
}

/**
 * Versi ringkas: hanya isi <pre> — untuk update via CDP tanpa rebuild frame.
 */
export function buildTermBody(raw, { cols = 120, rows = 200 } = {}) {
  const grid = ansiToRows(raw, { cols, rows });
  while (grid.length > 1) {
    const last = grid[grid.length - 1];
    if (!last || last.length === 0) grid.pop();
    else break;
  }

  const body = grid
    .map((row) => {
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
      return html || '&nbsp;';
    })
    .join('\n');

  return { body, rows: grid.length };
}
