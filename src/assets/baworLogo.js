import chalk from 'chalk';

/**
 * Logo Wajah Topeng bAIwor (Bawor Banyumasan).
 * Dilukis presisi menggunakan kombinasi box-drawing, block element, dan ANSI colors
 * berdasarkan referensi topeng asli ("Glossy Red-Eyed Demon Mask.png").
 * Simetris sempurna 19 kolom di setiap baris (titik tengah pas di kolom 10),
 * lurus tegak, tidak miring/menceng.
 */
export const BAWOR_LOGO = {
  cols: 19,
  rows: 7,
  color: [
    chalk.white('     ╭───') + chalk.redBright.bold('▲') + chalk.white('───╮     '),
    chalk.white('   ▄▀▀   ') + chalk.redBright('│') + chalk.white('   ▀▀▄   '),
    chalk.white(' ( ') + chalk.redBright('(') + chalk.white.bold('O') + chalk.redBright(')') + ' ' + chalk.yellow('( o )') + ' ' + chalk.redBright('(') + chalk.white.bold('O') + chalk.redBright(')') + chalk.white(' ) '),
    chalk.redBright(' ▄███████████████▄ '),
    chalk.redBright(' █ ') + chalk.white.bold('█ █ █ █ █ █ █') + chalk.redBright(' █ '),
    chalk.redBright('  ▀█████████████▀  '),
    chalk.white('     ╰───┴───╯     '),
  ],
  mono: [
    '     ╭───▲───╮     ',
    '   ▄▀▀   │   ▀▀▄   ',
    ' ( (O) ( o ) (O) ) ',
    ' ▄███████████████▄ ',
    ' █ █ █ █ █ █ █ █ █ ',
    '  ▀█████████████▀  ',
    '     ╰───┴───╯     ',
  ],
};
