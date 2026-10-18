#!/usr/bin/env node

// WAJIB paling awal: menyetel level warna chalk sebelum modul lain (mis. logo
// Bawor) menghitung string berwarnanya saat import. Lihat src/colors.js.
import '../src/colors.js';

import { Command } from 'commander';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
  getConfig,
  CONFIG_FILE,
  maskSecret,
  getTimelineMode,
  setTimelineMode,
  getTinyFishApiKey,
  saveTinyFishApiKey,
} from '../src/config.js';
import { handleWebFetch, handleWebSearch } from '../src/tools/webTool.js';
import { initAllMcpServers, listActiveMcpSessions, startMcpServer } from '../src/mcp/index.js';
import { runModelMenu } from '../src/modelMenu.js';
import { handleModelCommand } from '../src/modelAlias.js';
import { askBaiworInput, COMMANDS } from '../src/prompt.js';
import { login, logout, authStatus } from '../src/auth/index.js';
import { BAWOR_LOGO } from '../src/assets/baworLogo.js';
import { handleUserChat, resetConversation, conversationSession } from '../src/chat/index.js';
import { buildPlanUserPrompt } from '../src/chat/planMode.js';
import { compactConversation } from '../src/chat/compact.js';
import { listSessions, deleteSession, deleteAllSessions } from '../src/chat/sessionManager.js';
import { discoverSkills, getSkill } from '../src/skills/skillManager.js';
import { discoverRules } from '../src/rules/ruleManager.js';
import { resetTodoStore } from '../src/tools/todoTool.js';
import { renderStatusLine } from '../src/statusLine.js';
import { resolveActiveCredentials } from '../src/auth/resolve.js';
import { applyHelpStyle, helpHeader, helpFooter } from '../src/cliHelp.js';
import { APP_NAME, VERSION, WEBSITE, BONUS_WEBSITE, TAGLINE, COMPANY } from '../src/branding.js';

// Cegah sistem operasi langsung mematikan proses saat Ctrl+C sekali di terminal,
// namun eskalasikan ke keluar paksa bila ditekan 2 kali dalam 1 detik.
let lastGlobalSigint = 0;
process.on('SIGINT', () => {
  const now = Date.now();
  if (now - lastGlobalSigint < 1000) {
    process.stdout.write(chalk.red('\n\n  Keluar paksa (SIGINT ganda).\n\n'));
    process.exit(130);
  }
  lastGlobalSigint = now;
});

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/** Lebar kolom satu karakter (karakter lebar seperti CJK/emoji dihitung 2). */
function charWidth(ch) {
  const code = ch.codePointAt(0);
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3040 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
  ) {
    return 2;
  }
  return 1;
}

function visualWidth(str) {
  let w = 0;
  for (const ch of stripAnsi(str)) {
    w += charWidth(ch);
  }
  return w;
}

/**
 * Potong string ber-ANSI tanpa merusak kode escape.
 * Pemotongan buta per karakter bisa mengiris di tengah `\x1b[...m` sehingga
 * sisa kode warna bocor ke teks berikutnya.
 */
function truncateAnsi(str, maxWidth) {
  let out = '';
  let w = 0;
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*[a-zA-Z]/.exec(str.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    const ch = String.fromCodePoint(str.codePointAt(i));
    const cw = charWidth(ch);
    if (w + cw > maxWidth) break;
    out += ch;
    w += cw;
    i += ch.length;
  }
  return out;
}

const targetWidth = 71;

function padBox(content) {
  let clean = content;
  if (visualWidth(clean) > targetWidth) {
    // Potong pada batas karakter, lalu reset atribut agar '…' dan isi kotak
    // tidak mewarisi warna dari potongan terakhir.
    clean = truncateAnsi(clean, targetWidth - 1) + '\x1b[0m…';
  }
  const w = visualWidth(clean);
  const pad = Math.max(0, targetWidth - w);
  return '  ' + chalk.gray('│ ') + clean + ' '.repeat(pad) + chalk.gray(' │');
}

const BAWOR_TEXT_LOGO = [
  '  ██████╗  █████╗ ██╗██╗    ██╗ ██████╗ ██████╗     ██████╗ ███████╗ ██████╗ ███████╗',
  '  ██╔══██╗██╔══██╗██║██║    ██║██╔═══██╗██╔══██╗    ██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '  ██████╔╝███████║██║██║ █╗ ██║██║   ██║██████╔╝    ██║     ██║   ██║██║  ██║█████╗  ',
  '  ██╔══██╗██╔══██║██║██║███╗██║██║   ██║██╔══██╗    ██║     ██║   ██║██║  ██║██╔══╝  ',
  '  ██████╔╝██║  ██║██║╚███╔███╔╝╚██████╔╝██║  ██║    ╚██████╗╚██████╔╝██████╔╝███████╗',
  '  ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
];

/** Batas merah→putih: separuh tinggi logo (baris 0-2 merah, 3-5 putih). */
const FLAG_SPLIT_ROW = BAWOR_TEXT_LOGO.length / 2;

/**
 * Logo teks bAIwor Code:
 * - "b" : Putih terang (kolom 0 s/d 9)
 * - "AI" : Merah terang (kolom 10 s/d 20)
 * - "wor" : Putih terang (kolom 21 s/d 51, termasuk spasi pemisah)
 * - "Code" : Bendera Merah Putih — MERAH di ATAS, PUTIH di BAWAH, dengan
 *            perbatasan persis di palang tengah huruf E (garis ganda "="):
 *            - Baris 0, 1, 2 : MERAH (atap, celah atas, palang tengah E atas █████╗)
 *            - Baris 3, 4, 5 : PUTIH (bawah palang tengah E ██╔══╝, palang bawah, alas)
 *
 * Warna bendera sengaja memakai `redBright`/`whiteBright` yang sama dengan
 * bagian lain banner ("AI" merah, "b"/"wor" putih) supaya kedua merah dan
 * kedua putih di logo identik di mata pengguna. Nilai resmi bendera RI
 * (PP No. 40/1958) sendiri adalah #FF0000 dan #FFFFFF.
 */
function colorizeTextLogoLine(line, rowIndex) {
  const bPart = chalk.whiteBright.bold(line.slice(0, 10));
  const aiPart = chalk.redBright.bold(line.slice(10, 21));
  const worPart = chalk.whiteBright.bold(line.slice(21, 52));

  const codeSlice = line.slice(52);
  const codePart = rowIndex < FLAG_SPLIT_ROW
    ? chalk.redBright.bold(codeSlice)
    : chalk.whiteBright.bold(codeSlice);

  return bPart + aiPart + worPart + codePart;
}

const LOGO_INDENT = '  ';
const LOGO_GAP = ' ';
const TEXT_LOGO_WIDTH = Math.max(...BAWOR_TEXT_LOGO.map((l) => l.length));
/** Spasi kiri tiap baris logo teks (semua baris memakai indent yang sama). */
const TEXT_LOGO_LEFT_PAD = BAWOR_TEXT_LOGO[0].length - BAWOR_TEXT_LOGO[0].trimStart().length;
/** Lebar "tinta" logo teks tanpa spasi tepi — dasar perataan tagline di bawahnya. */
const TEXT_LOGO_INK_WIDTH =
  Math.max(...BAWOR_TEXT_LOGO.map((l) => l.trimEnd().length)) - TEXT_LOGO_LEFT_PAD;

/**
 * Rencana layout header: apakah logo tampil berdampingan dengan topeng,
 * bertumpuk, atau teks saja — sekaligus kolom awal dan lebar "tinta" tulisan
 * bAIwor Code. Dipisah dari pencetakannya supaya elemen lain yang harus
 * dirata-tengah terhadap tulisan itu (nama company di atas, tagline di bawah)
 * memakai perhitungan yang sama persis, bukan menebak sendiri.
 *
 * @returns {{ mode: 'berdampingan'|'bertumpuk'|'teks', textIndent: number, textWidth: number }}
 */
function resolveLogoLayout() {
  const columns = process.stdout.columns || 80;
  const slotOffset = LOGO_INDENT.length + BAWOR_LOGO.cols + LOGO_GAP.length;
  const mode =
    columns >= slotOffset + TEXT_LOGO_WIDTH
      ? 'berdampingan'
      : columns >= BAWOR_LOGO.cols + LOGO_INDENT.length
        ? 'bertumpuk'
        : 'teks';

  return {
    mode,
    // Kolom awal lajur kanan (tempat logo teks & judul di atasnya) pada layout
    // berdampingan; 0 bila logo dicetak sendirian.
    slotOffset: mode === 'berdampingan' ? slotOffset : 0,
    textIndent: (mode === 'berdampingan' ? slotOffset : 0) + TEXT_LOGO_LEFT_PAD,
    textWidth: TEXT_LOGO_INK_WIDTH,
  };
}

/** Padding kiri agar `text` rata tengah terhadap tulisan bAIwor Code. */
function centerPadInTextLogo(layout, text) {
  return layout.textIndent + Math.max(0, Math.floor((layout.textWidth - visualWidth(text)) / 2));
}

/**
 * Header pembuka: muka Bawor (kiri) berdampingan dengan logo teks bAIwor (kanan).
 * Menyesuaikan lebar terminal: berdampingan -> bertumpuk -> logo teks saja.
 *
 * @param {{ mode: string, slotOffset: number }} [layout] Rencana dari
 *   resolveLogoLayout(); dihitung sendiri bila tidak diberikan.
 * @param {Object} [options]
 * @param {string} [options.heading=''] Judul kecil di atas tulisan bAIwor Code
 *   (mis. nama company). Pada layout berdampingan ia mengisi lajur kosong di
 *   kanan antena topeng sehingga jatuh tepat satu baris di atas logo teks.
 * @param {number} [options.headingPad=0] Kolom awal judul (dihitung dari
 *   centerPadInTextLogo) supaya rata tengah dengan tulisan bAIwor Code.
 */
function printLogoHeader(layout = resolveLogoLayout(), options = {}) {
  const { heading = '', headingPad = 0 } = options;
  const artLines =
    (chalk.level > 0 && BAWOR_LOGO.color)
      ? BAWOR_LOGO.color
      : (BAWOR_LOGO.mono || BAWOR_LOGO.lines || []);
  const textLines = BAWOR_TEXT_LOGO.map((line, idx) => colorizeTextLogoLine(line, idx));
  // Pad di dalam lajur kanan: kolom absolut dikurangi kolom awal lajur.
  const headingInSlot = ' '.repeat(Math.max(0, headingPad - layout.slotOffset)) + heading;

  // 1. Terminal cukup lebar: logo berdampingan
  if (layout.mode === 'berdampingan') {
    const artH = artLines.length;
    const textH = textLines.length;
    // Selisih tinggi ganjil (topeng 7 baris vs teks 6 baris) dibagi ke bawah
    // supaya teks sejajar dengan *kepala* topeng (baris 1-6), bukan dengan
    // antenanya di baris 0 — hasilnya teks tampak tegak lurus di tengah.
    const padTop = Math.max(0, Math.round((artH - textH) / 2));
    const padBot = Math.max(0, artH - textH - padTop);

    const right = [
      ...Array(padTop).fill(''),
      ...textLines,
      ...Array(padBot).fill(''),
    ];

    if (heading) {
      // Baris kosong terakhir di atas logo teks (= baris antena topeng) dipakai
      // untuk judul, jadi nama company duduk pas satu baris di atas "bAIwor Code".
      if (padTop > 0) {
        right[padTop - 1] = headingInSlot;
      } else {
        console.log(' '.repeat(headingPad) + heading);
      }
    }

    for (let i = 0; i < artH; i++) {
      console.log(LOGO_INDENT + artLines[i] + LOGO_GAP + (right[i] || ''));
    }
    return;
  }

  // 2. Muat untuk logo saja: tampilkan bertumpuk (muka di atas, teks di bawah)
  if (layout.mode === 'bertumpuk') {
    for (const line of artLines) {
      console.log(LOGO_INDENT + line);
    }
    console.log();
    // Judul duduk tepat di atas tulisan bAIwor Code — konsisten dengan layout
    // berdampingan, di mana ia sebaris dengan antena topeng.
    if (heading) console.log(' '.repeat(headingPad) + heading);
    for (const line of textLines) {
      console.log(line);
    }
    return;
  }

  // 3. Terlalu sempit: logo teks saja
  if (heading) console.log(' '.repeat(headingPad) + heading);
  for (const line of textLines) {
    console.log(line);
  }
}

function showBanner() {
  const config = getConfig();

  const layout = resolveLogoLayout();

  console.log();
  // Nama badan hukum tepat di atas tulisan bAIwor Code (pada layout
  // berdampingan ia mengisi lajur kanan antena topeng), rata tengah — sepasang
  // simetris dengan tagline di bawahnya.
  printLogoHeader(layout, {
    heading: chalk.gray(COMPANY),
    headingPad: centerPadInTextLogo(layout, COMPANY),
  });

  // Tagline diletakkan tepat di bawah tulisan "bAIwor Code" dan dirata-tengah
  // terhadap lebar tulisan itu (bukan lebar terminal), jadi tetap rapi baik di
  // layout berdampingan (muka + teks) maupun bertumpuk.
  const tagline = `🎭 "${TAGLINE}"`;
  console.log(' '.repeat(centerPadInTextLogo(layout, tagline)) + chalk.gray(tagline));
  console.log();

  const readyText = '● Ready';
  const readyBadge = chalk.green(readyText);
  // Lebar dalam kotak atas disamakan dengan garis tengah (targetWidth + 2) agar
  // ketiga batang sejajar walau panjang nomor versi berubah.
  const verLabel = `─ v${VERSION} `;
  const topPad = Math.max(4, targetWidth + 2 - verLabel.length - readyText.length - 3);
  const topBar = '  ' + chalk.gray(`╭${verLabel}${'─'.repeat(topPad)} `) + readyBadge + chalk.gray(' ─╮');
  const midBar = '  ' + chalk.gray('├' + '─'.repeat(targetWidth + 2) + '┤');
  const botBar = '  ' + chalk.gray('╰' + '─'.repeat(targetWidth + 2) + '╯');

  console.log(topBar);
  console.log(padBox(chalk.whiteBright('Tips for getting started')));
  console.log(padBox(chalk.gray('› ') + 'Gunakan ' + chalk.cyan('/help') + ' untuk melihat semua perintah yang tersedia.'));
  console.log(padBox(chalk.gray('› ') + 'Gunakan ' + chalk.cyan('/clear') + ' untuk menyegarkan layar kerja kapan saja.'));
  console.log(padBox(chalk.gray('› ') + 'Kunjungi ' + chalk.cyan(WEBSITE) + ' untuk dokumentasi & update resmi.'));
  console.log(midBar);
  console.log(padBox(chalk.whiteBright('Workspace & Status')));
  console.log(padBox(chalk.gray('› ') + 'Folder Aktif : ' + chalk.cyan(process.cwd())));
  const modelInfo = config.activeModel !== 'Not configured'
    ? chalk.hex('#F59E0B')(config.activeModel) + chalk.gray(` (${config.activeProvider})`)
    : chalk.gray('Belum dikonfigurasi (/model)');
  console.log(padBox(chalk.gray('› ') + 'Model Aktif  : ' + modelInfo));
  console.log(botBar);
  console.log();

  // Baris status tidak digambar di sini saat terminal sungguhan — `SlashTextPrompt`
  // merender dirinya sendiri, jadi memakainya lagi akan menumpuk dua baris identik.
  // Pada mode pipe/redirect justru perlu dicetak supaya keluaran berkas masih
  // mencatat model, provider, dan sisa konteks.
  if (!process.stdout.isTTY) {
    console.log(renderStatusLine());
  } else {
    console.log(chalk.gray('   Start · @ file · / commands'));
  }
  console.log();
}

// Label pemakaian yang butuh argumen (nama di COMMANDS sengaja tanpa argumen)
const HELP_USAGE = {
  '/login': '/login [provider]',
  '/logout': '/logout [provider]',
};

function showHelp() {
  const gold = chalk.hex('#FBBF24');
  const green = chalk.hex('#10B981');
  const dim = chalk.hex('#6B7280');

  // Diturunkan dari COMMANDS supaya daftar bantuan tidak pernah basi
  // ketika perintah baru ditambahkan, dan kolomnya selalu rata.
  const rows = COMMANDS.map((c) => [HELP_USAGE[c.name] || c.name, c.desc]);
  const width = Math.max(...rows.map(([usage]) => usage.length));

  console.log();
  console.log(gold.bold('  📖 Panduan Perintah:'));
  for (const [usage, desc] of rows) {
    console.log(`    ${green(usage.padEnd(width))}  ${dim('─')}  ${desc}`);
  }
  console.log();
  console.log(gold.bold('  🚀 Mulai dari sini (Contoh untuk Pemula):'));
  console.log(`    ${chalk.cyan('baiworcode "jelaskan struktur proyek ini"')}`);
  console.log(`    ${chalk.cyan('baiworcode plan "rancang fitur baru"')}`);
  console.log(`    ${chalk.cyan('baiworcode "perbaiki error di src/index.js"')}`);
  console.log(`    ${chalk.cyan('baiworcode -c')}  ${dim('atau')}  ${chalk.cyan('baiworcode --resume')}  ${dim('─ lanjutkan sesi terakhir')}`);
  console.log();
  console.log(gold.bold('  🧭 Cara Membaca Aktivitas Tim Punakawan:'));
  console.log(`    ${dim('├──')} ✓ ${chalk.cyan.bold('pAItruk')} · read_file ${dim('· 0.1s · 42 baris')}`);
  console.log(`    ${dim('├──')} ✓ ${chalk.hex('#7fd88f').bold('bAIwor')} · edit_file ${dim('· 50ms · 12 baris')}`);
  console.log(`    ${dim('├──')} ✗ ${chalk.hex('#e06c75').bold('gAIreng')} · run_command ${dim('· 1.2s · gagal')}`);
  console.log(`    ${dim('└──')} ✓ ${chalk.hex('#9d7cd8').bold('semAIr')} · todo_list ${dim('· 2ms · 3/5 selesai')}`);
  console.log(`    ${dim('        ✓ Baca struktur proyek')}`);
  console.log(`    ${dim('        ○ Tambah unit test')}`);
  console.log(`    ${dim('Setiap tool dijalankan oleh karakter Punakawan yang sesuai dan dicatat durasinya.')}`);
  console.log(`    ${dim('Daftar tugas dari todo_list (semAIr) tampil sebagai checklist di bawah node-nya.')}`);
  console.log(`    ${dim('Ingin lebih ringkas? Ketik')} ${chalk.cyan('/timeline compact')} ${dim('— satu baris per langkah.')}`);
  console.log(`    ${dim('Kembali ke tampilan penuh kapan saja dengan')} ${chalk.cyan('/timeline detail')}${dim('.')}`);
  console.log(`    ${dim('Baris "Context X% left" muncul setelah setiap jawaban. Angka itu perkiraan,')}`);
  console.log(`    ${dim('dan riwayat dipangkas otomatis bila mulai penuh — pakai /compact atau /clear.')}`);
  console.log();
  console.log(chalk.gray('  💡 Ketik langsung pertanyaan atau instruksi coding apa saja untuk chat dengan bAIwor!'));
  console.log();
  console.log(chalk.gray('  🌐 Website official  : ') + chalk.cyan(WEBSITE));
  console.log(chalk.gray('  🎁 Bonus token/credit: ') + chalk.cyan(BONUS_WEBSITE) + chalk.dim(' (kode kupon "baiworcode")\n'));
}

/**
 * Mengukur round-trip latency ke endpoint provider yang sedang aktif secara tahan-gagal.
 */
async function checkActiveProviderLatency() {
  try {
    const creds = await resolveActiveCredentials();
    if (creds.type === 'agy') {
      return 'local CLI (agy)';
    }
    const startTime = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let testUrl = (creds.baseUrl || '').trim().replace(/\/+$/, '');
    if (!testUrl.endsWith('/models') && !testUrl.endsWith('/chat/completions')) {
      testUrl = `${testUrl}/models`;
    }

    try {
      await fetch(testUrl, {
        method: 'GET',
        headers: creds.headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const elapsed = Math.round(performance.now() - startTime);
      return `${elapsed} ms`;
    } catch {
      clearTimeout(timeout);
      return 'tidak tersedia';
    }
  } catch {
    return 'tidak tersedia';
  }
}

async function printStatus() {
  const config = getConfig();
  const oauthList = authStatus();

  const latency = await checkActiveProviderLatency();
  const latencyBadge = latency.endsWith('ms') ? chalk.green(latency) : chalk.gray(latency);

  console.log();
  console.log(chalk.hex('#FBBF24').bold('  📊 Status Sistem & Konfigurasi bAIwor Code:'));
  console.log(`    ${chalk.dim('Lokasi Config :')} ${chalk.cyan(CONFIG_FILE)}`);
  console.log(`    ${chalk.dim('Provider Aktif:')} ${chalk.green.bold(config.activeProvider)} ${chalk.dim(`(${config.activeType})`)}`);
  console.log(`    ${chalk.dim('Model Aktif   :')} ${chalk.hex('#F59E0B').bold(config.activeModel)}`);
  console.log(`    ${chalk.dim('Latency       :')} ${latencyBadge}`);
  console.log(`    ${chalk.dim('Website       :')} ${chalk.cyan(WEBSITE)}`);

  // Diagnostik warna: membantu melacak keluaran yang tampil polos di terminal
  // yang semestinya berwarna (level 0, atau NO_COLOR aktif).
  const colorState = !process.stdout.isTTY
    ? 'nonaktif (keluaran bukan TTY)'
    : chalk.level >= 3
      ? 'aktif — truecolor'
      : chalk.level === 2
        ? 'aktif — 256 warna'
        : chalk.level === 1
          ? 'aktif — 16 warna'
          : process.env.NO_COLOR
            ? 'nonaktif (NO_COLOR diset)'
            : 'nonaktif (tidak terdeteksi)';
  const colorBadge = chalk.level > 0 ? chalk.green(colorState) : chalk.yellow(colorState);
  console.log(`    ${chalk.dim('Warna         :')} ${colorBadge} ${chalk.dim(`(level ${chalk.level})`)}`);
  console.log();

  console.log(chalk.whiteBright.bold('  🔐 Status Sesi OAuth Providers:'));
  for (const item of oauthList) {
    const badge = item.loggedIn ? chalk.green('● Logged In ') : chalk.gray('○ Belum Login');
    const tokenInfo = item.loggedIn ? chalk.gray(`[Token: ${item.maskedToken}] (${item.expiryStatus})`) : '';
    console.log(`    ${badge} ${chalk.bold(item.name.padEnd(16))} ${chalk.dim(`(${item.method})`)} ${tokenInfo}`);
  }

  const customList = config.customProviders || [];
  if (customList.length > 0) {
    console.log();
    console.log(chalk.whiteBright.bold('  🌐 Custom Providers Tersimpan:'));
    for (const cp of customList) {
      const isAct = config.activeType === 'custom' && config.activeProvider === cp.name;
      const marker = isAct ? chalk.green('● ') : chalk.gray('○ ');
      const maskedKey = maskSecret(cp.apiKey);
      console.log(`    ${marker}${chalk.bold(cp.name)} ─ ${chalk.dim(cp.baseUrl)} [Key: ${maskedKey}] ─ Model: ${chalk.cyan(cp.model)}`);
    }
  }

  console.log();
  console.log(chalk.whiteBright.bold('  🐟 TinyFish Web Intelligence:'));
  const tfKey = getTinyFishApiKey();
  if (tfKey) {
    console.log(`    ${chalk.green('●')} Status  : ${chalk.green('Aktif')} [Key: ${maskSecret(tfKey)}]`);
    console.log(`      Layanan : ${chalk.cyan('Search')}, ${chalk.cyan('Fetch (Anti-bot + JS)')}, ${chalk.cyan('Web Automate (Mako/Browser)')}`);
  } else {
    console.log(`    ${chalk.gray('○')} Status  : ${chalk.yellow('Belum dikonfigurasi')} (fallback: DuckDuckGo & native fetch)`);
  }

  console.log();
  console.log(chalk.whiteBright.bold('  🔌 Model Context Protocol (MCP):'));
  const mcpList = listActiveMcpSessions();
  if (mcpList.length > 0) {
    for (const s of mcpList) {
      console.log(`    ${chalk.green('●')} ${chalk.bold(s.name)} ${chalk.dim(`[${s.type}]`)} ─ ${chalk.cyan(`${s.tools.length} tool aktif`)}`);
    }
  } else {
    console.log(`    ${chalk.gray('○')} Belum ada MCP server aktif (gunakan /mcp list atau konfigurasi ~/.baiwor/config.json)`);
  }
  console.log();
}

function showExitMessage() {
  console.log(chalk.hex('#F59E0B')('\n  Matur nuwun! Sampun nganggo bAIwor Code. 🙏'));
  console.log(chalk.gray('  🏢 Company           : ') + chalk.whiteBright(COMPANY));
  console.log(chalk.gray('  🌐 Website official  : ') + chalk.cyan(WEBSITE));
  console.log(
    chalk.gray('  🎁 Bonus token/credit: ') +
      chalk.cyan(BONUS_WEBSITE) +
      chalk.dim(' (kode kupon "baiworcode")\n')
  );
  process.exit(0);
}

function showResumedBanner() {
  const title = conversationSession.sessionTitle || conversationSession.sessionId;
  const turns = conversationSession.getUserTurnCount();
  console.log(chalk.cyan.bold('\n  🔄 Melanjutkan Sesi Percakapan Sebelumnya:'));
  console.log(chalk.white(`     Judul  : `) + chalk.green.bold(title));
  console.log(chalk.gray(`     ID     : ${conversationSession.sessionId} · ${turns} turn interaksi`));

  const msgs = conversationSession.messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant'));
  if (msgs.length > 0) {
    const recent = msgs.slice(-2);
    console.log(chalk.dim('\n     Riwayat Terakhir:'));
    for (const msg of recent) {
      const roleLabel = msg.role === 'user' ? chalk.cyan('› Kamu   ') : chalk.yellow('✦ bAIwor ');
      const cleanContent = typeof msg.content === 'string' ? msg.content.replace(/\s+/g, ' ').trim() : '';
      const snippet = cleanContent.slice(0, 80);
      console.log(`     ${roleLabel}: ${chalk.gray(snippet)}${cleanContent.length > 80 ? '...' : ''}`);
    }
  }
  console.log();
}

async function handleTinyFishCommand(arg = '') {
  const parts = String(arg || '').trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  if (sub === 'key') {
    if (!rest) {
      console.log(chalk.yellow('\n  Penggunaan: /tinyfish key <sk-tinyfish-...>'));
      return;
    }
    saveTinyFishApiKey(rest);
    console.log(chalk.green(`\n  ✅ TinyFish API Key berhasil disimpan: ${maskSecret(rest)}`));
    console.log(chalk.gray('     Fitur Web Search, Fetch (anti-bot & JS), dan Web Automate kini aktif.\n'));
    return;
  }

  if (sub === 'search') {
    if (!rest) {
      console.log(chalk.yellow('\n  Penggunaan: /tinyfish search <kata-kunci>'));
      return;
    }
    console.log(chalk.cyan(`\n  🔍 Mencari via TinyFish: "${rest}"...`));
    const res = await handleWebSearch({ query: rest });
    console.log('\n' + res.output + '\n');
    return;
  }

  if (sub === 'fetch') {
    if (!rest) {
      console.log(chalk.yellow('\n  Penggunaan: /tinyfish fetch <url>'));
      return;
    }
    console.log(chalk.cyan(`\n  🌐 Mengambil halaman via TinyFish: "${rest}"...`));
    const res = await handleWebFetch({ url: rest });
    console.log('\n' + res.output + '\n');
    return;
  }

  const key = getTinyFishApiKey();
  console.log(chalk.whiteBright.bold('\n  🐟 Status TinyFish Web Intelligence:'));
  if (!key) {
    console.log(`    ${chalk.gray('○')} Status   : ${chalk.yellow('Belum dikonfigurasi')}`);
    console.log(chalk.gray('      Gunakan: /tinyfish key <sk-tinyfish-...> untuk mengaktifkan.'));
    console.log(chalk.gray('      Saat ini websearch & webfetch menggunakan DuckDuckGo & native fetch.\n'));
    return;
  }

  console.log(`    ${chalk.green('●')} Status   : ${chalk.green('Aktif')} [Key: ${maskSecret(key)}]`);
  console.log(`    ${chalk.cyan('✦')} Layanan  : Search, Fetch (anti-bot & JS rendering), Web Automate (Mako)`);

  try {
    const res = await globalThis.fetch('https://agent.tinyfish.ai/v1/wallet', {
      headers: { 'X-API-Key': key },
    });
    if (res.ok) {
      const w = await res.json();
      const bal = w.available_balance ? `$${w.available_balance} ${w.currency || 'USD'}` : 'Tersedia';
      console.log(`    ${chalk.hex('#10B981')('💰')} Saldo    : ${chalk.bold.greenBright(bal)}`);
    }
  } catch {}
  console.log(chalk.gray('\n  Sub-perintah:'));
  console.log(chalk.gray('    /tinyfish search <query>  → uji pencarian web'));
  console.log(chalk.gray('    /tinyfish fetch <url>     → uji ekstraksi URL bersih'));
  console.log(chalk.gray('    /tinyfish key <apiKey>    → ganti API key\n'));
}

async function handleMcpCommand(arg = '') {
  const parts = String(arg || '').trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();

  if (sub === 'refresh') {
    console.log(chalk.cyan('\n  🔄 Memuat ulang seluruh koneksi MCP Server...'));
    const results = await initAllMcpServers();
    if (results.length === 0) {
      console.log(chalk.yellow('    Belum ada MCP server yang terdaftar di konfigurasi.\n'));
      return;
    }
    for (const r of results) {
      const badge = r.status === 'connected' ? chalk.green('● Terhubung') : chalk.red('✗ Gagal');
      console.log(`    ${badge} ${chalk.bold(r.name)}: ${r.toolCount} tool ${r.error ? chalk.gray(`(${r.error})`) : ''}`);
    }
    console.log();
    return;
  }

  // Default: /mcp list
  const active = listActiveMcpSessions();
  console.log(chalk.hex('#FBBF24').bold('\n  🔌 Model Context Protocol (MCP) Servers:'));
  if (active.length === 0) {
    console.log(chalk.yellow('    Belum ada MCP server yang terhubung.'));
    console.log(chalk.gray('    Konfigurasikan di: ~/.baiwor/config.json (key "mcpServers") atau .baiwor/mcp.json'));
    console.log(chalk.gray('    Gunakan /mcp refresh untuk memindai ulang server yang baru ditambahkan.\n'));
    return;
  }

  for (const s of active) {
    console.log(`    ${chalk.green('●')} ${chalk.white.bold(s.name)} ${chalk.dim(`[${s.type}]`)} ─ ${chalk.cyan(`${s.tools.length} tool aktif`)}`);
    for (const t of s.tools) {
      console.log(`       - ${chalk.yellow(t.name)}: ${chalk.dim(t.description || '')}`);
    }
  }
  console.log(chalk.gray('\n  Gunakan /mcp refresh untuk memuat ulang koneksi server.\n'));
}

async function startInteractive(opts = {}) {
  // Cegah sistem operasi langsung mematikan proses saat Ctrl+C ditekan di terminal
  process.on('SIGINT', () => {});

  // Hubungkan server MCP di latar belakang
  try {
    await initAllMcpServers();
  } catch {}

  if (!opts.skipBanner) {
    showBanner();
  }

  while (true) {
    const config = getConfig();
    const input = await askBaiworInput({
      placeholder: 'Ask bAIwor Code to do anything...',
    });

    if (p.isCancel(input) || input === null) {
      showExitMessage();
    }

    let command = input.trim();

    // Jika user hanya mengetik '/' atau '/menu' atau '/commands', tampilkan pilihan interaktif
    if (command === '/' || command === '/menu' || command === '/commands') {
      const picked = await p.select({
        message: 'Pilih perintah:',
        options: [
          ...COMMANDS.map((c) => ({
            value: c.name,
            label: `${chalk.green(c.name.padEnd(12))} ─ ${chalk.dim(c.desc)}`,
          })),
          { value: '__cancel__', label: chalk.gray('← Batal') },
        ],
      });

      if (p.isCancel(picked) || picked === '__cancel__') {
        continue;
      }
      command = picked;
    } else if (command.startsWith('/')) {
      // Auto-resolve unambiguous prefix seperti /m -> /model
      const query = command.toLowerCase();
      const matches = COMMANDS.filter((c) => c.name.startsWith(query));
      if (matches.length === 1) {
        command = matches[0].name;
      }
    }

    const parts = command.split(/\s+/);
    const mainCmd = parts[0];
    const arg = parts.slice(1).join(' ').trim();

    switch (mainCmd) {
      case '/help':
        showHelp();
        break;
      case '/plan': {
        let planPrompt = arg;
        if (!planPrompt) {
          const inputPrompt = await p.text({
            message: 'Mode Perencanaan semAIr — masukkan instruksi atau fitur yang ingin dirancang:',
            placeholder: 'Misal: buatkan sistem autentikasi JWT dan middleware',
          });
          if (p.isCancel(inputPrompt) || !inputPrompt?.trim()) {
            break;
          }
          planPrompt = inputPrompt.trim();
        }
        await handleUserChat(buildPlanUserPrompt(planPrompt));
        try {
          conversationSession.saveToDisk({
            model: config.activeModel,
            provider: config.activeProvider,
          });
        } catch {}
        break;
      }
      case '/compact': {
        const res = await compactConversation(conversationSession);
        if (!res.compacted) {
          console.log(chalk.yellow(`\n  ℹ️  ${res.reason || 'Konteks percakapan belum perlu dirangkum.'}\n`));
        } else {
          console.log(chalk.green.bold('\n  ✨ Konteks percakapan berhasil dirangkum oleh semAIr!'));
          console.log(chalk.gray(`     Token sebelum : ~${res.tokensBefore} token`));
          console.log(chalk.gray(`     Token sesudah : ~${res.tokensAfter} token`));
          console.log(chalk.gray(`     Hemat ruang   : ~${res.savedTokens} token\n`));
          try {
            conversationSession.saveToDisk({
              model: config.activeModel,
              provider: config.activeProvider,
            });
          } catch {}
        }
        break;
      }
      case '/timeline': {
        let mode = (arg || '').trim().toLowerCase();
        const active = getTimelineMode();
        if (!mode) {
          const pickedMode = await p.select({
            message: `Pilih mode tampilan timeline (saat ini: ${chalk.green(active)}):`,
            options: [
              {
                value: 'compact',
                label: `${chalk.green('compact'.padEnd(10))} ─ ${chalk.dim('Satu baris per langkah — alur cepat & ringkas')}`,
              },
              {
                value: 'detail',
                label: `${chalk.cyan('detail'.padEnd(10))} ─ ${chalk.dim('Pohon lengkap dengan argumen & ringkasan hasil')}`,
              },
              { value: '__cancel__', label: chalk.gray('← Batal') },
            ],
          });
          if (p.isCancel(pickedMode) || pickedMode === '__cancel__') {
            break;
          }
          mode = pickedMode;
        }
        const next = setTimelineMode(mode);
        if (next === 'compact') {
          console.log(chalk.green.bold('\n  ✓ Mode timeline: COMPACT'));
          console.log(chalk.gray('    Tiap langkah kini satu baris: ikon · aktor · tool · durasi · baris'));
        } else {
          console.log(chalk.green.bold('\n  ✓ Mode timeline: DETAIL'));
          console.log(chalk.gray('    Tiap langkah kini pohon penuh dengan argumen & ringkasan hasil'));
        }
        console.log();
        break;
      }
      case '/session': {
        const subParts = arg ? arg.split(/\s+/) : [];
        let action = subParts[0];
        if (!action) {
          const pickedAction = await p.select({
            message: 'Pilih aksi sesi percakapan:',
            options: [
              { value: 'list', label: `${chalk.cyan('list'.padEnd(10))} ─ ${chalk.dim('Tampilkan daftar sesi percakapan proyek')}` },
              { value: 'resume', label: `${chalk.green('resume'.padEnd(10))} ─ ${chalk.dim('Lanjutkan sesi percakapan (terakhir atau spesifik)')}` },
              { value: 'delete', label: `${chalk.yellow('delete'.padEnd(10))} ─ ${chalk.dim('Hapus sesi percakapan')}` },
              { value: 'clear', label: `${chalk.red('clear'.padEnd(10))} ─ ${chalk.dim('Bersihkan seluruh riwayat sesi proyek')}` },
              { value: '__cancel__', label: chalk.gray('← Batal') },
            ],
          });
          if (p.isCancel(pickedAction) || pickedAction === '__cancel__') {
            break;
          }
          action = pickedAction;
        }
        if (action === 'list') {
          const list = listSessions();
          if (list.length === 0) {
            console.log(chalk.yellow('\n  Belum ada sesi percakapan tersimpan untuk proyek ini.\n'));
          } else {
            console.log(chalk.cyan.bold(`\n  📁 Sesi Percakapan Proyek (${list.length} sesi):\n`));
            list.slice(0, 15).forEach((s, i) => {
              const dt = s.updatedAt ? new Date(s.updatedAt).toLocaleString('id-ID') : '-';
              console.log(chalk.white(`  ${i + 1}. `) + chalk.green.bold(s.title || s.id));
              console.log(chalk.gray(`     ID: ${s.id} · Terakhir: ${dt} · ${s.stats?.turnCount || 0} turn`));
            });
            console.log(chalk.gray('\n  Perintah: /session resume [id] · /session delete <id> · /session delete all\n'));
          }
        } else if (action === 'resume') {
          const targetId = subParts[1];
          if (targetId) {
            const ok = conversationSession.loadFromDisk(targetId);
            if (ok) {
              showResumedBanner();
            } else {
              console.log(chalk.red.bold(`\n  ❌ Sesi "${targetId}" tidak ditemukan.\n`));
            }
          } else {
            const list = listSessions();
            if (list.length === 0) {
              console.log(chalk.yellow('\n  Tidak ada sesi sebelumnya untuk di-resume.\n'));
            } else {
              const options = list.slice(0, 10).map((s) => {
                const dt = s.updatedAt ? new Date(s.updatedAt).toLocaleString('id-ID') : '-';
                const turns = s.stats?.turnCount || 0;
                const title = (s.title || s.id).slice(0, 36);
                return {
                  value: s.id,
                  label: `${title.padEnd(36)} ─ ${chalk.dim(`${turns} turn · ${dt}`)}`,
                };
              });
              options.push({ value: '__cancel__', label: chalk.gray('← Batal') });

              const pickedId = await p.select({
                message: 'Pilih sesi yang ingin dilanjutkan:',
                options,
              });

              if (!p.isCancel(pickedId) && pickedId !== '__cancel__') {
                const ok = conversationSession.loadFromDisk(pickedId);
                if (ok) {
                  showResumedBanner();
                } else {
                  console.log(chalk.red.bold(`\n  ❌ Gagal memuat sesi "${pickedId}".\n`));
                }
              }
            }
          }
        } else if (action === 'delete' || action === 'rm') {
          const target = subParts[1];
          if (!target) {
            console.log(chalk.yellow('\n  ⚠️  Tentukan sesi yang ingin dihapus:'));
            console.log(chalk.gray('  - ') + chalk.cyan('/session delete <id>') + chalk.gray('   : Hapus sesi tertentu'));
            console.log(chalk.gray('  - ') + chalk.cyan('/session delete all') + chalk.gray('    : Hapus seluruh sesi proyek'));
            const list = listSessions();
            if (list.length > 0) {
              console.log(chalk.gray('\n  Daftar ID sesi yang tersedia:'));
              list.slice(0, 5).forEach((s) => {
                console.log(chalk.gray('  • ') + chalk.white(s.id) + chalk.dim(` (${s.title || 'Tanpa judul'})`));
              });
            }
            console.log();
          } else if (target === 'all' || target === '--all') {
            const count = deleteAllSessions();
            if (count > 0) {
              console.log(chalk.green.bold(`\n  🗑️  Berhasil menghapus seluruh (${count}) sesi untuk proyek ini.\n`));
              conversationSession.reset();
            } else {
              console.log(chalk.yellow('\n  Tidak ada sesi yang perlu dihapus.\n'));
            }
          } else {
            const ok = deleteSession(target);
            if (ok) {
              console.log(chalk.green.bold(`\n  🗑️  Berhasil menghapus sesi: ${target}\n`));
              if (conversationSession.sessionId === target) {
                conversationSession.reset();
              }
            } else {
              console.log(chalk.red.bold(`\n  ❌ Sesi "${target}" tidak ditemukan.\n`));
            }
          }
        } else if (action === 'clear') {
          const count = deleteAllSessions();
          if (count > 0) {
            console.log(chalk.green.bold(`\n  🗑️  Berhasil menghapus seluruh (${count}) sesi untuk proyek ini.\n`));
            conversationSession.reset();
          } else {
            console.log(chalk.yellow('\n  Tidak ada sesi yang perlu dibersihkan.\n'));
          }
        } else {
          console.log(chalk.gray('\n  Penggunaan perintah /session:'));
          console.log(chalk.gray('  - ') + chalk.cyan('/session list') + chalk.gray('         : Tampilkan daftar sesi proyek'));
          console.log(chalk.gray('  - ') + chalk.cyan('/session resume [id]') + chalk.gray('   : Lanjutkan sesi (terakhir atau sesuai id)'));
          console.log(chalk.gray('  - ') + chalk.cyan('/session delete <id>') + chalk.gray('   : Hapus satu sesi tertentu'));
          console.log(chalk.gray('  - ') + chalk.cyan('/session delete all') + chalk.gray('    : Hapus seluruh sesi proyek'));
          console.log(chalk.gray('  - ') + chalk.cyan('/session clear') + chalk.gray('        : Bersihkan seluruh riwayat sesi proyek\n'));
        }
        break;
      }
      case '/skill':
      case '/skills': {
        const subParts = (arg || '').split(/\s+/).filter(Boolean);
        const action = subParts[0] || 'list';
        const targetSkill = subParts[1] || null;

        if (action === 'list') {
          const skills = discoverSkills();
          if (skills.size === 0) {
            console.log(chalk.yellow('\n  Belum ada skill yang terpasang.'));
            console.log(chalk.gray('  Tambahkan modul skill di: ') + chalk.cyan('.baiwor/skills/<nama>/SKILL.md'));
            console.log(chalk.gray('  atau global di: ') + chalk.cyan('~/.baiwor/skills/<nama>/SKILL.md\n'));
          } else {
            console.log(chalk.hex('#FBBF24').bold('\n  🧩 Keahlian & Plugin bAIwor Code (.baiwor/skills):'));
            for (const [name, s] of skills.entries()) {
              const scopeBadge = s.scope === 'project' ? chalk.green('[proyek]') : chalk.cyan('[global]');
              console.log(`    ${chalk.white.bold(name)} ${scopeBadge} ${chalk.gray(`v${s.version || '1.0.0'}`)}`);
              console.log(`      ${chalk.dim(s.description)}`);
            }
            console.log(chalk.gray('\n  Gunakan: /skill <nama> untuk memuat instruksi skill ke sesi aktif.\n'));
          }
        } else if (action === 'info') {
          if (!targetSkill) {
            console.log(chalk.yellow('\n  ⚠️  Sebutkan nama skill: /skill info <nama>\n'));
          } else {
            const skill = getSkill(targetSkill);
            if (!skill) {
              console.log(chalk.red(`\n  ❌ Skill "${targetSkill}" tidak ditemukan.\n`));
            } else {
              console.log(chalk.hex('#FBBF24').bold(`\n  🧩 Detail Skill: ${skill.name}`));
              console.log(`    ${chalk.dim('Scope        :')} ${skill.scope}`);
              console.log(`    ${chalk.dim('Versi        :')} ${skill.version}`);
              console.log(`    ${chalk.dim('Deskripsi    :')} ${skill.description}`);
              console.log(`    ${chalk.dim('Lokasi Berkas:')} ${chalk.cyan(skill.path)}`);
              console.log(chalk.gray('\n  Instruksi Singkat:'));
              const preview = skill.instructions.slice(0, 300);
              console.log(chalk.dim(preview + (skill.instructions.length > 300 ? '…' : '')));
              console.log();
            }
          }
        } else {
          const skillName = action;
          const skill = getSkill(skillName);
          if (!skill) {
            console.log(chalk.red(`\n  ❌ Skill "${skillName}" tidak ditemukan.`));
            console.log(chalk.gray('  Ketik ') + chalk.cyan('/skill list') + chalk.gray(' untuk melihat daftar skill yang tersedia.\n'));
          } else {
            conversationSession.addUserMessage(`[Instruksi Skill "${skill.name}"]:\n${skill.instructions}`);
            console.log(chalk.green.bold(`\n  ✓ Berhasil mengaktifkan skill "${skill.name}" ke dalam sesi aktif!`));
            console.log(chalk.gray(`    ${skill.description}\n`));
          }
        }
        break;
      }
      case '/rules':
      case '/rule': {
        const rules = discoverRules();
        if (rules.size === 0) {
          console.log(chalk.yellow('\n  Belum ada aturan koding khusus yang terpasang.'));
          console.log(chalk.gray('  Buat berkas aturan di root proyek: ') + chalk.cyan('BAIWORS.md') + chalk.gray(' atau ') + chalk.cyan('.baiwor/rules/<nama>.md'));
          console.log(chalk.gray('  atau aturan global di: ') + chalk.cyan('~/.baiwor/rules/<nama>.md\n'));
        } else {
          console.log(chalk.hex('#FBBF24').bold('\n  📜 Aturan Koding Aktif (Project & Global Rules):'));
          for (const [name, r] of rules.entries()) {
            const scopeBadge = r.scope === 'project' ? chalk.green('[proyek]') : chalk.cyan('[global]');
            console.log(`    ${chalk.white.bold(r.title || name)} ${scopeBadge}`);
            console.log(`      ${chalk.dim('Lokasi:')} ${chalk.cyan(r.path)}`);
            const preview = r.content.slice(0, 150).replace(/\r?\n/g, ' ');
            console.log(`      ${chalk.dim(preview + (r.content.length > 150 ? '…' : ''))}`);
          }
          console.log(chalk.gray('\n  Aturan di atas otomatis disuntikkan ke instruksi sistem bAIwor Code.\n'));
        }
        break;
      }
      case '/status':
        await printStatus();
        break;
      case '/tinyfish':
        await handleTinyFishCommand(arg);
        break;
      case '/mcp':
        await handleMcpCommand(arg);
        break;
      case '/model':
      case '/provider': {
        // Tanpa argumen → menu interaktif. Dengan argumen → switch langsung:
        //   /model <alias>            (alias buatan pengguna atau bawaan)
        //   /model provider/model     (short form)
        //   /model alias list|add|remove <nama> [provider/model]
        const handled = handleModelCommand(arg);
        if (handled.needsMenu) {
          await runModelMenu();
        } else if (handled.output) {
          console.log(handled.output);
        }
        break;
      }
      case '/login':
        await login(arg || undefined);
        break;
      case '/logout':
        await logout(arg || undefined);
        break;
      case '/reset':
        resetConversation();
        break;
      case '/clear':
        conversationSession.clearHistory();
        // `/clear` menyegarkan layar sekaligus membuka sesi bersih, jadi daftar
        // tugas dari pekerjaan sebelumnya juga dibuang agar tidak muncul lagi.
        resetTodoStore();
        console.clear();
        showBanner();
        break;
      case '/exit':
      case '/quit':
      case '/q':
      case '/e':
      case 'exit':
      case 'quit':
        showExitMessage();
        break;
      case '':
        break;
      default:
        if (mainCmd.startsWith('/')) {
          console.log(
            chalk.hex('#F87171')(`  Perintah "${command}" mboten dipunmangertosi.`) +
              chalk.hex('#6B7280')(` Ketik ${chalk.green('/help')} atau ${chalk.green('/')} untuk daftar perintah.`)
          );
        } else {
          await handleUserChat(command);
          try {
            conversationSession.saveToDisk({
              model: config.activeModel,
              provider: config.activeProvider,
            });
          } catch {}
        }
        break;
    }
  }
}

const program = new Command();

// `--help` dibuat berwarna & bermerek: header/footer hanya untuk help utama,
// sedangkan seluruh subcommand memakai gaya warna yang sama.
applyHelpStyle(program);
program.addHelpText('before', helpHeader());
program.addHelpText('after', helpFooter());

program
  .name('baiworcode')
  .description(`${APP_NAME} v${VERSION} — ${WEBSITE.replace(/^https?:\/\//, '')}`)
  .version(VERSION, '-v, --version')
  .option('-c, --continue', 'Lanjutkan sesi percakapan terakhir')
  .option('-r, --resume', 'Alias untuk --continue')
  .option('-s, --session <id>', 'Lanjutkan sesi percakapan tertentu berdasarkan ID')
  .argument('[prompt...]', 'Pertanyaan atau instruksi coding langsung')
  .action(async (promptParts, options = {}) => {
    let resumed = false;
    if (options.session) {
      resumed = conversationSession.loadFromDisk(options.session);
      if (!resumed) {
        console.log(chalk.yellow(`\n  ⚠️  Sesi "${options.session}" tidak ditemukan. Memulai sesi baru.`));
      }
    } else if (options.continue || options.resume) {
      resumed = conversationSession.resumeLatest();
      if (!resumed) {
        console.log(chalk.yellow('\n  ℹ️  Tidak ada sesi sebelumnya untuk dilanjutkan. Memulai sesi baru.'));
      }
    }

    if (promptParts && promptParts.length > 0) {
      const fullPrompt = promptParts.join(' ');
      if (resumed) {
        showResumedBanner();
      }
      await handleUserChat(fullPrompt);
      try {
        const config = getConfig();
        conversationSession.saveToDisk({
          model: config?.activeModel,
          provider: config?.activeProvider,
        });
      } catch {}
      process.exit(0);
    }

    if (resumed) {
      showResumedBanner();
      await startInteractive({ skipBanner: true });
    } else {
      await startInteractive();
    }
  });

program
  .command('plan [prompt...]')
  .description('Mode arsitek semAIr: susun rencana & analisis tanpa ubah kode')
  .action(async (promptParts) => {
    const prompt = (promptParts || []).join(' ').trim();
    if (!prompt) {
      console.log(chalk.cyan.bold('\n  👑 Mode Perencanaan semAIr (/plan)'));
      console.log(chalk.gray('     Format : ') + chalk.white('baiworcode plan <instruksi atau fitur>'));
      console.log(chalk.gray('     Contoh : ') + chalk.green('baiworcode plan "buatkan sistem auth JWT"\n'));
      process.exit(0);
    }
    await handleUserChat(buildPlanUserPrompt(prompt));
    try {
      const config = getConfig();
      conversationSession.saveToDisk({
        model: config?.activeModel,
        provider: config?.activeProvider,
      });
    } catch {}
    process.exit(0);
  });

program
  .command('session [action] [target]')
  .description('Kelola sesi percakapan proyek (list, resume, delete, clear)')
  .action(async (action = 'list', target) => {
    if (action === 'list') {
      const list = listSessions();
      if (list.length === 0) {
        console.log(chalk.yellow('\n  Belum ada sesi percakapan tersimpan untuk proyek ini.\n'));
      } else {
        console.log(chalk.cyan.bold(`\n  📁 Sesi Percakapan Proyek (${list.length} sesi):\n`));
        list.slice(0, 15).forEach((s, i) => {
          const dt = s.updatedAt ? new Date(s.updatedAt).toLocaleString('id-ID') : '-';
          console.log(chalk.white(`  ${i + 1}. `) + chalk.green.bold(s.title || s.id));
          console.log(chalk.gray(`     ID: ${s.id} · Terakhir: ${dt} · ${s.stats?.turnCount || 0} turn`));
        });
        console.log();
      }
    } else if (action === 'resume') {
      const targetId = target;
      if (targetId) {
        const ok = conversationSession.loadFromDisk(targetId);
        if (ok) {
          showResumedBanner();
          await startInteractive({ skipBanner: true });
        } else {
          console.log(chalk.red.bold(`\n  ❌ Sesi "${targetId}" tidak ditemukan.\n`));
          process.exit(1);
        }
      } else {
        const ok = conversationSession.resumeLatest();
        if (ok) {
          showResumedBanner();
          await startInteractive({ skipBanner: true });
        } else {
          console.log(chalk.yellow('\n  Tidak ada sesi sebelumnya untuk di-resume.\n'));
          process.exit(0);
        }
      }
    } else if (action === 'delete' || action === 'rm') {
      if (!target) {
        console.log(chalk.yellow('\n  ⚠️  Tentukan sesi yang ingin dihapus:'));
        console.log(chalk.gray('  - ') + chalk.white('baiworcode session delete <id>') + chalk.gray(' : Hapus satu sesi'));
        console.log(chalk.gray('  - ') + chalk.white('baiworcode session delete all') + chalk.gray('  : Hapus seluruh sesi proyek\n'));
      } else if (target === 'all' || target === '--all') {
        const count = deleteAllSessions();
        if (count > 0) {
          console.log(chalk.green.bold(`\n  🗑️  Berhasil menghapus seluruh (${count}) sesi untuk proyek ini.\n`));
        } else {
          console.log(chalk.yellow('\n  Tidak ada sesi yang perlu dihapus.\n'));
        }
      } else {
        const ok = deleteSession(target);
        if (ok) {
          console.log(chalk.green.bold(`\n  🗑️  Berhasil menghapus sesi: ${target}\n`));
        } else {
          console.log(chalk.red.bold(`\n  ❌ Sesi "${target}" tidak ditemukan.\n`));
        }
      }
    } else if (action === 'clear') {
      const count = deleteAllSessions();
      if (count > 0) {
        console.log(chalk.green.bold(`\n  🗑️  Berhasil menghapus seluruh (${count}) sesi untuk proyek ini.\n`));
      } else {
        console.log(chalk.yellow('\n  Tidak ada sesi yang perlu dibersihkan.\n'));
      }
    } else {
      console.log(chalk.gray('\n  Penggunaan perintah session:'));
      console.log(chalk.gray('  - ') + chalk.cyan('baiworcode session list') + chalk.gray('         : Tampilkan daftar sesi proyek'));
      console.log(chalk.gray('  - ') + chalk.cyan('baiworcode session resume [id]') + chalk.gray('   : Lanjutkan sesi (terakhir atau sesuai id)'));
      console.log(chalk.gray('  - ') + chalk.cyan('baiworcode session delete <id>') + chalk.gray('   : Hapus satu sesi tertentu'));
      console.log(chalk.gray('  - ') + chalk.cyan('baiworcode session delete all') + chalk.gray('    : Hapus seluruh sesi proyek'));
      console.log(chalk.gray('  - ') + chalk.cyan('baiworcode session clear') + chalk.gray('        : Bersihkan seluruh riwayat sesi proyek\n'));
    }
    process.exit(0);
  });

program
  .command('skill [action] [target]')
  .description('Kelola modul keahlian & plugin (.baiwor/skills)')
  .action(async (action = 'list', target = null) => {
    if (action === 'list') {
      const skills = discoverSkills();
      if (skills.size === 0) {
        console.log(chalk.yellow('\n  Belum ada skill yang terpasang.'));
        console.log(chalk.gray('  Tambahkan modul skill di: ') + chalk.cyan('.baiwor/skills/<nama>/SKILL.md'));
        console.log(chalk.gray('  atau global di: ') + chalk.cyan('~/.baiwor/skills/<nama>/SKILL.md\n'));
      } else {
        console.log(chalk.hex('#FBBF24').bold('\n  🧩 Keahlian & Plugin bAIwor Code (.baiwor/skills):'));
        for (const [name, s] of skills.entries()) {
          const scopeBadge = s.scope === 'project' ? chalk.green('[proyek]') : chalk.cyan('[global]');
          console.log(`    ${chalk.white.bold(name)} ${scopeBadge} ${chalk.gray(`v${s.version || '1.0.0'}`)}`);
          console.log(`      ${chalk.dim(s.description)}`);
        }
        console.log();
      }
    } else if (action === 'info') {
      if (!target) {
        console.log(chalk.yellow('\n  ⚠️  Sebutkan nama skill: baiworcode skill info <nama>\n'));
      } else {
        const skill = getSkill(target);
        if (!skill) {
          console.log(chalk.red(`\n  ❌ Skill "${target}" tidak ditemukan.\n`));
        } else {
          console.log(chalk.hex('#FBBF24').bold(`\n  🧩 Detail Skill: ${skill.name}`));
          console.log(`    ${chalk.dim('Scope        :')} ${skill.scope}`);
          console.log(`    ${chalk.dim('Versi        :')} ${skill.version}`);
          console.log(`    ${chalk.dim('Deskripsi    :')} ${skill.description}`);
          console.log(`    ${chalk.dim('Lokasi Berkas:')} ${chalk.cyan(skill.path)}`);
          console.log(chalk.gray('\n  Instruksi:'));
          console.log(chalk.dim(skill.instructions));
          console.log();
        }
      }
    } else {
      console.log(chalk.gray('\n  Penggunaan perintah skill:'));
      console.log(chalk.gray('  - ') + chalk.cyan('baiworcode skill list') + chalk.gray('         : Tampilkan seluruh skill proyek & global'));
      console.log(chalk.gray('  - ') + chalk.cyan('baiworcode skill info <nama>') + chalk.gray('  : Tampilkan detail & instruksi skill\n'));
    }
    process.exit(0);
  });

program
  .command('rules')
  .description('Tampilkan aturan koding aktif proyek & global (BAIWORS.md / .baiwor/rules)')
  .action(() => {
    const rules = discoverRules();
    if (rules.size === 0) {
      console.log(chalk.yellow('\n  Belum ada aturan koding khusus yang terpasang.'));
      console.log(chalk.gray('  Buat berkas aturan di root proyek: ') + chalk.cyan('BAIWORS.md') + chalk.gray(' atau ') + chalk.cyan('.baiwor/rules/<nama>.md'));
      console.log(chalk.gray('  atau aturan global di: ') + chalk.cyan('~/.baiwor/rules/<nama>.md\n'));
    } else {
      console.log(chalk.hex('#FBBF24').bold('\n  📜 Aturan Koding Aktif (Project & Global Rules):'));
      for (const [name, r] of rules.entries()) {
        const scopeBadge = r.scope === 'project' ? chalk.green('[proyek]') : chalk.cyan('[global]');
        console.log(`    ${chalk.white.bold(r.title || name)} ${scopeBadge}`);
        console.log(`      ${chalk.dim('Lokasi:')} ${chalk.cyan(r.path)}`);
        const preview = r.content.slice(0, 150).replace(/\r?\n/g, ' ');
        console.log(`      ${chalk.dim(preview + (r.content.length > 150 ? '…' : ''))}`);
      }
      console.log();
    }
    process.exit(0);
  });

program
  .command('status')
  .description('Tampilkan status konfigurasi dan sesi login')
  .action(async () => {
    await printStatus();
    process.exit(0);
  });

program
  .command('model [target...]')
  .description(
    'Pilih model/provider — tanpa argumen membuka menu; dengan argumen switch langsung (alias atau provider/model)'
  )
  .action(async (targets) => {
    const handled = handleModelCommand((targets || []).join(' '));
    if (handled.needsMenu) {
      await runModelMenu();
    } else if (handled.output) {
      console.log(handled.output);
    }
    process.exit(0);
  });

program
  .command('provider [target...]')
  .description('Alias untuk perintah model')
  .action(async (targets) => {
    const handled = handleModelCommand((targets || []).join(' '));
    if (handled.needsMenu) {
      await runModelMenu();
    } else if (handled.output) {
      console.log(handled.output);
    }
    process.exit(0);
  });

program
  .command('login [provider]')
  .description('Login ke Google Gemini OAuth')
  .action(async (provider) => {
    await login(provider);
    process.exit(0);
  });

program
  .command('logout [provider]')
  .description('Logout dari sesi Google Gemini OAuth')
  .action(async (provider) => {
    await logout(provider);
    process.exit(0);
  });

program
  .command('mcp')
  .description('Jalankan bAIwor Code sebagai MCP Server (stdio) untuk berbagai klien MCP eksternal')
  .action(() => {
    startMcpServer();
  });

// Samakan gaya warna help untuk seluruh subcommand yang sudah terdaftar.
for (const command of program.commands) {
  applyHelpStyle(command);
}

// Commander 13 hanya mendukung SATU short flag dan bawaannya huruf besar (-V).
// bAIwor memakai lowercase (-v) sebagai default, dan tetap menerima varian
// lain (--v, --V, -V) supaya tidak ada pengguna yang tertinggal.
const normalizedArgv = process.argv.map((arg) => {
  if (arg === '--v' || arg === '--V') return '--version';
  if (arg === '-V') return '-v';
  return arg;
});

program.parse(normalizedArgv);
