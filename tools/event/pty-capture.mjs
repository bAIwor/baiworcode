#!/usr/bin/env node
/**
 * Penangkap layar TUI lewat pseudo-terminal (ConPTY di Windows).
 *
 * CLI TUI seperti MiniMax Code menolak jalan tanpa TTY sungguhan. Modul ini
 * menjalankan perintah di dalam PTY, mengetik prompt, lalu menyimpan seluruh
 * aliran ANSI mentahnya. Emulator di ansi-html.mjs lalu merekonstruksi layar
 * terakhir dari aliran itu.
 *
 * Pemakaian:
 *   node pty-capture.mjs --out tui.ansi --cwd <dir> --cols 120 --rows 40 \
 *        --wait 12000 --type "prompt teks" -- node cli.js arg1 arg2
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/Wijang/.baiwor/pty-tools/');
const pty = require('node-pty');

const argv = process.argv.slice(2);
const flags = {};
const rest = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--') {
    rest.push(...argv.slice(i + 1));
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

const out = flags.out;
const cols = Number(flags.cols || 120);
const rows = Number(flags.rows || 40);
const cwd = flags.cwd || process.cwd();
const waitMs = Number(flags.wait || 15000);
const typeText = flags.type || '';
const typeDelay = Number(flags.typeDelay || 2500);

if (!out || !rest.length) {
  console.error('Usage: node pty-capture.mjs --out <file> [--cwd d] [--cols N] [--rows N] [--wait ms] [--type "text"] -- <cmd> [args...]');
  process.exit(2);
}

const chunks = [];

const term = pty.spawn(rest[0], rest.slice(1), {
  name: 'xterm-256color',
  cols,
  rows,
  cwd,
  env: {
    ...process.env,
    FORCE_COLOR: '3',
    COLORTERM: 'truecolor',
    TERM: 'xterm-256color',
  },
});

term.onData((data) => chunks.push(data));

if (typeText) {
  setTimeout(() => {
    term.write(typeText);
    setTimeout(() => term.write('\r'), 400);
  }, typeDelay);
}

setTimeout(() => {
  try {
    term.kill();
  } catch {
    /* proses mungkin sudah selesai */
  }
  const text = chunks.join('');
  const dest = path.resolve(out);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text, 'utf8');
  console.log(`[pty-capture] ${dest} (${text.length} chars, ${chunks.length} frame)`);
  process.exit(0);
}, waitMs);
