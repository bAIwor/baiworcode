import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectEol,
  toLF,
  locateAll,
  applyEdit,
  applyEditList,
  parseUnifiedDiff,
  applyUnifiedDiff,
} from '../src/tools/editUtil.js';

describe('editUtil: EOL & Normalisasi', () => {
  it('harus mendeteksi CRLF dan LF dengan tepat', () => {
    assert.equal(detectEol('baris satu\r\nbaris dua'), '\r\n');
    assert.equal(detectEol('baris satu\nbaris dua'), '\n');
    assert.equal(detectEol('satu baris'), '\n');
  });

  it('harus menormalisasi CRLF ke LF', () => {
    assert.equal(toLF('a\r\nb\r\nc'), 'a\nb\nc');
  });
});

describe('editUtil: locateAll & Pencocokan Bertingkat', () => {
  it('harus menemukan kecocokan persis', () => {
    const text = 'const x = 1;\nconst y = 2;\nconst x = 1;';
    const matches = locateAll(text, 'const x = 1;');
    assert.equal(matches.length, 2);
    assert.equal(matches[0].strategy, 'exact');
  });

  it('harus toleran terhadap perbedaan indentasi atau spasi ujung (fuzzy)', () => {
    const text = '  function halo() {\n    return true;\n  }';
    const needle = 'function halo() {\n  return true;\n}';
    const matches = locateAll(text, needle);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].strategy, 'fuzzy');
  });

  it('harus mengembalikan array kosong jika tidak ditemukan', () => {
    const text = 'console.log("hello");';
    assert.deepEqual(locateAll(text, 'tidak-ada'), []);
    assert.deepEqual(locateAll(text, ''), []);
  });
});

describe('editUtil: applyEdit', () => {
  it('harus mengganti kecocokan unik dan mempertahankan CRLF', () => {
    const text = 'baris 1\r\nbaris lama\r\nbaris 3';
    const res = applyEdit(text, 'baris lama', 'baris baru');
    assert.equal(res.ok, true);
    assert.equal(res.text, 'baris 1\r\nbaris baru\r\nbaris 3');
    assert.equal(res.count, 1);
  });

  it('harus menolak bila ada duplikasi dan replaceAll=false, menyertakan nomor baris', () => {
    const text = 'line 1\nulang\nline 3\nulang';
    const res = applyEdit(text, 'ulang', 'ganti');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'ambiguous');
    assert.equal(res.count, 2);
    assert.deepEqual(res.lines, [2, 4]);
  });

  it('harus menolak bila old_content identik dengan new_content (no-op)', () => {
    const text = 'const x = 10;';
    const res = applyEdit(text, 'const x = 10;', 'const x = 10;');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'identical');
  });

  it('harus mengganti semua bila replaceAll=true', () => {
    const text = 'ulang dan ulang';
    const res = applyEdit(text, 'ulang', 'ganti', { replaceAll: true });
    assert.equal(res.ok, true);
    assert.equal(res.text, 'ganti dan ganti');
    assert.equal(res.count, 2);
  });

  it('harus mengembalikan reason not-found bila tidak ditemukan', () => {
    const res = applyEdit('abc', 'xyz', '123');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'not-found');
  });
});

describe('editUtil: applyEditList (Multi-Edit Atomik)', () => {
  it('harus menerapkan serangkaian edit secara berurutan', () => {
    const text = 'const a = 1;\nconst b = 2;';
    const edits = [
      { old_content: 'const a = 1;', new_content: 'const a = 10;' },
      { old_content: 'const b = 2;', new_content: 'const b = 20;' },
    ];
    const res = applyEditList(text, edits);
    assert.equal(res.ok, true);
    assert.equal(res.text, 'const a = 10;\nconst b = 20;');
    assert.equal(res.count, 2);
  });

  it('harus membatalkan seluruh operasi bila ada salah satu edit yang gagal', () => {
    const text = 'const a = 1;\nconst b = 2;';
    const edits = [
      { old_content: 'const a = 1;', new_content: 'const a = 10;' },
      { old_content: 'tidak-ada', new_content: 'gagal' },
    ];
    const res = applyEditList(text, edits);
    assert.equal(res.ok, false);
    assert.equal(res.index, 1);
    assert.equal(res.reason, 'not-found');
  });
});

describe('editUtil: Unified Diff & Patching', () => {
  const diff = `--- a/file.js
+++ b/file.js
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 99;
 const z = 3;`;

  it('harus mengurai unified diff menjadi hunk', () => {
    const hunks = parseUnifiedDiff(diff);
    assert.equal(hunks.length, 1);
    assert.ok(hunks[0].old.includes('const y = 2;'));
    assert.ok(hunks[0].neu.includes('const y = 99;'));
  });

  it('harus menerapkan patch ke teks', () => {
    const original = 'const x = 1;\nconst y = 2;\nconst z = 3;';
    const res = applyUnifiedDiff(original, diff);
    assert.equal(res.ok, true);
    assert.equal(res.applied, 1);
    assert.equal(res.text, 'const x = 1;\nconst y = 99;\nconst z = 3;');
  });

  it('harus menolak patch bila hunk tidak cocok', () => {
    const mismatch = 'const a = 100;\nconst b = 200;';
    const res = applyUnifiedDiff(mismatch, diff);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'hunk-not-found');
  });
});
