import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wrapText, visibleWidth, hangingIndent, stripAnsi, sanitizeTerminalText } from '../src/chat/wrapText.js';
import { createOutputWriter } from '../src/chat/outputWriter.js';

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const plain = (s) => String(s).replace(ANSI, '');

/** Stream tiruan: mengumpulkan seluruh tulisan tanpa menyentuh terminal. */
function fakeStream() {
  const chunks = [];
  return {
    written: chunks,
    write(s) {
      chunks.push(String(s));
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}

describe('sanitizeTerminalText: keamanan output', () => {
  it('membuang SGR, OSC (hyperlink/clipboard), dan escape tunggal', () => {
    assert.equal(sanitizeTerminalText('\x1b[31mMERAH\x1b[0m'), 'MERAH');
    assert.equal(sanitizeTerminalText('\x1b]8;;https://x.test\x1b\\Tautan\x1b]8;;\x1b\\'), 'Tautan');
    assert.equal(sanitizeTerminalText('awal\x1b]52;c;cGF5bG9hZA==\x07akhir'), 'awalakhir');
    assert.equal(sanitizeTerminalText('x\x1b'), 'x');
  });

  it('mempertahankan newline/tab dan membuang kontrol/bidi', () => {
    assert.equal(sanitizeTerminalText('a\r\nb\tc'), 'a\nb\tc');
    assert.equal(sanitizeTerminalText('a\u202eb'), 'ab');
    assert.equal(sanitizeTerminalText('a\u0000b'), 'ab');
  });
});

describe('wrapText: dasar', () => {
  it('tidak mengubah baris yang sudah muat', () => {
    assert.deepEqual(wrapText('halo lur', { width: 20 }), ['halo lur']);
  });

  it('memotong di batas kata, bukan di tengah karakter', () => {
    const out = wrapText('satu dua tiga empat lima', { width: 14 });
    assert.deepEqual(out, ['satu dua tiga', 'empat lima']);
  });

  it('setiap baris tidak melebihi lebar', () => {
    const out = wrapText('satu dua tiga empat lima enam tujuh delapan', { width: 15 });
    for (const line of out) assert.ok(visibleWidth(line) <= 15, `baris kepanjangan: ${line}`);
  });

  it('memotong paksa kata yang sendirian lebih panjang dari baris', () => {
    const out = wrapText('aaaaaaaaaaaaaaaaaaaaaa', { width: 8 });
    assert.deepEqual(out, ['aaaaaaaa', 'aaaaaaaa', 'aaaaaa']);
  });

  it('membuang spasi di awal baris lanjutan', () => {
    const out = wrapText('kata     panjang     sekali', { width: 12 });
    for (const line of out) assert.ok(!line.startsWith(' '), `dimulai spasi: "${line}"`);
  });

  it('mengembalikan satu baris kosong untuk input kosong', () => {
    assert.deepEqual(wrapText('', { width: 20 }), ['']);
    assert.deepEqual(wrapText(null, { width: 20 }), ['']);
  });

  it('menghitung lebar mengabaikan ANSI', () => {
    assert.equal(visibleWidth('\x1b[31mmerah\x1b[0m'), 5);
    assert.equal(visibleWidth('\x1b[1m\x1b[36mtebal cyan\x1b[0m'), 10);
    assert.equal(stripAnsi('\x1b[31mmerah\x1b[0m'), 'merah');
  });
});

describe('wrapText: aman ANSI', () => {
  it('tidak memotong escape code di tengah', () => {
    const out = wrapText('\x1b[36msatu dua tiga empat lima enam\x1b[0m', { width: 12 });
    for (const line of out) {
      // Tidak boleh ada escape yang menggantung tanpa penutup
      assert.ok(!/\x1b\[[0-9;]*$/.test(line), `escape terpotong: ${line}`);
    }
  });

  it('warna tetap tertutup di setiap baris', () => {
    const out = wrapText('\x1b[31msatu dua tiga empat lima enam tujuh\x1b[0m', { width: 14 });
    for (const line of out) {
      assert.match(line, /\x1b\[0m$/, `baris tidak ditutup: ${line}`);
    }
  });

  it('teks yang terlihat tetap sama setelah dibungkus', () => {
    const src = '\x1b[32msatu dua tiga empat lima enam tujuh delapan\x1b[0m';
    const out = wrapText(src, { width: 10 });
    // Spasi di titik potong digantikan newline, jadi bandingkan per kata.
    assert.equal(plain(out.join(' ')), plain(src));
  });
});

describe('hangingIndent', () => {
  it('mengenali butir daftar', () => {
    assert.equal(hangingIndent('• item pertama'), 2);
  });

  it('mengenali nomor daftar', () => {
    assert.equal(hangingIndent('1. item pertama'), 3);
    assert.equal(hangingIndent('12. item kedua'), 4);
  });

  it('mengenali kutipan', () => {
    assert.equal(hangingIndent('│ kutipan'), 2);
    assert.equal(hangingIndent('> kutipan'), 2);
  });

  it('mengembalikan 0 untuk paragraf biasa', () => {
    assert.equal(hangingIndent('paragraf biasa saja'), 0);
  });

  it('mengabaikan ANSI saat mengukur', () => {
    assert.equal(hangingIndent('\x1b[36m•\x1b[0m item'), 2);
  });
});

describe('createOutputWriter: indentasi baris lanjutan', () => {
  it('baris pendek tetap diindentasi 2 spasi', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 80 });
    w.write('halo\n');
    w.flush();
    assert.equal(s.text(), '  halo\n');
  });

  it('baris panjang dibungkus dengan indentasi yang sama di tiap baris', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 30 });
    w.write('satu dua tiga empat lima enam tujuh delapan sembilan\n');
    w.flush();
    const lines = s.text().split('\n').filter(Boolean);
    for (const line of lines) {
      assert.match(line, /^ {2}\S/, `baris tidak berindentasi: "${line}"`);
    }
  });

  it('tidak ada baris yang melebihi lebar terminal', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 40 });
    const text = Array.from({ length: 6 }, (_, i) => `kata${i}`).join(' ');
    w.write(`${text}\n`);
    w.flush();
    for (const line of s.text().split('\n')) {
      assert.ok(visibleWidth(line) <= 40, `kepanjangan (${visibleWidth(line)}): "${line}"`);
    }
  });

  it('baris lanjutan daftar disejajarkan dengan isi, bukan dengan penanda', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 34 });
    w.write('• daftar panjang yang harus dibungkus ke baris berikutnya\n');
    w.flush();
    const lines = s.text().split('\n').filter(Boolean);
    assert.ok(lines.length >= 2, 'harus terbagi menjadi beberapa baris');
    // Baris pertama: indent 2 + "• " = kolom 4
    assert.match(lines[0], /^ {2}• /);
    // Lanjutannya harus mulai di kolom 4, sejajar dengan teks setelah penanda
    assert.match(lines[1], /^ {4}\S/, `lanjutan tidak sejajar: "${lines[1]}"`);
  });

  it('baris lanjutan nomor daftar disejajarkan dengan isinya', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 34 });
    w.write('12. daftar bernomor yang cukup panjang untuk dibungkus\n');
    w.flush();
    const lines = s.text().split('\n').filter(Boolean);
    assert.match(lines[0], /^ {2}12\. /);
    // indent 2 + marker "12. " (4 kolom) = 6
    assert.match(lines[1], /^ {6}\S/, `lanjutan tidak sejajar: "${lines[1]}"`);
  });

  it('paragraf biasa tidak diberi hanging indent', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 30 });
    w.write('paragraf biasa yang panjang dan terpaksa dibungkus menjadi beberapa baris\n');
    w.flush();
    const lines = s.text().split('\n').filter(Boolean);
    assert.ok(lines.length >= 2);
    for (const line of lines) assert.match(line, /^ {2}\S/);
  });

  it('paragraf panjang tetap rata kiri di setiap baris lanjutan', () => {
    // Regresi: paragraf biasa (tanpa penanda daftar) dulu dicetak mentah dan
    // diserahkan ke terminal. Soft-wrap terminal kembali ke kolom 0, sehingga
    // hanya baris pertama berindentasi sementara sisanya mepet kiri.
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 80 });
    const paragraf =
      'Kalau memang tugasmu rutin butuh lebih banyak, batas ini bisa dinaikkan — tinggal ubah nilai MAX_AGENT_TURNS di baris 47. ' +
      'Tapi saran aku, naikkan sedang aja (misal 20), jangan 100+, karena kalau model benar-benar salah jalan kamu akan menunggu lama dan token terbuang.';
    w.write(`${paragraf}\n`);
    w.flush();

    const lines = s.text().split('\n').filter(Boolean);
    assert.ok(lines.length >= 2, `paragraf harus dibungkus, dapat ${lines.length} baris`);
    for (const line of lines) {
      assert.match(line, /^ {2}\S/, `baris lanjutan tidak rata kiri: "${line}"`);
      assert.ok(visibleWidth(line) <= 80, `baris melampaui lebar: "${line}"`);
    }
  });

  it('mempertahankan baris kosong tanpa indentasi', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 80 });
    w.write('paragraf satu\n\nparagraf dua\n');
    w.flush();
    assert.equal(s.text(), '  paragraf satu\n\n  paragraf dua\n');
  });
});

describe('createOutputWriter: perilaku streaming', () => {
  it('menyambung potongan kecil menjadi satu baris logis', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 80 });
    for (const part of ['hal', 'o lur', ' yang baik']) w.write(part);
    w.write('\n');
    w.flush();
    assert.equal(s.text(), '  halo lur yang baik\n');
  });

  it('membungkus baris yang tersebar di banyak potongan', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 30 });
    const text = 'satu dua tiga empat lima enam tujuh delapan sembilan\n';
    for (const ch of text) w.write(ch);
    w.flush();
    const lines = s.text().split('\n').filter(Boolean);
    assert.ok(lines.length >= 2);
    for (const line of lines) {
      assert.match(line, /^ {2}\S/);
      assert.ok(visibleWidth(line) <= 30);
    }
  });

  it('flush mencetak sisa buffer yang belum diakhiri newline', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 80 });
    w.write('tanpa newline');
    w.flush();
    assert.equal(s.text(), '  tanpa newline\n');
  });

  it('reset membuang buffer yang belum selesai', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 80 });
    w.write('baris belum selesai');
    w.reset();
    w.write('baris baru\n');
    w.flush();
    assert.equal(s.text(), '  baris baru\n');
  });

  it('writeVerbatim tidak memotong baris kode yang panjang', () => {
    // Baris kode harus tetap utuh walau melewati lebar terminal — memotong
    // kode lebih berbahaya daripada membiarkannya membungkus alami.
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 20 });
    w.writeVerbatim('const namaYangSangatPanjangSekali = 1;\n');
    // Tetap satu baris, dan berindentasi seperti baris jawaban lainnya.
    assert.equal(s.text(), '  const namaYangSangatPanjangSekali = 1;\n');
  });

  it('writeVerbatim tetap mengindentasi baris baru di dalam blok', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '  ', width: 80 });
    w.writeVerbatim('baris satu\nbaris dua\n');
    assert.equal(s.text(), '  baris satu\n  baris dua\n');
  });
});

describe('createOutputWriter: mode non-TTY', () => {
  it('indent kosong berarti pass-through murni', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '', width: 40 });
    const text = 'satu dua tiga empat lima enam tujuh delapan sembilan sepuluh\n';
    w.write(text);
    w.flush();
    assert.equal(s.text(), text);
  });

  it('tidak menambah newline pada flush tanpa indentasi', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '', width: 80 });
    w.write('tanpa newline');
    w.flush();
    assert.equal(s.text(), 'tanpa newline');
  });

  it('writeVerbatim tanpa indentasi menulis apa adanya', () => {
    const s = fakeStream();
    const w = createOutputWriter({ out: s, indent: '', width: 20 });
    w.writeVerbatim('a\nb\n');
    assert.equal(s.text(), 'a\nb\n');
  });
});
