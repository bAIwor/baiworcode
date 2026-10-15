import chalk from 'chalk';
import { getConfig } from './config.js';
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
 * Mengambil lebar terminal saat ini, dengan batas bawah dan atas yang wajar.
 * @returns {number}
 */
export function terminalWidth() {
  const cols = process.stdout.columns;
  if (!Number.isFinite(cols) || cols <= 0) return 80;
  return Math.max(MIN_WIDTH, Math.min(cols, 200));
}

/** Lebar undakan antara garis atas dan garis bawah area input. */
export const STAIR_STEP = 4;

/**
 * Dua garis pemisah yang membingkai area input.
 *
 * Keduanya memakai JUMLAH tanda pisah yang sama supaya terlihat identik —
 * yang berbeda hanya kolom mulainya, memberi kesan undakan.
 * Versi sebelumnya memakai lebar penuh untuk garis atas dan lebar dikurangi
 * indentasi untuk garis bawah, sehingga keduanya tampak tidak sama.
 *
 * @returns {{top:string, bottom:string, dashes:number}}
 */
export function frameRules() {
  // Sisakan ruang untuk undakan DAN satu kolom cadangan: garis yang panjangnya
  // persis selebar terminal memicu "pending wrap" di Windows — newline
  // berikutnya pindah dua baris sehingga clack menghitung tinggi frame keliru
  // dan menggambar ulang seluruh kotak tiap ketikan (efek berkedip).
  const dashes = Math.max(10, terminalWidth() - STAIR_STEP - 1);
  return {
    dashes,
    top: chalk.gray('─'.repeat(dashes)),
    bottom: chalk.gray(`${' '.repeat(STAIR_STEP)}${'─'.repeat(dashes)}`),
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
    const parts = [chalk.cyan('~')];
    if (withAccess) parts.push(bar, chalk.whiteBright('Full access'));
    if (withPrefix && prefix) parts.push(bar, chalk.cyan(prefix));
    parts.push(bar, chalk.magenta('✦'), chalk.hex('#F59E0B')(model));
    if (withProvider) parts.push(chalk.gray('·'), chalk.cyan(provider));
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
        chalk.cyan('~'),
        bar,
        chalk.magenta('✦'),
        chalk.hex('#F59E0B')(shortModel),
        bar,
        formatContextIndicator(usage, { detail: false }),
      ].join(' ');
    if (visibleWidth(line) <= budget) return line;
  }
  return indent + chalk.cyan('~') + ' ' + formatContextIndicator(usage, { detail: false });
}
