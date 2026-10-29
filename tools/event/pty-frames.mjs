#!/usr/bin/env node
/**
 * Perekam layar terminal -> rangkaian frame PNG.
 *
 * Menjalankan sebuah TUI di PTY, lalu memotret isi layar Terminal pada
 * interval tetap memakai Chrome DevTools Protocol. Hasilnya rangkaian frame
 * yang bisa dirakit jadi video dengan ffmpeg.
 *
 * Pemakaian:
 *   node pty-frames.mjs --out frames/ --fps 4 --duration 40 --cols 120 --rows 34 \
 *        --title "baiworcode" --width 1600 -- <cmd> [args...]
 *
 * `--duration` dalam detik.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildTerminalHtml, buildTermBody, viewportHeight } from './term-html.mjs';

const require = createRequire('C:/Users/Wijang/.baiwor/pty-tools/');
const pty = require('node-pty');

const argv = process.argv.slice(2);
const flags = {};
const cmd = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--') {
    cmd.push(...argv.slice(i + 1));
    break;
  }
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
}

const outDir = path.resolve(flags.out || 'frames');
const fps = Number(flags.fps || 4);
const durationSec = Number(flags.duration || 30);
const cols = Number(flags.cols || 120);
const rows = Number(flags.rows || 34);
const width = Number(flags.width || 1600);
const scale = Number(flags.scale || 2);
const title = flags.title || 'terminal';
const cwd = flags.cwd || process.cwd();
const typeText = flags.type || '';
const typeDelay = Number(flags.typeDelay || 1500);

if (!cmd.length) {
  console.error('Usage: node pty-frames.mjs --out <dir> [--fps N] [--duration ms] -- <cmd> [args...]');
  process.exit(2);
}

fs.mkdirSync(outDir, { recursive: true });

/* ------------------------------------------------------------------ *
 * Chrome headless dengan remote debugging
 * ------------------------------------------------------------------ */
const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chrome = chromeCandidates.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('Tidak menemukan Chrome/Edge.');
  process.exit(3);
}

const port = 9500 + Math.floor(Math.random() * 400);
const profileDir = path.join(os.tmpdir(), `chrome-frames-${process.pid}`);

const chromeProc = spawn(
  chrome,
  [
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
    `--user-data-dir=${profileDir}`,
    `--force-device-scale-factor=${scale}`,
    `--window-size=${width},900`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPageTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* chrome belum siap */
    }
    await sleep(300);
  }
  throw new Error('Tidak bisaconnects ke Chrome DevTools');
}

const wsUrl = await findPageTarget();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let msgId = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
});

function cdp(method, params = {}) {
  msgId += 1;
  const id = msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await cdp('Page.enable');
await cdp('Runtime.enable');

/* Kunci ukuran viewport persis agar tiap frame sama besar dan panel
   terminal memenuhi layar (tanpa pita kosong di bawah). */
const viewport = { width, height: viewportHeight(rows) };
await cdp('Emulation.setDeviceMetricsOverride', {
  width: viewport.width,
  height: viewport.height,
  deviceScaleFactor: scale,
  mobile: false,
});

const { html } = buildTerminalHtml('', { cols, rows, title, fill: true });
const blankFile = path.join(outDir, '_blank.html');
fs.writeFileSync(blankFile, html, 'utf8');
await cdp('Page.navigate', { url: `file:///${blankFile.replace(/\\/g, '/')}` });
await sleep(1200);

/* ------------------------------------------------------------------ *
 * PTY + perekaman frame
 * ------------------------------------------------------------------ */
let raw = '';
const term = pty.spawn(cmd[0], cmd.slice(1), {
  name: 'xterm-256color',
  cols,
  rows,
  cwd,
  env: { ...process.env, FORCE_COLOR: '3', COLORTERM: 'truecolor', TERM: 'xterm-256color' },
});

term.onData((data) => {
  raw += data;
});

if (typeText) {
  const enterDelay = Number(flags.enterDelay || 900);
  setTimeout(() => {
    term.write(typeText);
    setTimeout(() => term.write('\r'), enterDelay);
  }, typeDelay);
}

const frameCount = Math.ceil(durationSec * fps);
const interval = 1000 / fps;
let shot = 0;

for (let i = 0; i < frameCount; i += 1) {
  await sleep(interval);

  const { body } = buildTermBody(raw, { cols, rows });
  const file = path.join(outDir, `frame-${String(shot).padStart(4, '0')}.png`);
  try {
    await cdp('Runtime.evaluate', {
      expression: `document.getElementById('term').innerHTML = ${JSON.stringify(body)};`,
    });
    const res = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
    shot += 1;
    process.stdout.write(`\r[frames] ${shot}/${frameCount}`);
  } catch (err) {
    console.error(`\n[frames] gagal pada frame ${shot}: ${err.message}`);
  }
}

process.stdout.write('\n');
try {
  term.kill();
} catch {
  /* sudah mati */
}
ws.close();
chromeProc.kill();
fs.unlinkSync(blankFile);
console.log(`[pty-frames] ${shot} frame -> ${outDir}`);
process.exit(0);
