#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { getConfig, CONFIG_FILE, maskSecret } from '../src/config.js';
import { runModelMenu } from '../src/modelMenu.js';
import { askBaiworInput, COMMANDS } from '../src/prompt.js';
import { login, logout, authStatus } from '../src/auth/index.js';
import { BAWOR_LOGO } from '../src/assets/baworLogo.js';
import { handleUserChat, resetConversation, conversationSession } from '../src/chat/index.js';
import { resolveActiveCredentials } from '../src/auth/resolve.js';

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
    chalk.white.bold(line.slice(0, 10)) +
    chalk.redBright.bold(line.slice(10, 21)) +
    chalk.white.bold(line.slice(21))
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
  console.log(chalk.gray('  🎭 "Saka Bawor dadi bAIwor — Jiwa Punakawan, Pikiran AI, Ati Banyumas"'));
  console.log();

  const readyBadge = chalk.green('● Ready');
  const topBar = '  ' + chalk.gray('╭─ v1.0.0 ' + '─'.repeat(54) + ' ') + readyBadge + chalk.gray(' ─╮');
  const midBar = '  ' + chalk.gray('├' + '─'.repeat(targetWidth + 2) + '┤');
  const botBar = '  ' + chalk.gray('╰' + '─'.repeat(targetWidth + 2) + '╯');

  console.log(topBar);
  console.log(padBox(chalk.white('Tips for getting started')));
  console.log(padBox(chalk.gray('› ') + 'Gunakan ' + chalk.cyan('/help') + ' untuk melihat semua perintah yang tersedia.'));
  console.log(padBox(chalk.gray('› ') + 'Gunakan ' + chalk.cyan('/clear') + ' untuk menyegarkan layar kerja kapan saja.'));
  console.log(padBox(chalk.gray('› ') + 'Kunjungi ' + chalk.cyan('https://baiwor.my.id') + ' untuk dokumentasi & update resmi.'));
  console.log(midBar);
  console.log(padBox(chalk.white('Workspace & Status')));
  console.log(padBox(chalk.gray('› ') + 'Folder Aktif : ' + chalk.cyan(process.cwd())));
  const modelInfo = config.activeModel !== 'Not configured'
    ? chalk.hex('#F59E0B')(config.activeModel) + chalk.gray(` (${config.activeProvider})`)
    : chalk.gray('Belum dikonfigurasi (/model)');
  console.log(padBox(chalk.gray('› ') + 'Model Aktif  : ' + modelInfo));
  console.log(botBar);
  console.log();

  const activeModelDisplay = config.activeModel !== 'Not configured'
    ? chalk.hex('#F59E0B')(config.activeModel)
    : chalk.gray('Not configured');
  const activeProviderDisplay = config.activeProvider !== 'Not configured'
    ? chalk.cyan(config.activeProvider)
    : chalk.cyan('baiwor.my.id');

  console.log(chalk.gray('   Start · @ file · / commands'));
  console.log(chalk.gray('   ─────────────────────────────────────────────────────────────────────────'));
  console.log(
    '   ' +
      chalk.cyan('~') +
      ' ' +
      chalk.gray('│') +
      ' ' +
      chalk.white('Full access') +
      ' ' +
      chalk.gray('│') +
      ' ' +
      chalk.magenta('✦') +
      ' ' +
      activeModelDisplay +
      ' ' +
      chalk.gray('·') +
      ' ' +
      activeProviderDisplay
  );
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
  console.log();

  console.log(chalk.white.bold('  🔐 Status Sesi OAuth Providers:'));
  for (const item of oauthList) {
    const badge = item.loggedIn ? chalk.green('● Logged In ') : chalk.gray('○ Belum Login');
    const tokenInfo = item.loggedIn ? chalk.gray(`[Token: ${item.maskedToken}] (${item.expiryStatus})`) : '';
    console.log(`    ${badge} ${chalk.bold(item.name.padEnd(16))} ${chalk.dim(`(${item.method})`)} ${tokenInfo}`);
  }

  const customList = config.customProviders || [];
  if (customList.length > 0) {
    console.log();
    console.log(chalk.white.bold('  🌐 Custom Providers Tersimpan:'));
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
  console.log(chalk.gray('  🌐 Website official  : ') + chalk.cyan('https://baiwor.my.id'));
  console.log(
    chalk.gray('  🎁 Bonus token/credit: ') +
      chalk.cyan('https://agentik.my.id') +
      chalk.dim(' (Dapatkan bonus token/credit untuk instalasi bAIwor Code)\n')
  );
  process.exit(0);
}

async function startInteractive() {
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

program
  .name('baiworcode')
  .description('bAIwor Code v1.0.0 — baiwor.my.id')
  .version('1.0.0')
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

program.parse(process.argv);
