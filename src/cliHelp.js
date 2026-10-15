import chalk from 'chalk';
import { APP_NAME, APP_SLUG, VERSION, WEBSITE, BONUS_WEBSITE, TAGLINE } from './branding.js';

/**
 * Gaya warna untuk `--help` CLI bAIwor Code.
 *
 * Commander mengekspos hook kustomisasi lewat `configureHelp`. Kita cukup
 * menimpa style dasarnya saja: style turunan seperti `styleUsage`,
 * `styleSubcommandTerm`, dan `styleOptionTerm` menyusun dirinya sendiri dari
 * style-style ini, jadi tidak perlu didefinisikan satu per satu.
 *
 * Judul bagian (`Usage:`, `Options:`, …) dibersihkan dari titik dua lalu
 * dihuruf-besarkan agar tampil seperti panduan CLI modern (mis. `USAGE`).
 */
const HELP_STYLE = {
  styleTitle: (str) => chalk.hex('#FBBF24').bold(str.replace(/:\s*$/, '').toUpperCase()),
  styleCommandText: (str) => chalk.cyan.bold(str),
  styleOptionText: (str) => chalk.whiteBright(str),
  styleSubcommandText: (str) => chalk.greenBright(str),
  styleArgumentText: (str) => chalk.magenta(str),
  styleDescriptionText: (str) => chalk.gray(str),
};

/**
 * Menerapkan gaya warna help ke sebuah command beserta subcommand-nya.
 *
 * @param {import('commander').Command} command
 */
export function applyHelpStyle(command) {
  command.configureHelp(HELP_STYLE);
}

/**
 * Header berwarna yang tampil di atas help utama.
 *
 * @param {string} [version]
 * @returns {string}
 */
export function helpHeader(version = VERSION) {
  return [
    '',
    chalk.whiteBright.bold(`  🎭 ${APP_NAME} `) + chalk.hex('#F59E0B').bold(`v${version}`),
    chalk.gray(`  "${TAGLINE}"`),
    '',
  ].join('\n');
}

/**
 * Footer berwarna: contoh pemakaian singkat dan tautan resmi.
 *
 * @returns {string}
 */
export function helpFooter() {
  const cmd = (text) => chalk.cyan(text.padEnd(APP_SLUG.length + 8));
  return [
    '',
    chalk.hex('#FBBF24').bold('  CONTOH CEPAT'),
    `    ${chalk.cyan(`${APP_SLUG} "jelaskan struktur proyek ini"`)}`,
    `    ${chalk.cyan(`${APP_SLUG} "perbaiki error di src/index.js"`)}`,
    `    ${cmd(`${APP_SLUG} model`)}${chalk.gray('→ pilih provider & model')}`,
    `    ${cmd(`${APP_SLUG} status`)}${chalk.gray('→ cek kredensial & latency')}`,
    '',
    `  ${chalk.gray(`🌐 ${WEBSITE.replace(/^https?:\/\//, '')}`)}${chalk.gray('   ·   ')}${chalk.gray('🎁 bonus token: ')}${chalk.cyan(BONUS_WEBSITE.replace(/^https?:\/\//, ''))}`,
    '',
  ].join('\n');
}
