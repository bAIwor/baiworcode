#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import readline from 'node:readline';
import { getConfig } from '../src/config.js';
import { runModelMenu } from '../src/modelMenu.js';
import { askBaiworInput, COMMANDS } from '../src/prompt.js';

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function visualWidth(str) {
  const clean = stripAnsi(str);
  let w = 0;
  for (const ch of clean) {
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
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

const targetWidth = 71;

function padBox(content) {
  let clean = content;
  if (visualWidth(clean) > targetWidth) {
    while (visualWidth(clean) > targetWidth - 1 && clean.length > 0) {
      clean = clean.slice(0, -1);
    }
    clean += '…';
  }
  const w = visualWidth(clean);
  const pad = Math.max(0, targetWidth - w);
  return '  ' + chalk.gray('│ ') + clean + ' '.repeat(pad) + chalk.gray(' │');
}

function showBanner() {
  const config = getConfig();

  const logo = [
    '  ██████╗  █████╗ ██╗██╗    ██╗ ██████╗ ██████╗ ',
    '  ██╔══██╗██╔══██╗██║██║    ██║██╔═══██╗██╔══██╗',
    '  ██████╔╝███████║██║██║ █╗ ██║██║   ██║██████╔╝',
    '  ██╔══██╗██╔══██║██║██║███╗██║██║   ██║██╔══██╗',
    '  ██████╔╝██║  ██║██║╚███╔███╔╝╚██████╔╝██║  ██║',
    '  ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝'
  ];

  console.log();
  for (const line of logo) {
    const b = line.slice(0, 10);
    const ai = line.slice(10, 21);
    const wor = line.slice(21);
    console.log(chalk.white.bold(b) + chalk.redBright.bold(ai) + chalk.white.bold(wor));
  }
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

function showHelp() {
  const gold = chalk.hex('#FBBF24');
  const green = chalk.hex('#10B981');
  const dim = chalk.hex('#6B7280');

  console.log();
  console.log(gold.bold('  📖 Panduan Perintah:'));
  console.log(`    ${green('/help')}      ${dim('─')}  Menampilkan panduan perintah`);
  console.log(`    ${green('/model')}     ${dim('─')}  Pilih & kelola model AI / provider (ala Hermes)`);
  console.log(`    ${green('/provider')}  ${dim('─')}  Alias untuk perintah /model`);
  console.log(`    ${green('/clear')}     ${dim('─')}  Membersihkan layar dan menampilkan ulang banner`);
  console.log(`    ${green('/exit')}      ${dim('─')}  Keluar dari bAIwor CLI`);
  console.log();
}

async function startInteractive() {
  showBanner();

  while (true) {
    const input = await askBaiworInput({
      placeholder: 'Ask bAIwor to do anything...',
    });

    if (p.isCancel(input) || input === null) {
      console.log(chalk.hex('#F59E0B')('\n  Matur nuwun! Sampai jumpa lagi. 🙏\n'));
      process.exit(0);
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

    switch (command) {
      case '/help':
        showHelp();
        break;
      case '/model':
      case '/provider':
        await runModelMenu();
        break;
      case '/clear':
        console.clear();
        showBanner();
        break;
      case '/exit':
        console.log(chalk.hex('#F59E0B')('\n  Matur nuwun! Sampun ngginakaken bAIwor CLI. 🙏\n'));
        process.exit(0);
        break;
      case '':
        break;
      default:
        console.log(
          chalk.hex('#F87171')(`  Perintah "${command}" mboten dipunmangertosi.`) +
            chalk.hex('#6B7280')(` Ketik ${chalk.green('/help')} atau ${chalk.green('/')} untuk daftar perintah.`)
        );
        break;
    }
  }
}

const program = new Command();

program
  .name('baiwor')
  .description('bAIwor CLI v1.0.0 — baiwor.my.id')
  .version('1.0.0')
  .action(async () => {
    await startInteractive();
  });

program
  .command('model')
  .description('Pilih dan kelola model AI / provider (ala Hermes)')
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

program.parse(process.argv);
