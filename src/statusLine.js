import { getConfig, getPermissionMode } from './config.js';
import { theme } from './theme.js';
import { permissionModeLabel, permissionModeColor } from './chat/permissionMode.js';
import { conversationSession } from './chat/conversation.js';
import { getContextUsage, formatContextIndicator } from './chat/context.js';
import { PUNAKAWAN_ROLES, formatPunakawanLabel } from './agents/punakawan.js';

/**
 * Baris status di bawah area input:
 *
 *   ~ │ 👑 semAIr │ Safe │ ✦ <model> · <provider> │ Konteks ▓▓▓▓▓▓▓▓░░ 82%
 *
 * Label mode izin tunggal (safe/auto/plan/yolo) dengan warna pastel Google —
 * menggantikan dua label lama (Build/Plan + Safe/Full access) yang membingungkan.
 *
 * Dipakai dua tempat — banner saat start dan area input langsung — karena
 * keduanya harus menampilkan angka yang sama, dan menyalin logikanya di dua
 * berkas hanya membuka celah agar keduanya cepat berbeda.
 */

/**
 * Penyampai jawaban terakhir (rotasi Punakawan). Ditampilkan sebagai chip agar
 * pengguna melihat keempat anggota bergantian menyampaikan jawaban; pada
 * terminal sempit chip ini yang pertama dikorbankan.
 */
let activePresenter = null;

/**
 * @param {string|null} key Kunci karakter ('bAIwor' | 'semAIr' | 'pAItruk' | 'gAIreng')
 */
export function setActivePresenter(key) {
  activePresenter = PUNAKAWAN_ROLES[key] ? key : null;
}

export function getActivePresenter() {
  return activePresenter;
}

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
  top: theme.muted('─'.repeat(span)),
  bottom: theme.muted('─'.repeat(span)),
  };
}

/**
 * Garis pemisah horizontal selebar terminal.
 * @param {{indent?:string}} [options]
 * @returns {string}
 */
export function statusRule({ indent = '' } = {}) {
  return theme.muted(`${indent}${'─'.repeat(Math.max(10, terminalWidth() - indent.length))}`);
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

  const bar = theme.muted('│');

  const build = ({ detail, withProvider, withPermission = true, withPrefix, withPresenter = false }) => {
    const parts = [theme.info('~')];
    // Chip penyampai jawaban terakhir (rotasi Punakawan) — dikorbankan pertama
    // saat terminal sempit karena murni informasi identitas.
    if (withPresenter && activePresenter) {
      parts.push(bar, theme.warning(formatPunakawanLabel(activePresenter)));
    }
    // Mode izin tunggal selalu tampil (kecuali di bentuk paling ringkas):
    // pengguna harus langsung tahu kalau sedang di Plan (read-only) atau
    // YOLO (tanpa bertanya). Warna pastel: biru/hijau/kuning/merah.
    if (withPermission) {
      const mode = getPermissionMode();
      parts.push(bar, permissionModeColor(mode)(permissionModeLabel(mode)));
    }
    if (withPrefix && prefix) parts.push(bar, theme.info(prefix));
    parts.push(bar, theme.accent('✦'), theme.primary(model));
    if (withProvider) parts.push(theme.muted('·'), theme.info(provider));
    parts.push(bar, formatContextIndicator(usage, { detail }));
    return indent + parts.join(' ');
  };

  const budget = Math.max(20, (maxWidth ?? terminalWidth()) - indent.length);

  const levels = [
    { detail: true, withProvider: true, withPermission: true, withPrefix: true, withPresenter: true },
    { detail: true, withProvider: true, withPermission: true, withPrefix: true },
    { detail: false, withProvider: true, withPermission: true, withPrefix: true },
    { detail: false, withProvider: false, withPermission: true, withPrefix: true },
    { detail: false, withProvider: false, withPermission: true, withPrefix: false },
    { detail: false, withProvider: false, withPermission: false, withPrefix: false },
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
