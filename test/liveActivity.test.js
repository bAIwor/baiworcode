import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LiveActivity } from '../src/chat/liveActivity.js';

/**
 * Stream tiruan yang meniru TTY: menyimpan setiap potongan yang ditulis
 * supaya urutan escape code bisa diperiksa tanpa terminal sungguhan.
 */
function fakeTTY({ columns = 80 } = {}) {
  const chunks = [];
  return {
    isTTY: true,
    columns,
    chunks,
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    last() {
      return chunks[chunks.length - 1] || '';
    },
  };
}

describe('LiveActivity: Non-TTY', () => {
  it('harus nonaktif dan tidak menulis apa pun di luar TTY', () => {
    const stream = {
      isTTY: false,
      columns: 80,
      write() {
        throw new Error('tidak boleh menulis di luar TTY');
      },
    };
    const live = new LiveActivity({ stream });
    assert.equal(live.enabled, false);

    const idx = live.addTool('read_file', { path: 'a.js' });
    live.settleTool(idx, { durationMs: 5, output: 'ok', success: true });
    live.suspend();
    live.resume();
    live.commit();
    live.stop();
  });
});

describe('LiveActivity: Menggambar Blok', () => {
  it('harus menggambar node berjalan tanpa cursor-up pada gambar pertama', () => {
    const stream = fakeTTY();
    const live = new LiveActivity({ stream, useColor: false });
    live.addTool('read_file', { path: 'a.js' });

    const last = stream.last();
    assert.ok(last.startsWith('\x1b[J'), 'gambar pertama tidak boleh memindah kursor ke atas');
    assert.ok(last.includes('Baca berkas'));
    assert.ok(last.includes('⠋'), 'frame pertama harus tampil');
    assert.ok(last.includes('…'));
    live.stop();
  });

  it('harus memindah kursor ke atas sejumlah baris blok sebelum menggambar ulang', () => {
    const stream = fakeTTY();
    const live = new LiveActivity({ stream, useColor: false });
    live.addTool('read_file', {});
    const firstLines = live.renderedLines;

    live.addTool('search_files', {});
    assert.ok(
      stream.last().startsWith(`\x1b[${firstLines}A\x1b[J`),
      `harus naik ${firstLines} baris sebelum menghapus`
    );
    live.stop();
  });

  it('harus menampilkan centang dan durasi setelah tool selesai', () => {
    const stream = fakeTTY();
    const live = new LiveActivity({ stream, useColor: false });
    const idx = live.addTool('read_file', { path: 'a.js' });
    live.settleTool(idx, { durationMs: 120, output: 'isi berkas', success: true });

    const last = stream.last();
    assert.ok(last.includes('✓'));
    assert.ok(last.includes('120ms'));
    assert.ok(last.includes('1 baris'));
    live.stop();
  });

  it('harus memakai ikon silang untuk tool yang gagal', () => {
    const stream = fakeTTY();
    const live = new LiveActivity({ stream, useColor: false });
    const idx = live.addTool('run_command', { command: 'curl x' });
    live.settleTool(idx, { durationMs: 10, output: 'gagal', success: false });

    assert.ok(stream.last().includes('✗'));
    live.stop();
  });
});

describe('LiveActivity: Suspend/Resume', () => {
  it('harus menghapus blok saat suspend dan menggambarnya lagi saat resume', () => {
    const stream = fakeTTY();
    const live = new LiveActivity({ stream, useColor: false });
    live.addTool('run_command', { command: 'echo hai' });
    const drawn = live.renderedLines;
    assert.ok(drawn > 0);

    live.suspend();
    assert.equal(live.renderedLines, 0, 'penghitung direset setelah dihapus');
    assert.equal(stream.last(), `\x1b[${drawn}A\x1b[J`, 'suspend hanya menghapus blok');

    live.resume();
    assert.ok(stream.last().includes('Jalankan perintah'), 'resume menggambar ulang isi blok');
    live.stop();
  });

  it('harus ikut menghapus blok yang berjalan lewat animasi sebelum suspend', () => {
    const stream = fakeTTY();
    const live = new LiveActivity({ stream, useColor: false });
    live.addTool('search_files', { pattern: 'x' });
    live.addTool('search_files', { pattern: 'y' });
    const drawn = live.renderedLines;

    live.suspend();
    assert.equal(stream.last(), `\x1b[${drawn}A\x1b[J`);
    live.stop();
  });
});

describe('LiveActivity: Commit', () => {
  it('harus membiarkan tampilan akhir dan mereset status internal', () => {
    const stream = fakeTTY();
    const live = new LiveActivity({ stream, useColor: false });
    const idx = live.addTool('read_file', { path: 'a.js' });
    live.settleTool(idx, { durationMs: 3, output: 'ok', success: true });

    const before = stream.chunks.length;
    live.commit();

    assert.equal(live.events.length, 0);
    assert.equal(live.renderedLines, 0);
    assert.equal(stream.chunks.length, before, 'commit tidak mencetak apa pun lagi');
    assert.ok(stream.last().includes('Baca berkas'));
  });
});

describe('LiveActivity: Pemangkasan Lebar', () => {
  it('harus memangkas baris agar tidak membungkus melebihi lebar terminal', () => {
    const columns = 30;
    const stream = fakeTTY({ columns });
    const live = new LiveActivity({ stream, useColor: false, maxSummary: 200 });
    live.addTool('read_file', { path: 'sangat/panjang/sekali/jalur/berkas/agar/melampaui.js' });

    // Buang escape kontrol (termasuk `\x1b[J`) lalu ukur lebar tampak.
    const lines = stream.last().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\n');
    for (const line of lines) {
      assert.ok(line.length <= columns - 1, `baris ${line.length} > ${columns - 1}: ${line}`);
    }
    live.stop();
  });
});
