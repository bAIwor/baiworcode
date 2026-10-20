import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateVisualDiff } from '../src/tools/diffView.js';

describe('Visual Diff Generator (generateVisualDiff)', () => {
  it('harus mengenali teks identik tanpa perubahan', () => {
    const diff = generateVisualDiff('hello world\nline 2', 'hello world\nline 2');
    assert.equal(diff.hasChanges, false);
    assert.equal(diff.additions, 0);
    assert.equal(diff.deletions, 0);
    assert.equal(diff.diffText, '');
  });

  it('harus menghasilkan penambahan penuh pada pembuatan berkas baru', () => {
    const newContent = 'const a = 1;\nconst b = 2;\n';
    const diff = generateVisualDiff('', newContent, { filePath: 'src/app.js', useColor: false });
    assert.equal(diff.hasChanges, true);
    assert.equal(diff.additions, 2);
    assert.equal(diff.deletions, 0);
    assert.ok(diff.diffText.includes('--- a/src/app.js'));
    assert.ok(diff.diffText.includes('+++ b/src/app.js'));
    assert.ok(diff.diffText.includes('+ const a = 1;'));
    assert.ok(diff.diffText.includes('+ const b = 2;'));
  });

  it('harus menghasilkan penghapusan dan penambahan pada modifikasi baris', () => {
    const oldContent = 'baris 1\nbaris 2 lama\nbaris 3';
    const newContent = 'baris 1\nbaris 2 baru\nbaris 3';
    const diff = generateVisualDiff(oldContent, newContent, { filePath: 'notes.txt', useColor: false });

    assert.equal(diff.hasChanges, true);
    assert.equal(diff.additions, 1);
    assert.equal(diff.deletions, 1);
    assert.ok(diff.diffText.includes('- baris 2 lama'));
    assert.ok(diff.diffText.includes('+ baris 2 baru'));
    assert.ok(diff.diffText.includes('  baris 1'));
    assert.ok(diff.diffText.includes('  baris 3'));
  });

  it('harus menyertakan ANSI escape codes saat useColor=true', () => {
    const oldContent = 'alpha\nbeta';
    const newContent = 'alpha\ngamma';
    const diff = generateVisualDiff(oldContent, newContent, { filePath: 'test.js', useColor: true });

    assert.equal(diff.hasChanges, true);
    // Memuat ANSI escape sequence \x1b[
    assert.ok(diff.coloredDiff.includes('\x1b['), 'coloredDiff harus memuat kode warna ANSI');
    assert.ok(diff.diffStats.includes('\x1b['), 'diffStats harus memuat kode warna ANSI');
  });

  it('harus membatasi baris panjang dengan peringatan disingkat', () => {
    const oldLines = Array.from({ length: 50 }, (_, i) => `baris lama ${i + 1}`).join('\n');
    const newLines = Array.from({ length: 50 }, (_, i) => `baris baru ${i + 1}`).join('\n');
    const diff = generateVisualDiff(oldLines, newLines, { maxDiffLines: 10, useColor: false });

    assert.equal(diff.hasChanges, true);
    assert.ok(diff.diffText.includes('disingkat'));
  });
});
