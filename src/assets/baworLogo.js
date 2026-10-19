import { theme } from '../theme.js';

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
    theme.textBright('     ╭───') + theme.error.bold('▲') + theme.textBright('───╮     '),
    theme.textBright('   ▄▀▀   ') + theme.error('│') + theme.textBright('   ▀▀▄   '),
    theme.textBright(' ( ') + theme.error('(') + theme.textBright.bold('O') + theme.error(')') + ' ' + theme.warning('( o )') + ' ' + theme.error('(') + theme.textBright.bold('O') + theme.error(')') + theme.textBright(' ) '),
    theme.error(' ▄███████████████▄ '),
    theme.error(' █ ') + theme.textBright.bold('█ █ █ █ █ █ █') + theme.error(' █ '),
    theme.error('  ▀█████████████▀  '),
    theme.textBright('     ╰───┴───╯     '),
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
