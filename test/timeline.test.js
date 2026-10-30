import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration,
  countOutputLines,
  summarize,
  summarizeArgs,
  summarizeResult,
  renderTimeline,
  formatTodoProgress,
  renderTodoChecklist,
  toolColorHex,
  toolLabel,
  toolIcon,
  TOOL_LABELS,
  PUNAKAWAN_ROLES,
  PUNAKAWAN_COLORS,
} from '../src/chat/timeline.js';
import { palette } from '../src/theme.js';

describe('Timeline: Format Durasi', () => {
  it('harus menformat milidetik di bawah satu detik', () => {
    assert.equal(formatDuration(0), '1ms');
    assert.equal(formatDuration(1), '1ms');
    assert.equal(formatDuration(120), '120ms');
    assert.equal(formatDuration(999), '999ms');
  });

  it('harus menformat durasi di atas satu detik ke satuan detik', () => {
    assert.equal(formatDuration(1000), '1.0s');
    assert.equal(formatDuration(1500), '1.5s');
    assert.equal(formatDuration(12400), '12.4s');
    assert.equal(formatDuration(60000), '60.0s');
  });

  it('harus aman terhadap nilai tidak valid', () => {
    assert.equal(formatDuration(-5), '0ms');
    assert.equal(formatDuration(NaN), '0ms');
    assert.equal(formatDuration(undefined), '0ms');
    assert.equal(formatDuration(Infinity), '0ms');
  });

  it('tidak pernah membulatkan durasi nyata menjadi 0ms', () => {
    // Durasi sub-milidetik tetap harus menyatakan tool benar-benar berjalan.
    for (const ms of [0, 0.1, 0.4, 0.9]) {
      assert.notEqual(formatDuration(ms), '0ms');
    }
  });
});

describe('Timeline: Hitung Baris Output', () => {
  it('harus menghitung baris dan mengabaikan newline penutup', () => {
    assert.equal(countOutputLines('satu'), 1);
    assert.equal(countOutputLines('satu\ndua\ntiga'), 3);
    assert.equal(countOutputLines('satu\ndua\ntiga\n'), 3);
    assert.equal(countOutputLines('satu\ndua\ntiga\n\n\n'), 3);
  });

  it('harus mengembalikan 0 untuk keluaran kosong', () => {
    assert.equal(countOutputLines(''), 0);
    assert.equal(countOutputLines(null), 0);
    assert.equal(countOutputLines(undefined), 0);
    assert.equal(countOutputLines('\n\n\n'), 0);
  });

  it('harus mempertahankan baris kosong di tengah output', () => {
    assert.equal(countOutputLines('a\n\nb'), 3);
  });
});

describe('Timeline: Ringkasan Teks', () => {
  it('harus meratakan baris baru dan spasi berulang', () => {
    assert.equal(summarize('  halo   dunia  '), 'halo dunia');
    assert.equal(summarize('baris satu\nbaris dua'), 'baris satu baris dua');
    assert.equal(summarize('a\n\n\nb'), 'a b');
  });

  it('harus memotong teks panjang dan menandai dengan ellipsis', () => {
    const long = 'x'.repeat(200);
    const out = summarize(long, 20);
    assert.equal(out.length, 20);
    assert.ok(out.endsWith('…'));
  });

  it('harus mengembalikan string kosong untuk input kosong', () => {
    assert.equal(summarize(''), '');
    assert.equal(summarize('   \n  '), '');
    assert.equal(summarize(null), '');
  });
});

describe('Timeline: Ringkasan Argumen', () => {
  it('harus menampilkan argumen sebagai pasangan kunci-nilai', () => {
    assert.equal(summarizeArgs({ path: 'src/index.js' }), 'path: "src/index.js"');
  });

  it('harus menandai tanpa parameter jika objek kosong', () => {
    assert.equal(summarizeArgs({}), 'tanpa parameter');
  });

  it('harus membagi ruang ringkasan agar satu nilai besar tidak menelan baris', () => {
    const out = summarizeArgs({ pattern: 'a'.repeat(300), path: 'src' }, 40);
    assert.ok(out.length <= 40, `panjang ${out.length} melebihi 40`);
    assert.ok(out.includes('pattern:'));
    assert.ok(out.includes('path:'));
  });

  it('harus tetap menghasilkan sesuatu untuk banyak argumen', () => {
    const args = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
    const out = summarizeArgs(args, 40);
    assert.ok(out.length > 0);
    assert.ok(out.includes('a: 1'));
  });

  it('harus bertahan dari nilai yang tidak bisa di-stringify (siklik)', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    const out = summarizeArgs({ node: cyclic }, 60);
    assert.ok(typeof out === 'string' && out.length > 0);
  });

  it('harus menangani input non-objek tanpa melempar error', () => {
    assert.equal(summarizeArgs(null, 40), '');
    assert.equal(typeof summarizeArgs('teks', 40), 'string');
    assert.equal(typeof summarizeArgs([1, 2], 40), 'string');
  });
});

describe('Timeline: Ringkasan Hasil', () => {
  it('harus memakai baris pertama sebagai ringkasan', () => {
    assert.equal(summarizeResult('isi berkasnya di sini'), 'isi berkasnya di sini');
  });

  it('harus melewati baris pertama yang hanya penanda format', () => {
    // `read_file` diawali nomor baris pendek sebelum isi sebenarnya.
    assert.equal(summarizeResult('1\nconst a = 1;'), 'const a = 1;');
  });

  it('harus tidak melewati baris pertama yang cukup informatif', () => {
    assert.equal(summarizeResult('abc\nbaris kedua'), 'abc');
  });

  it('harus mengembalikan "selesai" untuk keluaran kosong', () => {
    assert.equal(summarizeResult(''), 'selesai');
    assert.equal(summarizeResult('   \n  '), 'selesai');
    assert.equal(summarizeResult(null), 'selesai');
  });

  it('harus meratakan keluaran satu baris', () => {
    // Hanya baris pertama yang dipakai sebagai ringkasan, tapi spasi
    // berlebihan di dalamnya tetap diratakan.
    assert.equal(summarizeResult('   1   import x\n   2   const a\n'), '1 import x');
  });
});

describe('Timeline: Render Pohon', () => {
  const sample = [
    {
      name: 'read_file',
      args: { path: 'src/index.js' },
      durationMs: 120,
      output: 'isi\nbaris\nkedua',
      success: true,
    },
    {
      name: 'search_files',
      args: { pattern: 'todo' },
      durationMs: 1500,
      output: '3 cocok',
      success: true,
    },
  ];

  it('harus mengembalikan string kosong untuk daftar kosong', () => {
    assert.equal(renderTimeline([]), '');
    assert.equal(renderTimeline(null), '');
    assert.equal(renderTimeline([null, undefined]), '');
  });

  it('harus memakai ├ untuk semua node kecuali yang terakhir', () => {
    const out = renderTimeline(sample, { useColor: false });
    const lines = out.split('\n').filter((l) => l.includes('✓'));
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('├'), 'node pertama harus memakai ├');
    assert.ok(lines[1].includes('└'), 'node terakhir harus memakai └');
  });

  it('harus menampilkan nama tool, durasi, dan jumlah baris output', () => {
    const out = renderTimeline(sample, { useColor: false });
    assert.match(out, /Baca berkas/);
    assert.match(out, /120ms/);
    assert.match(out, /3 baris/);
    assert.match(out, /1\.5s/);
    assert.match(out, /1 baris/);
  });

  it('harus menampilkan ringkasan argumen dan hasil', () => {
    const out = renderTimeline(sample, { useColor: false });
    assert.ok(out.includes('path: "src/index.js"'));
    assert.ok(out.includes('3 cocok'));
  });

  it('harus memakai ikon silang dan emphasizes nama untuk tool yang gagal', () => {
    const out = renderTimeline(
      [{ name: 'run_command', args: {}, durationMs: 5, output: 'perintah ditolak', success: false }],
      { useColor: false }
    );
    assert.ok(out.includes('✗'));
    assert.ok(!out.includes('✓'));
    assert.ok(out.includes('perintah ditolak'));
  });

  it('harus memakai stem │ pada baris lanjutan node non-terakhir', () => {
    const out = renderTimeline(sample, { useColor: false });
    const lines = out.split('\n');
    const idx = lines.findIndex((l) => l.includes('Baca berkas'));
    assert.ok(lines[idx + 1].includes('│'), 'baris lanjutan node pertama harus memakai │');
  });

  it('harus tidak menghasilkan escape code ANSI saat useColor false', () => {
    const out = renderTimeline(sample, { useColor: false });
    // eslint-disable-next-line no-control-regex
    assert.equal(/\x1b\[/.test(out), false, 'output non-warna tidak boleh memuat escape ANSI');
  });

  it('harus menangani event tanpa output maupun argumen', () => {
    const out = renderTimeline(
      [{ name: 'todo_list', args: undefined, durationMs: 3, output: '', success: true }],
      { useColor: false }
    );
    assert.ok(out.includes('Daftar tugas'));
    assert.ok(out.includes('selesai'));
    // Baris kosong di ekor tidak boleh muncul.
    assert.equal(out.endsWith('\n'), false);
  });

  it('harus menyaring event null di tengah daftar', () => {
    const out = renderTimeline([sample[0], null, sample[1]], { useColor: false });
    assert.ok(out.includes('Baca berkas'));
    assert.ok(out.includes('Cari berkas'));
  });

  it('harus menandai node yang berjalan dengan frame spinner dan durasi …', () => {
    const out = renderTimeline(
      [{ name: 'run_command', args: { command: 'echo hai' }, running: true }],
      { useColor: false, spinnerFrame: '⠹' }
    );
    assert.ok(out.includes('⠹'));
    assert.ok(!out.includes('✓'));
    assert.ok(!out.includes('✗'));
    assert.ok(out.includes('…'));
    // Argumen tetap tampil agar konteks langkah yang berjalan terbaca.
    assert.ok(out.includes('command: "echo hai"'));
    // Belum ada hasil, jadi ringkasan default "selesai" tidak boleh muncul.
    assert.ok(!out.includes('selesai'));
  });

  it('harus memakai cabang └ pada node berjalan terakhir lalu bergeser saat bertambah', () => {
    const first = renderTimeline([{ name: 'a', running: true }], { useColor: false }).split('\n')[0];
    assert.ok(first.includes('└'));

    const two = renderTimeline([{ name: 'a', durationMs: 10, output: 'ok' }, { name: 'b', running: true }], {
      useColor: false,
    }).split('\n');
    assert.ok(two[0].includes('├'), 'node selesai sebelum yang berjalan harus memakai ├');
    assert.ok(two.find((l) => l.includes('⠋')).includes('└'));
  });
});

describe('Timeline: Warna Tool', () => {
  it('harus memetakan tool ke warna kategori palet tema bAIwor Code', () => {
    // read = info, write/edit = success, run = error (bawor crimson),
    // list/search = secondary, todo = warning (punakawan gold).
    assert.equal(toolColorHex('read_file'), palette.info);
    assert.equal(toolColorHex('write_file'), palette.success);
    assert.equal(toolColorHex('edit_file'), palette.success);
    assert.equal(toolColorHex('run_command'), palette.error);
    assert.equal(toolColorHex('list_directory'), palette.secondary);
    assert.equal(toolColorHex('search_files'), palette.secondary);
    assert.equal(toolColorHex('todo_list'), palette.warning);
    assert.equal(toolColorHex('patch_file'), palette.success);
    assert.equal(toolColorHex('webfetch'), palette.info);
    assert.equal(toolColorHex('websearch'), palette.secondary);
    assert.equal(toolColorHex('diagnostics'), palette.warning);
  });

  it('harus memakai warna cadangan untuk tool tak dikenal', () => {
    assert.match(toolColorHex('tool_ajaib'), /^#[0-9A-Fa-f]{6}$/);
    assert.equal(toolColorHex(undefined), toolColorHex('tool_ajaib'));
  });
});

describe('Timeline: Progres Daftar Tugas', () => {
  const daftar = [
    { id: '1', content: 'Pertama', status: 'completed' },
    { id: '2', content: 'Kedua', status: 'completed' },
    { id: '3', content: 'Ketiga', status: 'completed' },
    { id: '4', content: 'Keempat', status: 'in_progress' },
    { id: '5', content: 'Kelima', status: 'pending' },
  ];

  it('harus menghitung item selesai dari total', () => {
    assert.equal(formatTodoProgress(daftar), '3/5 selesai');
  });

  it('harus mengembalikan string kosong untuk daftar kosong', () => {
    assert.equal(formatTodoProgress([]), '');
    assert.equal(formatTodoProgress(null), '');
  });

  it('harus menghitung item dibatalkan tetap masuk total', () => {
    const withCancelled = [...daftar, { id: '6', content: 'Batal', status: 'cancelled' }];
    assert.equal(formatTodoProgress(withCancelled), '3/6 selesai');
  });
});

describe('Timeline: Render Checklist Tugas', () => {
  const daftar = [
    { id: '1', content: 'Baca struktur proyek', status: 'completed' },
    { id: '2', content: 'Buat modul timeline', status: 'in_progress' },
    { id: '3', content: 'Update README', status: 'pending' },
    { id: '4', content: 'Batalkan Ide Lama', status: 'cancelled' },
  ];

  it('harus mengembalikan string kosong bila tidak ada item', () => {
    assert.equal(renderTodoChecklist([], { useColor: false }), '');
    assert.equal(renderTodoChecklist(null, { useColor: false }), '');
  });

  it('harus memakai ikon berbeda untuk tiap status', () => {
    const out = renderTodoChecklist(daftar, { useColor: false });
    assert.match(out, /✓ Baca struktur proyek/);
    assert.match(out, /◐ Buat modul timeline/);
    assert.match(out, /○ Update README/);
    assert.match(out, /✗ Batalkan Ide Lama/);
  });

  it('harus menangani status yang tidak dikenal sebagai pending', () => {
    const out = renderTodoChecklist([{ id: '1', content: 'A', status: 'ngawur' }], {
      useColor: false,
    });
    assert.match(out, /○ A/);
  });

  it('harus mengurutkan keluaran sesuai urutan daftar', () => {
    const out = renderTodoChecklist(daftar, { useColor: false }).split('\n');
    assert.equal(out.length, 4);
    assert.ok(out[0].includes('Baca struktur proyek'));
    assert.ok(out[3].includes('Batalkan Ide Lama'));
  });

  it('harus memotong content yang sangat panjang', () => {
    // TodoStore mengizinkan 4000 karakter per item; terminal tidak bisa menampilkannya.
    const out = renderTodoChecklist([{ id: '1', content: 'x'.repeat(3000), status: 'pending' }], {
      useColor: false,
      maxItem: 40,
    });
    // `maxItem` membatasi isi item; ikon + spasi menambah dua karakter di depannya.
    const body = out.slice(2);
    assert.ok(body.length <= 40, `panjang isi ${body.length} melebihi 40`);
    assert.ok(body.endsWith('…'));
  });

  it('harus mengindentasi item anak mengikuti rantai parent', () => {
    const bersarang = [
      { id: '1', content: 'Induk', status: 'pending' },
      { id: '2', content: 'Anak', status: 'pending', parent: '1' },
      { id: '3', content: 'Cucu', status: 'pending', parent: '2' },
    ];
    const out = renderTodoChecklist(bersarang, { useColor: false }).split('\n');
    assert.ok(out[0].startsWith('○ Induk'));
    assert.ok(out[1].startsWith('  ○ Anak'), 'anak harus menjorok dua spasi');
    assert.ok(out[2].startsWith('    ○ Cucu'), 'cucu harus menjorok empat spasi');
  });

  it('harus bertahan dari rantai parent yang siklis', () => {
    const siklis = [
      { id: '1', content: 'A', status: 'pending', parent: '2' },
      { id: '2', content: 'B', status: 'pending', parent: '1' },
    ];
    const out = renderTodoChecklist(siklis, { useColor: false });
    assert.equal(out.split('\n').length, 2);
  });

  it('harus tetap merender item tanpa content tanpa melempar error', () => {
    const out = renderTodoChecklist([{ id: '1', status: 'pending' }], { useColor: false });
    assert.equal(out, '○ ');
  });

  it('harus menyaring item null dan tidak melempar error', () => {
    const out = renderTodoChecklist([daftar[0], null, undefined, daftar[2]], { useColor: false });
    assert.equal(out.split('\n').length, 2);
  });

  it('harus tidak menghasilkan escape ANSI saat useColor false', () => {
    const out = renderTodoChecklist(daftar, { useColor: false });
    // eslint-disable-next-line no-control-regex
    assert.equal(/\x1b\[/.test(out), false, 'checklist non-warna tidak boleh memuat escape ANSI');
  });
});

describe('Timeline: Integrasi Detail ke Pohon', () => {
  const event = {
    name: 'todo_list',
    args: { todos: '(3 item)' },
    durationMs: 2,
    output: '{\n  "todos": [\n    { "id": "1" }\n  ]\n}',
    success: true,
    detail: '✓ Satu\n◐ Dua\n○ Tiga',
    extraMeta: '1/3 selesai',
  };

  it('harus memakai detail sebagai pengganti ringkasan args dan hasil', () => {
    const out = renderTimeline([event], { useColor: false });
    assert.ok(out.includes('✓ Satu'));
    assert.ok(out.includes('◐ Dua'));
    assert.ok(out.includes('○ Tiga'));
    // Ringkasan args/hasil harus hilang — tidak lagi menampilkan JSON mentah.
    assert.ok(!out.includes('todos: "(3 item)"'));
    assert.ok(!out.includes('"todos": ['));
  });

  it('harus menampilkan extraMeta di baris judul', () => {
    const out = renderTimeline([event], { useColor: false });
    const head = out.split('\n')[0];
    assert.ok(head.includes('1/3 selesai'));
  });

  it('harus menjorok seluruh baris detail selaras dengan batang pohon', () => {
    const out = renderTimeline([event], { useColor: false }).split('\n');
    assert.ok(out[1].startsWith('        ✓ Satu'), `baris: ${JSON.stringify(out[1])}`);
    assert.ok(out[2].startsWith('        ◐ Dua'));
    assert.ok(out[3].startsWith('        ○ Tiga'));
  });

  it('harus tetap memakai ringkasan biasa bila detail kosong', () => {
    const out = renderTimeline([{ ...event, detail: undefined, extraMeta: undefined }], {
      useColor: false,
    });
    assert.ok(out.includes('todos: "(3 item)"'));
  });

  it('harus mengabaikan detail kosong string', () => {
    const out = renderTimeline([{ ...event, detail: '' }], { useColor: false });
    assert.ok(out.includes('todos: "(3 item)"'));
  });
});

describe('Timeline: Tim Punakawan AI (Aktor & Penamaan)', () => {
  it('harus memetakan peran tool ke karakter Punakawan yang tepat', () => {
    assert.equal(PUNAKAWAN_ROLES.read_file, 'pAItruk');
    assert.equal(PUNAKAWAN_ROLES.list_directory, 'pAItruk');
    assert.equal(PUNAKAWAN_ROLES.search_files, 'pAItruk');
    assert.equal(PUNAKAWAN_ROLES.write_file, 'bAIwor');
    assert.equal(PUNAKAWAN_ROLES.edit_file, 'bAIwor');
    assert.equal(PUNAKAWAN_ROLES.run_command, 'gAIreng');
    assert.equal(PUNAKAWAN_ROLES.todo_list, 'semAIr');
    assert.equal(PUNAKAWAN_ROLES.patch_file, 'bAIwor');
    assert.equal(PUNAKAWAN_ROLES.webfetch, 'pAItruk');
    assert.equal(PUNAKAWAN_ROLES.websearch, 'pAItruk');
    assert.equal(PUNAKAWAN_ROLES.diagnostics, 'gAIreng');
  });

  it('harus memuat warna khas untuk setiap anggota Punakawan', () => {
    assert.ok(PUNAKAWAN_COLORS.semAIr);
    assert.ok(PUNAKAWAN_COLORS.bAIwor);
    assert.ok(PUNAKAWAN_COLORS.pAItruk);
    assert.ok(PUNAKAWAN_COLORS.gAIreng);
  });

  it('harus menampilkan nama karakter Punakawan di samping nama tool pada timeline', () => {
    const sample = [
      { name: 'read_file', args: { path: 'a.js' }, durationMs: 10, success: true },
      { name: 'write_file', args: { path: 'b.js' }, durationMs: 20, success: true },
      { name: 'run_command', args: { command: 'npm test' }, durationMs: 30, success: true },
      { name: 'todo_list', args: {}, durationMs: 5, success: true },
    ];
    const out = renderTimeline(sample, { useColor: false });
    assert.ok(out.includes('pAItruk · 📖 Baca berkas'));
    assert.ok(out.includes('bAIwor · 📝 Tulis berkas'));
    assert.ok(out.includes('gAIreng · ⚡ Jalankan perintah'));
    assert.ok(out.includes('semAIr · 📋 Daftar tugas'));
  });

  it('harus menghormati ev.actor kustom (misal bAIwor sebagai tokoh utama loop utama)', () => {
    const sample = [
      { name: 'read_file', actor: 'bAIwor', args: { path: 'a.js' }, durationMs: 10, success: true },
      { name: 'run_command', actor: 'bAIwor', args: { command: 'git status' }, durationMs: 20, success: true },
    ];
    const out = renderTimeline(sample, { useColor: false });
    assert.ok(out.includes('bAIwor · 📖 Baca berkas'));
    assert.ok(out.includes('bAIwor · ⚡ Jalankan perintah'));
  });

  it('harus tetap menyertakan nama karakter Punakawan saat tool gagal', () => {
    const out = renderTimeline(
      [{ name: 'run_command', args: {}, durationMs: 5, output: 'gagal', success: false }],
      { useColor: false }
    );
    assert.ok(out.includes('gAIreng · ⚡ Jalankan perintah'));
    assert.ok(out.includes('✗'));
  });

  it('harus tetap menyertakan nama karakter Punakawan saat tool sedang berjalan', () => {
    const out = renderTimeline(
      [{ name: 'search_files', args: { pattern: 'test' }, running: true }],
      { useColor: false }
    );
    assert.ok(out.includes('pAItruk · 🔍 Cari berkas'));
    assert.ok(out.includes('…'));
  });
});

describe('Timeline: Nama Tampilan Tool (Indonesia ramah)', () => {
  it('harus memetakan tiap tool ke label yang ramah', () => {
    assert.equal(toolLabel('read_file'), 'Baca berkas');
    assert.equal(toolLabel('write_file'), 'Tulis berkas');
    assert.equal(toolLabel('edit_file'), 'Ubah berkas');
    assert.equal(toolLabel('list_directory'), 'Lihat folder');
    assert.equal(toolLabel('search_files'), 'Cari berkas');
    assert.equal(toolLabel('run_command'), 'Jalankan perintah');
    assert.equal(toolLabel('todo_list'), 'Daftar tugas');
    assert.equal(toolLabel('patch_file'), 'Terapkan patch');
    assert.equal(toolLabel('webfetch'), 'Ambil halaman');
    assert.equal(toolLabel('websearch'), 'Cari di web');
    assert.equal(toolLabel('diagnostics'), 'Periksa mutu');
    assert.equal(toolLabel('typesafe_ask'), 'Tanya TypeSafe');
  });

  it('harus jatuh ke nama teknis untuk tool yang tak dikenal', () => {
    assert.equal(toolLabel('tool_ajaib'), 'tool_ajaib');
    assert.equal(TOOL_LABELS.tool_ajaib, undefined);
  });

  it('harus menampilkan label ramah, bukan nama teknis, di timeline', () => {
    const out = renderTimeline(
      [{ name: 'read_file', args: { path: 'a.js' }, durationMs: 10, success: true, output: 'ok' }],
      { useColor: false }
    );
    assert.ok(out.includes('Baca berkas'));
    assert.ok(!out.includes('read_file'));
  });
});

describe('Timeline: Ikon Semantik Tool', () => {
  it('harus memetakan ikon tool bawaan, MCP, dan fallback', () => {
    assert.equal(toolIcon('read_file'), '📖');
    assert.equal(toolIcon('typesafe_ask'), '🧠');
    assert.equal(toolIcon('mcp_tinyfish_search'), '🐟');
    assert.equal(toolIcon('tool_ajaib'), '🔧');
    assert.equal(toolIcon(null), '🔧');
  });

  it('harus menampilkan ikon + label TypeSafe di timeline', () => {
    const out = renderTimeline(
      [{ name: 'typesafe_ask', args: {}, durationMs: 5, success: true, output: '{}' }],
      { useColor: false }
    );
    assert.ok(out.includes('🧠 Tanya TypeSafe'));
    assert.ok(!out.includes('typesafe_ask'));
  });
});

