/**
 * Preloader "pseudo-TTY".
 *
 * CLI di bawah ini (baiworcode, mcode) hanya mengaktifkan pewarnaan dan
 * layout interaktif kalau stdout dianggap terminal sungguhan. Karena kita
 * menangkap keluarannya lewat pipe, kita perlu memalsukan isTTY + jumlah
 * kolom agar hasil tangkapan sama persis dengan yang dilihat pengguna di
 * terminal asli.
 *
 * Pemakaian:
 *   node spoof.mjs <target.mjs> [args...]
 *
 * process.argv diteruskan apa adanya supaya parser CLI target tidak kacau.
 */

import { pathToFileURL } from 'node:url';

const [, , target, ...rest] = process.argv;

if (!target) {
  console.error('Usage: node spoof.mjs <target.mjs> [args...]');
  process.exit(2);
}

/* Argumen dikembalikan ke bentuk aslinya: [node, target, ...args]. */
process.argv = [process.argv[0], target, ...rest];

const cols = Number(process.env.CAPTURE_COLS || 120);
const rows = Number(process.env.CAPTURE_ROWS || 40);

for (const stream of [process.stdout, process.stderr]) {
  Object.defineProperty(stream, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(stream, 'columns', { value: cols, configurable: true });
  Object.defineProperty(stream, 'rows', { value: rows, configurable: true });
}

process.env.FORCE_COLOR = process.env.FORCE_COLOR || '3';
process.env.COLORTERM = process.env.COLORTERM || 'truecolor';
process.env.TERM = process.env.TERM || 'xterm-256color';

await import(pathToFileURL(target).href);
