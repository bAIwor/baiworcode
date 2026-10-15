import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import chalk from 'chalk';
import { AnswerStyler } from '../src/chat/answerStyle.js';

chalk.level = 3; // pastikan ANSI benar-benar dihasilkan saat pengujian

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const plain = (s) => String(s).replace(ANSI, '');

/** Jalankan input utuh lalu kembalikan teks yang terlihat (tanpa ANSI). */
const render = (input) => {
  const st = new AnswerStyler({ useColor: true });
  return plain(st.push(input) + st.flush());
};

/** Jalankan input dengan potongan-potongan (meniru streaming token). */
const renderChunked = (input, size) => {
  const st = new AnswerStyler({ useColor: true });
  let acc = '';
  for (let i = 0; i < input.length; i += size) acc += st.push(input.slice(i, i + size));
  return plain(acc + st.flush());
};

describe('AnswerStyler: markdown inline', () => {
  it('menyembunyikan penanda **tebal**', () => {
    assert.equal(render('**Identitas**\n'), 'Identitas\n');
  });

  it('menyembunyikan penanda *miring*', () => {
    assert.equal(render('a *miring* b\n'), 'a miring b\n');
  });

  it('menyembunyikan backtick kode sebaris', () => {
    assert.equal(render('pakai `read_file` ya\n'), 'pakai read_file ya\n');
  });

  it('membiarkan tanda bintang literal (bukan markdown)', () => {
    assert.equal(render('2 * 3 = 6\n'), '2 * 3 = 6\n');
  });

  it('tidak menganggap garis bawah di tengah kata sebagai miring', () => {
    assert.equal(render('**edit_file**\n'), 'edit_file\n');
    assert.equal(render('jalankan write_file sekarang\n'), 'jalankan write_file sekarang\n');
    assert.equal(render('foo_bar_baz\n'), 'foo_bar_baz\n');
  });

  it('tetap menganggap _miring_ di batas kata sebagai miring', () => {
    assert.equal(render('_miring_ kata\n'), 'miring kata\n');
  });
});

describe('AnswerStyler: struktur baris', () => {
  it('mengganti butir - menjadi •', () => {
    assert.equal(render('- satu\n- dua\n'), '• satu\n• dua\n');
  });

  it('mempertahankan nomor daftar', () => {
    assert.equal(render('1. satu\n2. dua\n'), '1. satu\n2. dua\n');
  });

  it('menyembunyikan penanda judul ##', () => {
    assert.equal(render('## Judul Bab\n'), 'Judul Bab\n');
  });

  it('mengganti kutipan > menjadi garis │', () => {
    assert.equal(render('> kutipan\n'), '│ kutipan\n');
  });
});

describe('AnswerStyler: blok kode', () => {
  const input = '```js\nconst x = 1; // komentar\nreturn x;\n```\n';

  it('menjaga isi blok kode tetap utuh', () => {
    assert.equal(render(input), '```js\nconst x = 1; // komentar\nreturn x;\n```\n');
  });

  it('memberi warna pada token kode (ada ANSI)', () => {
    const st = new AnswerStyler({ useColor: true });
    const out = st.push(input) + st.flush();
    assert.ok(ANSI.test(out), 'blok kode seharusnya mengandung warna');
  });
});

describe('AnswerStyler: sifat streaming', () => {
  it('hasil identik apa pun ukuran potongannya', () => {
    const input = [
      '## Ringkasan',
      'Jawaban **penting** pakai `edit_file`.',
      '- poin satu',
      '- poin dua',
      '',
      '```py',
      'def f(x):',
      '    return x * 2  # dobel',
      '```',
      'Selesai *iya*.',
      '',
    ].join('\n');
    const base = render(input);
    for (const size of [1, 2, 3, 5, 7, 13, 64]) {
      assert.equal(renderChunked(input, size), base, `beda pada ukuran ${size}`);
    }
  });

  it('tidak pernah memuntahkan "undefined" atau bocor state', () => {
    const st = new AnswerStyler({ useColor: true });
    const out = st.push('**a**\n') + st.push('`b`') + st.flush();
    assert.ok(!out.includes('undefined'));
    assert.equal(plain(out), 'a\nb');
  });
});

describe('AnswerStyler: mode polos', () => {
  it('mengembalikan input apa adanya saat useColor=false', () => {
    const st = new AnswerStyler({ useColor: false });
    const input = '**tebal** dan `kode`\n';
    assert.equal(st.push(input) + st.flush(), input);
  });
});
