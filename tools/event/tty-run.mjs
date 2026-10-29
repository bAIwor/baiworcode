#!/usr/bin/env node
/**
 * Menjalankan sebuah CLI di bawah pseudo-TTY lalu menyimpan keluaran ANSI
 * mentah ke berkas. Dipakai untuk membuat tangkapan layar terminal yang
 * jujur — isi gambarnya benar-benar output asli aplikasi.
 *
 * Pemakaian:
 *   node tty-run.mjs --out capture.ansi [--cols 120] [--env K=V] -- node target.mjs args...
 */

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const argv = process.argv.slice(2);

function parseArgs() {
  const opts = { out: null, cols: 120, rows: 40, cmd: [], env: {}, cwd: null };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--out') {
      opts.out = argv[i + 1];
      i += 2;
    } else if (a === '--cols') {
      opts.cols = Number(argv[i + 1]);
      i += 2;
    } else if (a === '--rows') {
      opts.rows = Number(argv[i + 1]);
      i += 2;
    } else if (a === '--cwd') {
      opts.cwd = argv[i + 1];
      i += 2;
    } else if (a === '--env') {
      const idx = argv[i + 1].indexOf('=');
      opts.env[argv[i + 1].slice(0, idx)] = argv[i + 1].slice(idx + 1);
      i += 2;
    } else if (a === '--') {
      opts.cmd = argv.slice(i + 1);
      i = argv.length;
    } else {
      opts.cmd = argv.slice(i);
      i = argv.length;
    }
  }
  return opts;
}

const opts = parseArgs();
if (!opts.cmd.length) {
  console.error('Usage: node tty-run.mjs --out <file> [--cols N] [--env K=V] -- <cmd> [args...]');
  process.exit(2);
}

const chunks = [];

const child = spawn(opts.cmd[0], opts.cmd.slice(1), {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: opts.cwd || process.cwd(),
  env: {
    ...process.env,
    FORCE_COLOR: '3',
    COLORTERM: 'truecolor',
    TERM: 'xterm-256color',
    CAPTURE_COLS: String(opts.cols),
    CAPTURE_ROWS: String(opts.rows),
    ...opts.env,
  },
});

child.stdout.on('data', (b) => chunks.push(b.toString('utf8')));
child.stderr.on('data', (b) => chunks.push(b.toString('utf8')));

child.on('close', (code) => {
  const text = chunks.join('');
  if (opts.out) {
    const dest = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text, 'utf8');
    console.error(`[tty-run] wrote ${dest} (${text.length} chars, exit ${code})`);
  } else {
    process.stdout.write(text);
  }
  process.exit(code ?? 0);
});
