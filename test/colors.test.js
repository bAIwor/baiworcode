import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import chalk from 'chalk';
import {
  detectColorLevel,
  ensureColorSupport,
  createPainter,
  NO_COLOR_PAINTER,
} from '../src/colors.js';

const tty = { isTTY: true };
const notTty = { isTTY: false };

describe('Warna: Deteksi Level', () => {
  it('harus mengembalikan 0 di luar TTY', () => {
    assert.equal(detectColorLevel(notTty, {}), 0);
  });

  it('harus menghormati NO_COLOR walau terminal sanggup', () => {
    assert.equal(detectColorLevel(tty, { NO_COLOR: '1', WT_SESSION: 'abc' }), 0);
  });

  it('harus mengenali Windows Terminal sebagai truecolor', () => {
    assert.equal(detectColorLevel(tty, { WT_SESSION: 'abc' }), 3);
  });

  it('harus mengenali COLORTERM truecolor/24bit', () => {
    assert.equal(detectColorLevel(tty, { COLORTERM: 'truecolor' }), 3);
    assert.equal(detectColorLevel(tty, { COLORTERM: '24bit' }), 3);
  });

  it('harus memberi 256 warna untuk TERM 256color', () => {
    assert.equal(detectColorLevel(tty, { TERM: 'xterm-256color' }), 2);
  });

  it('harus memberi minimal 16 warna untuk TTY biasa', () => {
    assert.equal(detectColorLevel(tty, {}), 1);
  });

  it('harus menghormati FORCE_COLOR eksplisit', () => {
    assert.equal(detectColorLevel(tty, { FORCE_COLOR: '0', WT_SESSION: 'abc' }), 0);
    assert.equal(detectColorLevel(tty, { FORCE_COLOR: 'false', WT_SESSION: 'abc' }), 0);
    assert.equal(detectColorLevel(tty, { FORCE_COLOR: '2' }), 2);
    assert.equal(detectColorLevel(notTty, { FORCE_COLOR: '1' }), 1);
  });
});

describe('Warna: Koreksi Level Chalk', () => {
  const withLevel = (level, fn) => {
    const original = chalk.level;
    try {
      chalk.level = level;
      return fn();
    } finally {
      chalk.level = original;
    }
  };

  it('harus menaikkan level 0 ke level yang terdeteksi', () => {
    withLevel(0, () => {
      ensureColorSupport(tty, { WT_SESSION: 'abc' });
      assert.equal(chalk.level, 3);
    });
  });

  it('tidak boleh menurunkan level yang sudah lebih tinggi', () => {
    withLevel(3, () => {
      ensureColorSupport(tty, {});
      assert.equal(chalk.level, 3);
    });
  });

  it('tidak boleh mengaktifkan warna di luar TTY', () => {
    withLevel(0, () => {
      ensureColorSupport(notTty, { WT_SESSION: 'abc' });
      assert.equal(chalk.level, 0);
    });
  });

  it('tidak boleh mengaktifkan warna saat NO_COLOR diset', () => {
    withLevel(0, () => {
      ensureColorSupport(tty, { NO_COLOR: '1' });
      assert.equal(chalk.level, 0);
    });
  });

  it('tidak boleh mengaktifkan warna saat FORCE_COLOR=0', () => {
    withLevel(0, () => {
      ensureColorSupport(tty, { FORCE_COLOR: '0', WT_SESSION: 'abc' });
      assert.equal(chalk.level, 0);
    });
  });
});

describe('Warna: NO_COLOR_PAINTER', () => {
  it('harus mengembalikan teks apa adanya tanpa escape ANSI', () => {
    assert.equal(NO_COLOR_PAINTER('bocah'), 'bocah');
    assert.equal(NO_COLOR_PAINTER.bold('bocah'), 'bocah');
    assert.ok(!NO_COLOR_PAINTER('bocah').includes('\u001b['));
  });

  it('harus menandai dirinya sebagai tidak terlihat', () => {
    assert.equal(NO_COLOR_PAINTER.visible, false);
  });

  it('harus mendukung seluruh metode chalk dasar sebagai superset eksplisit', () => {
    const methods = [
      'bold',
      'dim',
      'italic',
      'underline',
      'strikethrough',
      'inverse',
      'hidden',
      'reset',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'gray',
      'whiteBright',
      'greenBright',
      'yellowBright',
      'redBright',
      'cyanBright',
      'blueBright',
      'magentaBright',
      'bgRed',
      'bgGreen',
      'bgYellow',
      'bgBlue',
      'bgMagenta',
      'bgCyan',
      'bgWhite',
      'bgBlack',
    ];
    for (const m of methods) {
      assert.equal(typeof NO_COLOR_PAINTER[m], 'function', `NO_COLOR_PAINTER.${m} harus ada`);
      assert.equal(NO_COLOR_PAINTER[m]('x'), 'x');
    }
  });

  it('harus punya constructor warna yang mengembalikan fungsi yang bisa dipanggil', () => {
    for (const builder of ['hex', 'rgb', 'ansi256', 'bgHex']) {
      assert.equal(typeof NO_COLOR_PAINTER[builder], 'function', `${builder} harus ada`);
      const made = NO_COLOR_PAINTER[builder]('#38BDF8');
      assert.equal(typeof made, 'function', `${builder}() harus mengembalikan fungsi`);
      assert.equal(made('teks'), 'teks');
    }
  });
});

describe('Warna: createPainter', () => {
  it('harus mengembalikan chalk saat mode berwarna aktif', () => {
    assert.equal(createPainter(true), chalk);
  });

  it('harus mengembalikan NO_COLOR_PAINTER saat mode berwarna mati', () => {
    assert.equal(createPainter(false), NO_COLOR_PAINTER);
  });

  it('harus default ke mode berwarna saat argumen tidak diberikan', () => {
    assert.equal(createPainter(), chalk);
  });

  it('harus menghasilkan keluaran polos tanpa ANSI saat dimatikan', () => {
    const p = createPainter(false);
    const out = p.hex('#38BDF8')('Custom endpoint');
    assert.equal(out, 'Custom endpoint');
    assert.ok(!out.includes('\u001b['));
  });
});
