#!/usr/bin/env node

// WAJIB paling awal: menyetel level warna chalk sebelum modul lain (mis. logo
// Bawor) menghitung string berwarnanya saat import. Lihat src/colors.js.
import '../src/colors.js';

import { Command } from 'commander';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { getConfig, CONFIG_FILE, maskSecret } from '../src/config.js';
import { runModelMenu } from '../src/modelMenu.js';
import { askBaiworInput, COMMANDS } from '../src/prompt.js';
import { login, logout, authStatus } from '../src/auth/index.js';
import { BAWOR_LOGO } from '../src/assets/baworLogo.js';
import { handleUserChat, resetConversation, conversationSession } from '../src/chat/index.js';
import { resetTodoStore } from '../src/tools/todoTool.js';
import { renderStatusLine } from '../src/statusLine.js';
import { resolveActiveCredentials } from '../src/auth/resolve.js';
import { applyHelpStyle, helpHeader, helpFooter } from '../src/cliHelp.js';
import { APP_NAME, VERSION, WEBSITE, BONUS_WEBSITE, TAGLINE } from '../src/branding.js';

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
  '  ██████╗  █████╗ ██╗██╗    ██╗ ██████╗ ██████╗ ',
  '  ██╔══██╗██╔══██╗██║██║    ██║██╔═══██╗██╔══██╗',
  '  ██████╔╝███████║██║██║ █╗ ██║██║   ██║██████╔╝',
  '  ██╔══██╗██╔══██║██║██║███╗██║██║   ██║██╔══██╗',
  '  ██████╔╝██║  ██║██║╚███╔███╔╝╚██████╔╝██║  ██║',
  '  ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝',
];

/** Logo teks bAIwor: "b" putih, "AI" merah, "wor" putih. */
function colorizeTextLogoLine(line) {
  return (
    chalk.whiteBright.bold(line.slice(0, 10)) +
    chalk.redBright.bold(line.slice(10, 21)) +
    chalk.whiteBright.bold(line.slice(21))
  );
}

const LOGO_INDENT = '  ';
const LOGO_GAP = ' ';
const TEXT_LOGO_WIDTH = Math.max(...BAWOR_TEXT_LOGO.map((l) => l.length));

/**
 * Header pembuka: muka Bawor (kiri) berdampingan dengan logo teks bAIwor (kanan).
 * Menyesuaikan lebar terminal: berdampingan -> bertumpuk -> logo teks saja.
 */
function printLogoHeader() {
  const artLines =
    (chalk.level > 0 && BAWOR_LOGO.color)
      ? BAWOR_LOGO.color
      : (BAWOR_LOGO.mono || BAWOR_LOGO.lines || []);
  const textLines = BAWOR_TEXT_LOGO.map(colorizeTextLogoLine);
  const columns = process.stdout.columns || 80;

  const sideBySideWidth =
    LOGO_INDENT.length + BAWOR_LOGO.cols + LOGO_GAP.length + TEXT_LOGO_WIDTH;

  // 1. Terminal cukup lebar: logo berdampingan
  if (columns >= sideBySideWidth) {
    const artH = artLines.length;
    const textH = textLines.length;
    const padTop = Math.max(0, Math.floor((artH - textH) / 2));
    const padBot = Math.max(0, artH - textH - padTop);

    const right = [
      ...Array(padTop).fill(''),
      ...textLines,
      ...Array(padBot).fill(''),
    ];

    for (let i = 0; i < artH; i++) {
      console.log(LOGO_INDENT + artLines[i] + LOGO_GAP + (right[i] || ''));
    }
    return;
  }

  // 2. Muat untuk logo saja: tampilkan bertumpuk (muka di atas, teks di bawah)
  if (columns >= BAWOR_LOGO.cols + LOGO_INDENT.length) {
    for (const line of artLines) {
      console.log(LOGO_INDENT + line);
    }
    console.log();
    for (const line of textLines) {
      console.log(line);
    }
    return;
  }

  // 3. Terlalu sempit: logo teks saja
  for (const line of textLines) {
    console.log(line);
  }
}

function showBanner() {
  const config = getConfig();

  console.log();
  printLogoHeader();
  console.log(chalk.gray(`  🎭 "${TAGLINE}"`));
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
  console.log(`    ${chalk.cyan('baiworcode "perbaiki error di src/index.js"')}`);
  console.log(`    ${chalk.cyan('baiworcode "buatkan test untuk fungsi hitungTotal"')}`);
  console.log();
  console.log(gold.bold('  🧭 Cara Membaca Aktivitas bAIwor:'));
  console.log(`    ${dim('├')} ✓ read_file ${dim('· 0.1s · 42 baris')}`);
  console.log(`    ${dim('├')} ✓ todo_list ${dim('· 2ms · 3/5 selesai')}`);
  console.log(`    ${dim('│')}   ✓ Baca struktur proyek`);
  console.log(`    ${dim('│')}   ○ Tambah unit test`);
  console.log(`    ${dim('└')} ✗ run_command ${dim('· 1.2s · 1 baris')}`);
  console.log(`    ${dim('Setiap tool dicatat lengkap dengan durasi dan jumlah baris keluaran.')}`);
  console.log(`    ${dim('Daftar tugas dari todo_list tampil sebagai checklist di bawah node-nya.')}`);
  console.log(`    ${dim('Baris "Context X% left" muncul setelah setiap jawaban. Angka itu perkiraan,')}`);
  console.log(`    ${dim('dan riwayat dipangkas otomatis bila mulai penuh — pakai /clear bila perlu.')}`);
  console.log();
  console.log(chalk.gray('  💡 Ketik langsung pertanyaan atau instruksi coding apa saja untuk chat dengan bAIwor!'));
  console.log();
}

/**
 * Mengukur round-trip latency ke endpoint provider yang sedang aktif secara tahan-gagal.
 */
async function checkActiveProviderLatency() {
  try {
    const creds = await resolveActiveCredentials();
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
}

function showExitMessage() {
  console.log(chalk.hex('#F59E0B')('\n  Matur nuwun! Sampun nganggo bAIwor Code. 🙏'));
  console.log(chalk.gray('  🌐 Website official  : ') + chalk.cyan(WEBSITE));
  console.log(
    chalk.gray('  🎁 Bonus token/credit: ') +
      chalk.cyan(BONUS_WEBSITE) +
      chalk.dim(' (Dapatkan bonus token/credit untuk instalasi bAIwor Code)\n')
  );
  process.exit(0);
}

async function startInteractive() {
  // Cegah sistem operasi langsung mematikan proses saat Ctrl+C ditekan di terminal
  process.on('SIGINT', () => {});

  showBanner();

  while (true) {
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
      case '/status':
        await printStatus();
        break;
      case '/model':
      case '/provider':
        await runModelMenu();
        break;
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
  .argument('[prompt...]', 'Pertanyaan atau instruksi coding langsung')
  .action(async (promptParts) => {
    if (promptParts && promptParts.length > 0) {
      const fullPrompt = promptParts.join(' ');
      await handleUserChat(fullPrompt);
      process.exit(0);
    }
    await startInteractive();
  });

program
  .command('status')
  .description('Tampilkan status konfigurasi dan sesi login')
  .action(async () => {
    await printStatus();
    process.exit(0);
  });

program
  .command('model')
  .description('Pilih model Agentik, Google Gemini, atau Custom Endpoint')
  .action(async () => {
    await runModelMenu();
    process.exit(0);
  });

program
  .command('provider')
  .description('Alias untuk perintah model')
  .action(async () => {
    await runModelMenu();
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
