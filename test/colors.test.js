import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import chalk from 'chalk';
import { detectColorLevel, ensureColorSupport } from '../src/colors.js';

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
});
