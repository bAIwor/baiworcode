import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  renderTimelineCompact,
  renderTimelineByMode,
  resolveTimelineMode,
  TIMELINE_MODES,
} from '../src/chat/timeline.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sample = [
  { name: 'read_file', args: { path: 'src/chat/compact.js' }, durationMs: 120, output: 'a\nb\nc', success: true },
  { name: 'run_command', args: { command: 'npm test' }, durationMs: 1500, output: 'semua lulus', success: true },
];

describe('Timeline: Mode Compact (gaya CLI modern)', () => {
  it('harus mengembalikan string kosong untuk daftar kosong', () => {
    assert.equal(renderTimelineCompact([]), '');
    assert.equal(renderTimelineCompact(null), '');
    assert.equal(renderTimelineCompact([null, undefined]), '');
  });

  it('harus mencetak tepat satu baris per aktivitas (tanpa baris anak)', () => {
    const out = renderTimelineCompact(sample, { useColor: false });
    const lines = out.split('\n');
    assert.equal(lines.length, sample.length, 'setiap event harus satu baris');
    // Tidak ada baris lanjutan argumen/hasil seperti pada mode detail.
    assert.ok(!out.includes('src/chat/compact.js'), 'argumen tidak boleh dicetak di mode compact');
    assert.ok(!out.includes('semua lulus'), 'ringkasan hasil tidak boleh dicetak di mode compact');
  });

  it('harus memakai ├ untuk node non-terakhir dan └ untuk node terakhir', () => {
    const lines = renderTimelineCompact(sample, { useColor: false }).split('\n');
    assert.ok(lines[0].startsWith('  ├'), 'node pertama harus memakai ├');
    assert.ok(lines[1].startsWith('  └'), 'node terakhir harus memakai └');
  });

  it('harus menampilkan aktor Punakawan, nama tool, durasi, dan jumlah baris', () => {
    const out = renderTimelineCompact(sample, { useColor: false });
    assert.match(out, /pAItruk/);
    assert.match(out, /gAIreng/);
    assert.match(out, /Baca berkas/);
    assert.match(out, /Jalankan perintah/);
    assert.match(out, /120ms/);
    assert.match(out, /1\.5s/);
    assert.match(out, /3 baris/);
  });

  it('harus memakai pemisah titik-tengah di antara segmen', () => {
    const out = renderTimelineCompact(sample, { useColor: false });
    assert.ok(out.includes(' · '), 'segmen harus dipisahkan " · "');
  });

  it('harus menandai kegagalan dengan ✗ beserta alasan singkat', () => {
    const out = renderTimelineCompact(
      [
        {
          name: 'run_command',
          durationMs: 800,
          output: 'perintah ditolak oleh pengguna',
          success: false,
        },
      ],
      { useColor: false }
    );
    assert.ok(out.includes('✗'), 'kegagalan harus memakai ikon ✗');
    assert.ok(out.includes('perintah ditolak'), 'alasan kegagalan harus tampil di mode compact');
    assert.ok(!out.includes('✓'));
  });

  it('harus memakai frame spinner dan elipsis saat event masih berjalan', () => {
    const out = renderTimelineCompact([{ name: 'edit_file', running: true }], {
      useColor: false,
      spinnerFrame: '⠋',
    });
    assert.ok(out.includes('⠋'), 'event berjalan harus memakai frame spinner');
    assert.ok(out.includes('…'), 'event berjalan harus memakai elipsis sebagai durasi');
    assert.ok(!out.includes('ms'));
  });

  it('harus memakai extraMeta bila tersedia (mis. progres todo)', () => {
    const out = renderTimelineCompact([{ name: 'todo_list', durationMs: 2, success: true, extraMeta: '3/5 selesai' }], {
      useColor: false,
    });
    assert.ok(out.includes('3/5 selesai'));
  });

  it('tidak boleh menghasilkan escape ANSI saat useColor false', () => {
    const out = renderTimelineCompact(sample, { useColor: false });
    assert.equal(/\x1b\[[0-9;]*m/.test(out), false);
  });

  it('harus menghasilkan escape ANSI saat warna terminal diaktifkan', () => {
    // Chalk memutuskan level warna dari environment proses, jadi pemeriksaan
    // ini dijalankan di subprocess dengan FORCE_COLOR=1 (pola yang sama dipakai
    // test/help.test.js) — bukan di proses test yang tidak punya TTY.
    const script = `
      import('./src/chat/timeline.js').then((m) => {
        const out = m.renderTimelineCompact(
          [{ name: 'read_file', durationMs: 120, output: 'a\\nb\\nc', success: true }],
          { useColor: true }
        );
        process.stdout.write(String(/\\x1b\\[[0-9;]*m/.test(out)));
      });
    `;
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    assert.equal(result.trim(), 'true', 'mode compact harus berwarna saat warna aktif');
  });
});

describe('Timeline: resolveTimelineMode', () => {
  it('harus mengenali mode detail dan compact tanpa memandang besar-kecil huruf', () => {
    assert.equal(resolveTimelineMode('detail'), 'detail');
    assert.equal(resolveTimelineMode('compact'), 'compact');
    assert.equal(resolveTimelineMode('  COMPACT  '), 'compact');
  });

  it('harus jatuh ke fallback untuk nilai kosong atau tidak dikenal', () => {
    assert.equal(resolveTimelineMode(undefined), 'detail');
    assert.equal(resolveTimelineMode(''), 'detail');
    assert.equal(resolveTimelineMode('kocak'), 'detail');
    assert.equal(resolveTimelineMode('kocak', 'compact'), 'compact');
  });

  it('harus mengekspos daftar mode yang didukung', () => {
    assert.deepEqual([...TIMELINE_MODES], ['detail', 'compact']);
  });
});

describe('Timeline: renderTimelineByMode', () => {
  it('harus memakai renderer compact saat mode compact', () => {
    const out = renderTimelineByMode(sample, { mode: 'compact', useColor: false });
    assert.equal(out, renderTimelineCompact(sample, { useColor: false }));
  });

  it('harus memakai renderer detail saat mode detail', () => {
    const out = renderTimelineByMode(sample, { mode: 'detail', useColor: false });
    // Mode detail mencetak baris anak argumen, jadi jumlah baris lebih banyak.
    assert.ok(out.split('\n').length > sample.length);
  });

  it('harus jatuh ke mode detail untuk mode tak dikenal', () => {
    const out = renderTimelineByMode(sample, { mode: 'ngawur', useColor: false });
    assert.equal(out, renderTimelineByMode(sample, { mode: 'detail', useColor: false }));
  });
});

describe('Timeline: konfigurasi mode bawaan', () => {
  it('harus membawa timelineMode "detail" sebagai nilai awal config', async () => {
    const { DEFAULT_CONFIG } = await import('../src/config.js');
    assert.equal(DEFAULT_CONFIG.timelineMode, 'detail');
  });

  it('harus menerima /timeline sebagai perintah REPL', async () => {
    const { COMMANDS } = await import('../src/prompt.js');
    const entry = COMMANDS.find((c) => c.name === '/timeline');
    assert.ok(entry, 'perintah /timeline harus terdaftar di COMMANDS');
    assert.match(entry.desc, /compact/i);
    assert.match(entry.desc, /detail/i);
  });
});
