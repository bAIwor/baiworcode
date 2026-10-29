#!/usr/bin/env node
/**
 * Mengubah tangkapan ANSI mentah menjadi PNG bergaya terminal.
 *
 *   node render-shot.mjs <masukan.ansi> <keluaran.png> [--title "..."] [--cols 120]
 *                        [--head 0] [--tail 0] [--width 1600] [--scale 2]
 *
 * Alur: ANSI -> grid sel bergaya -> <pre> HTML -> bingkai terminal ->
 * Chrome headless --screenshot -> PNG.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { ansiToRows, styleToCss, escapeHtml } from './ansi-html.mjs';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flags = {};
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
}

const inputPath = positional[0];
const outputPath = positional[1];
if (!inputPath || !outputPath) {
  console.error('Usage: node render-shot.mjs <in.ansi> <out.png> [--title T] [--cols N]');
  process.exit(2);
}

const cols = Number(flags.cols || 120);
const width = Number(flags.width || 1600);
const scale = Number(flags.scale || 2);
const title = flags.title || 'terminal';
const headTrim = Number(flags.head || 0);
const tailTrim = Number(flags.tail || 0);

const FONT_SIZE = 14.5;
const LINE_HEIGHT = 1.55;
const BAR_HEIGHT = 45;
const PAD_Y = 40;

const raw = fs.readFileSync(inputPath, 'utf8');
/* rows = tinggi viewport terminal. Tangkapan non-TUI diberi viewport besar
   agar tidak ada yang terpotong; tangkapan TUI memakai ukuran aslinya. */
const viewportRows = Number(flags.rows || 200);
const grid = ansiToRows(raw, { cols, rows: viewportRows });

let rows = grid;
if (headTrim > 0) rows = rows.slice(headTrim);
if (tailTrim > 0) rows = rows.slice(0, Math.max(0, rows.length - tailTrim));
while (rows.length && rows[0].every((c) => !c || c.ch === ' ')) rows.shift();

/* Render tiap baris menjadi rentasan <span> per gaya. */
const body = rows
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

const windowHeight = Math.ceil(
  BAR_HEIGHT + PAD_Y + rows.length * FONT_SIZE * LINE_HEIGHT + 12
);

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
</style>
</head>
<body>
  <div class="frame">
    <div class="bar">
      <span class="dot d1"></span><span class="dot d2"></span><span class="dot d3"></span>
      <div class="title">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>
    </div>
    <pre>${body}</pre>
  </div>
</body>
</html>`;

const tmpHtml = path.join(os.tmpdir(), `term-${path.basename(outputPath, '.png')}.html`);
fs.writeFileSync(tmpHtml, html, 'utf8');

const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const chrome = chromeCandidates.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('Tidak menemukan Chrome/Edge untuk screenshot.');
  process.exit(3);
}

const args = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-component-update',
  '--disable-features=ComponentUpdater,OptimizationGuideModelDownloading,Translate',
  '--disable-component-extensions-with-background-pages',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-dev-shm-usage',
  `--user-data-dir=${path.join(os.tmpdir(), `chrome-shot-${process.pid}`)}`,
  `--force-device-scale-factor=${scale}`,
  `--window-size=${width},${windowHeight}`,
  '--virtual-time-budget=8000',
  `--screenshot=${path.resolve(outputPath)}`,
  `file:///${tmpHtml.replace(/\\/g, '/')}`,
];

const res = spawnSync(chrome, args, { encoding: 'utf8', timeout: 90000 });
if (!fs.existsSync(path.resolve(outputPath))) {
  console.error('Screenshot gagal:', (res.stderr || res.stdout || '').split('\n').slice(0, 5).join('\n'));
  process.exit(4);
}
console.log(
  `[render-shot] ${outputPath} (${rows.length} baris, ${windowHeight}px, ${fs.statSync(outputPath).size} bytes)`
);
fs.unlinkSync(tmpHtml);
