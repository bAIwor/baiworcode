import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { theme, palette, paintDiff, paintDiffLine } from '../src/theme.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Menjalankan fn dengan chalk.level tertentu lalu memulihkannya.
 * Diperlukan karena `theme` mengevaluasi level chalk saat pemanggilan.
 */
function withLevel(level, fn) {
  const original = chalk.level;
  try {
    chalk.level = level;
    return fn();
  } finally {
    chalk.level = original;
  }
}

describe('Theme: Palette', () => {
  it('harus membekukan palette agar tidak bisa dimodifikasi di luar', () => {
    assert.ok(Object.isFrozen(palette));
  });

  it('harus punya token warna inti bAIwor Code', () => {
    const required = [
      'primary',
      'secondary',
      'accent',
      'error',
      'warning',
      'success',
      'info',
      'gold',
      'text',
      'textBright',
      'textMuted',
      'border',
    ];
    for (const key of required) {
      assert.equal(typeof palette[key], 'string', `palette.${key} harus ada`);
      assert.match(palette[key], /^#[0-9a-fA-F]{6}$/, `palette.${key} harus hex 6 digit`);
    }
  });

  it('harus punya token aksen CLI hasil konsolidasi hex liar', () => {
    assert.equal(palette.cliTitle, '#FBBF24');
    assert.equal(palette.cliVersion, '#F59E0B');
    assert.equal(palette.cliLink, '#38BDF8');
  });

  it('harus tidak punya hex liar di luar palette (audit token CLI)', () => {
    // Audit nyata: pindai seluruh src/ dan pastikan tidak ada warna hex yang
    // ditulis langsung di luar theme.js.
    const srcDir = path.join(REPO_ROOT, 'src');
    const offenders = [];

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        const rel = path.relative(srcDir, full);
        if (rel === 'theme.js') continue;

        const content = fs.readFileSync(full, 'utf8');
        const matches = content.match(/#[0-9a-fA-F]{6}\b/g) || [];
        if (matches.length) {
          offenders.push(`${rel}: ${[...new Set(matches)].join(', ')}`);
        }
      }
    };

    walk(srcDir);
    assert.deepEqual(
      offenders,
      [],
      `Ditemukan warna hex liar di luar theme.js:\n${offenders.join('\n')}\nGunakan token dari src/theme.js.`
    );
  });
});

describe('Theme: Painter', () => {
  it('harus memberi escape ANSI saat level warna aktif', () => {
    withLevel(3, () => {
      const out = theme.error('bocah');
      assert.ok(out.includes('\u001b['), 'harus memuat escape ANSI');
      assert.match(out, /bocah/);
    });
  });

  it('harus tidak memberi escape ANSI saat level warna 0', () => {
    withLevel(0, () => {
      assert.equal(theme.error('bocah'), 'bocah');
      assert.equal(theme.info.bold('bocah'), 'bocah');
    });
  });

  it('harus punya mode bold yang bisa dirangkai', () => {
    withLevel(3, () => {
      const out = theme.textBright.bold('Judul');
      assert.match(out, /Judul/);
      assert.ok(out.includes('\u001b['));
    });
  });

  it('harus merepresentasikan cliTitle/cliVersion/cliLink sebagai fungsi', () => {
    for (const key of ['cliTitle', 'cliVersion', 'cliLink', 'textBright']) {
      assert.equal(typeof theme[key], 'function', `theme.${key} harus fungsi`);
    }
  });
});

describe('Theme: paintDiff', () => {
  it('harus mewarnai header berkas sebagai konteks', () => {
    withLevel(3, () => {
      const out = paintDiffLine('+++ src/index.js');
      assert.match(out, /\+\+\+ src\/index\.js/);
      assert.ok(out.includes('\u001b['));
    });
  });

  it('harus mewarnai header hunk', () => {
    withLevel(3, () => {
      const out = paintDiffLine('@@ -1,3 +1,3 @@');
      assert.match(out, /@@ -1,3 \+1,3 @@/);
      assert.ok(out.includes('\u001b['));
    });
  });

  it('harus membedakan baris tambah dan baris hapus', () => {
    withLevel(3, () => {
      const added = paintDiffLine('+baris baru');
      const removed = paintDiffLine('-baris lama');
      assert.notEqual(added, removed);
      assert.match(added, /\+baris baru/);
      assert.match(removed, /-baris lama/);
    });
  });

  it('harus mewarnai multi-baris sekaligus dan menjaga jumlah baris', () => {
    withLevel(3, () => {
      const diff = ['+++ a.js', '@@ -1 +1 @@', '+tambah', '-hapus', ' konteks'].join('\n');
      const out = paintDiff(diff);
      assert.equal(out.split('\n').length, 5);
      assert.match(out, /\+tambah/);
      assert.match(out, /-hapus/);
    });
  });

  it('harus aman pada input kosong atau null', () => {
    assert.equal(paintDiff(''), '');
    assert.equal(paintDiff(null), '');
    assert.equal(paintDiff(undefined), '');
  });

  it('harus mengembalikan teks polos saat warna dimatikan', () => {
    withLevel(0, () => {
      assert.equal(paintDiffLine('+tambah'), '+tambah');
      assert.equal(paintDiff('a\nb'), 'a\nb');
    });
  });
});
