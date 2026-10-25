import chalk from 'chalk';
import { palette } from '../theme.js';
import { PUNAKAWAN_ROLES, TOOL_ACTORS, PRESENTER_INFO, formatPunakawanLabel } from '../agents/punakawan.js';

/**
 * Rotasi penyampai jawaban Tim Punakawan.
 *
 * Jawaban akhir tidak selalu disampaikan bAIwor: siapa yang "bicara" ditentukan
 * oleh JENIS PEKERJAAN giliran itu, lalu bertukar secara alami saat pengguna
 * berganti jenis pekerjaan (eksplorasi → implementasi → verifikasi → ...).
 * Untuk giliran obrolan murni tanpa tool, keempatnya bergiliran round-robin
 * sehingga semua anggota tetap terlihat hadir di sesi tanya-jawab biasa.
 *
 * Rotasi hanya di lapisan presentasi (badge, status line, banner): system
 * prompt dan perilaku kerja agen tidak berubah — model tidak diminta
 * "berperan" menjadi karakter lain.
 */

/**
 * Prioritas penyampai saat giliran memakai tool. Perubahan berkas paling
 * menentukan "kepemilikan" giliran, lalu verifikasi, lalu perencanaan;
 * eksplorasi/penelusuran adalah kerja latar yang paling sering menemani
 * jenis pekerjaan lain, jadi diletakkan paling akhir.
 */
const TOOL_PRIORITY = ['bAIwor', 'gAIreng', 'semAIr', 'pAItruk'];

/**
 * Urutan round-robin giliran obrolan tanpa tool. semAIr duluan: jawaban
 * pertama sebuah sesi lazimnya berupa saran/analisis — wilayah sang Pamomong.
 */
const CHAT_ROTATION = ['semAIr', 'pAItruk', 'bAIwor', 'gAIreng'];

let chatRotationIndex = 0;

/** Penyampai giliran sebelumnya — dipakai baris serah terima antar giliran. */
let lastPresenter = null;

/** Statistik penyampai sepanjang sesi (untuk /status). */
const presenterStats = { semAIr: 0, pAItruk: 0, bAIwor: 0, gAIreng: 0 };

/**
 * Teks spinner per fase kerja mengikuti tool terakhir yang dipakai pada
 * giliran berjalan — fase berpindah alami (rancang → telusur → bangun → uji)
 * sehingga keempat anggota terlihat bergantian selama satu tugas besar.
 */
const PHASE_SPINNER = {
  semAIr: '👑 semAIr merapikan rencana...',
  pAItruk: '🔭 pAItruk menelusuri & memetakan...',
  bAIwor: '🔨 bAIwor membangun & menata kode...',
  gAIreng: '⚖️ gAIreng menguji & memverifikasi...',
};

/**
 * Label fase spinner untuk model turn berikutnya, berdasarkan seluruh tool
 * yang sudah dipakai pada giliran ini (fase mengikuti tool terakhir).
 * Giliran pertama (belum ada tool) = fase perancangan semAIr.
 *
 * @param {string[]} toolNames
 * @returns {string}
 */
export function getWorkPhaseLabel(toolNames = []) {
  for (let i = toolNames.length - 1; i >= 0; i--) {
    const actor = TOOL_ACTORS[toolNames[i]];
    if (actor && PHASE_SPINNER[actor]) return PHASE_SPINNER[actor];
  }
  return '👑 semAIr merancang strategi...';
}

/**
 * Menghitung penyampai jawaban untuk satu giliran pengguna.
 *
 * @param {Object} [options]
 * @param {string[]} [options.toolNames] Nama seluruh tool yang dipanggil pada
 *   giliran ini (termasuk yang gagal/diblokir — niatnya tetap membentuk giliran).
 * @returns {string|null} Kunci karakter ('bAIwor' | 'semAIr' | 'pAItruk' |
 *   'gAIreng'), atau null bila tidak bisa ditentukan.
 */
export function selectPresenter({ toolNames = [] } = {}) {
  const actors = new Set();
  for (const name of toolNames) {
    const actor = TOOL_ACTORS[name];
    if (actor) actors.add(actor);
  }

  let presenter = null;
  if (actors.size > 0) {
    for (const candidate of TOOL_PRIORITY) {
      if (actors.has(candidate)) {
        presenter = candidate;
        break;
      }
    }
  } else {
    // Giliran obrolan murni: round-robin keempat anggota.
    presenter = CHAT_ROTATION[chatRotationIndex % CHAT_ROTATION.length];
    chatRotationIndex++;
  }

  if (presenter) {
    presenterStats[presenter] = (presenterStats[presenter] || 0) + 1;
    lastPresenter = presenter;
  }
  return presenter;
}

/**
 * Penyampai giliran sebelumnya (null bila ini giliran pertama sesi).
 * @returns {string|null}
 */
export function getLastPresenter() {
  return lastPresenter;
}

/**
 * Baris serah terima antar giliran: "🔄 giliran 🔭 pAItruk → 🔨 bAIwor".
 *
 * @param {string} from Kunci karakter penyampai sebelumnya
 * @param {string} to Kunci karakter penyampai sekarang
 * @param {{useColor?: boolean}} [options]
 * @returns {string} String kosong bila salah satu peran tidak dikenal.
 */
export function formatHandoffLine(from, to, { useColor = true } = {}) {
  if (!PUNAKAWAN_ROLES[from] || !PUNAKAWAN_ROLES[to]) return '';
  const fromLabel = formatPunakawanLabel(from);
  const toLabel = formatPunakawanLabel(to);
  if (!useColor) return `  🔄 giliran ${fromLabel} → ${toLabel}`;
  const gold = chalk.hex(palette.gold).bold;
  return `  ${chalk.gray('🔄 giliran')} ${gold(fromLabel)} ${chalk.gray('→')} ${gold(toLabel)}`;
}

/**
 * Statistik penyampai sepanjang sesi (salinan aman untuk ditampilkan).
 * @returns {Record<string, number>}
 */
export function getPresenterStats() {
  return { ...presenterStats };
}

/**
 * Statistik rotasi dalam satu baris untuk /status:
 * "👑 semAIr 2 · 🔭 pAItruk 3 · 🔨 bAIwor 5 · ⚖️ gAIreng 1".
 *
 * @param {{useColor?: boolean}} [options]
 * @returns {string}
 */
export function formatPresenterStats({ useColor = true } = {}) {
  const parts = CHAT_ROTATION.filter((name) => presenterStats[name] > 0).map(
    (name) => `${formatPunakawanLabel(name)} ${presenterStats[name]}`
  );
  if (parts.length === 0) return 'belum ada jawaban pada sesi ini';
  return parts.join(useColor ? ` ${chalk.gray('·')} ` : ' · ');
}

/**
 * Mengembalikan rotasi obrolan murni ke awal (dipakai /clear dan pengujian).
 */
export function resetPresenterRotation() {
  chatRotationIndex = 0;
  lastPresenter = null;
  for (const key of Object.keys(presenterStats)) presenterStats[key] = 0;
}

/**
 * Badge penutup jawaban: satu baris kecus yang menyebut siapa penyampai.
 * Hanya untuk TTY — keluaran yang dialihkan (pipe/redirect) tetap bersih.
 *
 * @param {string} presenterKey
 * @param {{useColor?: boolean}} [options]
 * @returns {string}
 */
export function formatPresenterBadge(presenterKey, { useColor = true } = {}) {
  const role = PUNAKAWAN_ROLES[presenterKey];
  const info = PRESENTER_INFO[presenterKey];
  if (!role || !info) return '';
  const label = `${role.emoji} ${role.name} · ${info.tagline}`;
  if (!useColor) return `  ── ${label} ──`;
  const gold = chalk.hex(palette.gold).bold;
  return `  ${chalk.gray('──')} ${gold(`${role.emoji} ${role.name}`)} ${chalk.gray('·')} ${chalk.dim(info.tagline)} ${chalk.gray('──')}`;
}

/**
 * Menentukan anggota Punakawan yang "piket" pada sebuah tanggal (rotasi harian,
 * deterministik). Keempat anggota terlihat bergantian hari demi hari tanpa
 * perlu menyimpan state.
 *
 * @param {Date} [date]
 * @returns {{name:string, emoji:string, greeting:string}}
 */
export function pickDailyGreeter(date = new Date()) {
  const dayNumber = Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000
  );
  const name = CHAT_ROTATION[((dayNumber % CHAT_ROTATION.length) + CHAT_ROTATION.length) % CHAT_ROTATION.length];
  const role = PUNAKAWAN_ROLES[name];
  const info = PRESENTER_INFO[name];
  return { name, emoji: role.emoji, greeting: info.greeting };
}

export { PRESENTER_INFO };
