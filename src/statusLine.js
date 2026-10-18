import chalk from 'chalk';
import { getConfig, getAccessMode } from './config.js';
import { theme } from './theme.js';
import { conversationSession } from './chat/conversation.js';
import { getContextUsage, formatContextIndicator } from './chat/context.js';

/**
 * Baris status di bawah area input:
 *
 *   ~ │ Full access │ ✦ <model> · <provider> │ Context 92% left
 *
 * Dipakai dua tempat — banner saat start dan area input langsung — karena
 * keduanya harus menampilkan angka yang sama, dan menyalin logikanya di dua
 * berkas hanya membuka celah agar keduanya cepat berbeda.
 */

/** Lebar minimum agar baris tetap terbaca di terminal sempit. */
const MIN_WIDTH = 40;

/**
 * Mengambil lebar terminal saat ini, dengan batas bawah yang wajar.
 *
 * @param {number} [cols] Lebar kolom; default dari `process.stdout.columns`
 *   (parameter ini memudahkan pengujian tanpa TTY sungguhan).
 * @returns {number}
 */
export function terminalWidth(cols = process.stdout.columns) {
  if (!Number.isFinite(cols) || cols <= 0) return 80;
  // Sengaja TIDAK dipatok (cap) di atas: saat terminal di-fullscreen, lebarnya
  // bisa melewati 200 kolom. Cap lama membuat garis berhenti mengikuti layar.
  return Math.max(MIN_WIDTH, cols);
}

/**
 * Lebar undakan antara garis atas dan garis bawah area input.
 * Nilainya 0 agar tepi kiri garis atas dan garis bawah sejajar sempurna di kolom 0.
 */
export const STAIR_STEP = 0;

/**
 * Dua garis pemisah horizontal yang membingkai area input.
 *
 * Garis atas dan garis bawah memiliki panjang yang sama dan posisi awal yang sama (kolom 0)
 * sehingga tepi kiri dan tepi kanan KEDUA garis sejajar sempurna dan simetris.
 * Sisakan 1 kolom di ujung kanan agar tidak memicu pending wrap di Windows ConPTY.
 *
 * @returns {{top:string, bottom:string, dashes:number}}
 */
export function frameRules(cols = process.stdout.columns) {
  const span = Math.max(10, terminalWidth(cols) - 1);
  return {
    dashes: span,
    top: chalk.gray('─'.repeat(span)),
    bottom: chalk.gray('─'.repeat(span)),
  };
}

/**
 * Garis pemisah horizontal selebar terminal.
 * @param {{indent?:string}} [options]
 * @returns {string}
 */
export function statusRule({ indent = '' } = {}) {
  return chalk.gray(`${indent}${'─'.repeat(Math.max(10, terminalWidth() - indent.length))}`);
}

/**
 * Lebar tampilan sebuah string, mengabaikan escape code ANSI.
 * Dipakai karena baris status boleh berwarna, tapi yang harus diukur adalah
 * jumlah kolom yang benar-benar tertampil.
 *
 * @param {string} s
 * @returns {number}
 */
function visibleWidth(s) {
  return [...String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')].length;
}

/**
 * Menyusun baris status lengkap.
 *
 * Baris ini tidak boleh lebih panjang dari lebar terminal — `@clack/core`
 * membungkus frame dengan `hard: true`, sehingga satu karakter kelebihan
 * akan membuat baris patah dan seluruh kotak ikut hancur. Karena itu
 * segmen-segmennya dikorbankan berurutan dari yang paling tidak penting:
 * rincian token, nama provider, keterangan akses, lalu prefix tugas.
 *
 * @param {{prefix?:string, indent?:string, maxWidth?:number|null}} [options]
 * @returns {string}
 */
export function renderStatusLine({ prefix = '', indent = '  ', maxWidth = null } = {}) {
  const config = getConfig();

  const model =
    config.activeModel && config.activeModel !== 'Not configured'
      ? config.activeModel
      : 'Not configured';

  const provider =
    config.activeProvider && config.activeProvider !== 'Not configured'
      ? config.activeProvider
      : 'baiwor.my.id';

  const usage = getContextUsage(conversationSession.getMessages(), {
    model: config.activeModel,
  });

  const bar = chalk.gray('│');

  const build = ({ detail, withProvider, withAccess, withPrefix }) => {
    const parts = [theme.info('~')];
    // Label akses dinamis mengikuti config: 'full' → Full access (agenta bebas
    // menjalankan kelas confirm tanpa bertanya di TTY), 'normal' → Safe.
    if (withAccess) parts.push(bar, theme.text(getAccessMode() === 'full' ? 'Full access' : 'Safe'));
    if (withPrefix && prefix) parts.push(bar, theme.info(prefix));
    parts.push(bar, theme.accent('✦'), theme.primary(model));
    if (withProvider) parts.push(chalk.gray('·'), theme.info(provider));
    parts.push(bar, formatContextIndicator(usage, { detail }));
    return indent + parts.join(' ');
  };

  const budget = Math.max(20, (maxWidth ?? terminalWidth()) - indent.length);

  const levels = [
    { detail: true, withProvider: true, withAccess: true, withPrefix: true },
    { detail: false, withProvider: true, withAccess: true, withPrefix: true },
    { detail: false, withProvider: false, withAccess: true, withPrefix: true },
    { detail: false, withProvider: false, withAccess: true, withPrefix: false },
    { detail: false, withProvider: false, withAccess: false, withPrefix: false },
  ];

  for (const level of levels) {
    const line = build(level);
    if (visibleWidth(line) <= budget) return line;
  }

  // Terminal sangat sempit: bahkan bentuk paling ringkas tidak muat. Pangkas
  // nama model sedikit demi sedikit daripada membiarkan baris terpotong
  // di tengah — pemotongan sebaris terlihat jauh lebih rapi daripada patah.
  for (const keep of [16, 12, 8, 4]) {
    const shortModel = model.length > keep ? `${model.slice(0, keep - 1)}…` : model;
    const line =
      indent +
      [
        theme.info('~'),
        bar,
        theme.accent('✦'),
        theme.primary(shortModel),
        bar,
        formatContextIndicator(usage, { detail: false }),
      ].join(' ');
    if (visibleWidth(line) <= budget) return line;
  }
  return indent + theme.info('~') + ' ' + formatContextIndicator(usage, { detail: false });
}
