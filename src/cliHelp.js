import chalk from 'chalk';
import { theme } from './theme.js';
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
  styleTitle: (str) => {
    // Judul bawaan Commander berbahasa Inggris — diterjemahkan agar pemula
    // Indonesia tidak perlu menerjemahkan sendiri bagian panduannya.
    const TITLE_MAP = {
      'Usage:': 'CARA PAKAI',
      'Arguments:': 'ARGUMEN',
      'Options:': 'OPSI',
      'Global Options:': 'OPSI GLOBAL',
      'Commands:': 'PERINTAH',
    };
    return theme.cliTitle(TITLE_MAP[str] || str.replace(/:\s*$/, '').toUpperCase());
  },
  styleCommandText: (str) => theme.info.bold(str),
  styleOptionText: (str) => theme.textBright(str),
  styleSubcommandText: (str) => theme.success(str),
  styleArgumentText: (str) => theme.accent(str),
  styleDescriptionText: (str) => theme.muted(str),
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
    theme.textBright.bold(`  🎭 ${APP_NAME} `) + theme.cliVersion(`v${version}`),
    theme.muted(`  "${TAGLINE}"`),
    '',
  ].join('\n');
}

/**
 * Footer berwarna: contoh pemakaian singkat dan tautan resmi.
 *
 * @returns {string}
 */
export function helpFooter() {
  const cmd = (text) => theme.info(text.padEnd(APP_SLUG.length + 8));
  return [
    '',
    theme.cliTitle('  CONTOH CEPAT'),
    `    ${theme.info(`${APP_SLUG} "jelaskan struktur proyek ini"`)}`,
    `    ${cmd(`${APP_SLUG} -c`)}${theme.muted('→ lanjutkan sesi percakapan terakhir')}`,
    `    ${theme.info(`${APP_SLUG} ./proyek-lain`)}${theme.muted(' → buka di folder proyek tertentu')}`,
    `    ${theme.info(`${APP_SLUG} -C /path/proyek "perbaiki bug"`)}`,
    `    ${cmd(`${APP_SLUG} model`)}${theme.muted('→ pilih provider & model')}`,
    `    ${cmd(`${APP_SLUG} session`)}${theme.muted('→ kelola riwayat sesi proyek')}`,
    `    ${cmd(`${APP_SLUG} status`)}${theme.muted('→ cek kredensial & latency')}`,
    '',
    `  ${theme.muted(`🌐 ${WEBSITE.replace(/^https?:\/\//, '')}`)}${theme.muted('   ·   ')}${theme.muted('🎁 bonus token: ')}${theme.info(BONUS_WEBSITE.replace(/^https?:\/\//, ''))}${theme.muted(' (kode kupon "baiworcode")')}`,
    '',
  ].join('\n');
}
