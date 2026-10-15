import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildPromptFrame, COMMANDS } from '../src/prompt.js';
import { renderStatusLine, statusRule, terminalWidth } from '../src/statusLine.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO_ROOT, 'bin', 'baiwor.js');

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const polos = (s) => String(s).replace(ANSI, '');

const PLACEHOLDER = 'Ask bAIwor Code to do anything...';

const render = (value = '', state = 'initial', extra = {}) =>
  polos(buildPromptFrame({ value, state, placeholder: PLACEHOLDER, ...extra }));

describe('StatusLine: Helper', () => {
  it('harus mengembalikan lebar terminal yang masuk akal', () => {
    const w = terminalWidth();
    assert.ok(w >= 40, `lebar ${w} di bawah batas minimum`);
    assert.ok(w <= 200);
  });

  it('harus menggambar garis sesuai lebar terminal', () => {
    assert.equal(polos(statusRule()).length, terminalWidth());
  });

  it('harus menghormati indentasi garis tanpa mengubah panjang total', () => {
    const rule = polos(statusRule({ indent: '    ' }));
    assert.ok(rule.startsWith('    '));
    assert.equal(rule.length, terminalWidth());
  });

  it('harus menyusun baris status lengkap', () => {
    const line = polos(renderStatusLine());
    assert.match(line, /^\s+~\s+│\s+Full access\s+│/);
    assert.match(line, /✦/);
    assert.match(line, /Context \d+% left/);
  });

  it('harus menyisipkan prefix tugas bila diberikan', () => {
    assert.match(polos(renderStatusLine({ prefix: 'Explore baiworcode' })), /Explore baiworcode/);
  });

  it('harus tetap menampilkan indikator konteks walau model belum dikonfigurasi', () => {
    assert.match(polos(renderStatusLine()), /Context \d+% left/);
  });
});

describe('Prompt: Layout Area Input', () => {
  it('harus menggambar garis atas sebelum baris input', () => {
    assert.match(render().split('\n')[0], /^─+$/);
  });

  it('harus menggambar input dengan indentasi dan dua spasi setelah ›', () => {
    assert.match(render().split('\n')[1], /^ {2}› {2}Ask bAIwor Code to do anything\.\.\.$/);
  });

  it('harus menggambar garis bawah setelah input', () => {
    const idx = render().split('\n').findIndex((l) => /^ {4}─+$/.test(l));
    assert.ok(idx > 1, 'garis bawah harus ada setelah baris input');
  });

  it('kedua garis harus punya jumlah tanda pisah yang sama', () => {
    // Regresi: garis atas dulu selebar penuh sementara garis bawah dikurangi
    // indentasinya, sehingga keduanya terlihat tidak sama meskipun staircasenya tetap.
    const lines = render().split('\n');
    const atas = (lines[0].match(/─/g) || []).length;
    const bawah = (lines.find((l) => /^ {4}─+$/.test(l)).match(/─/g) || []).length;
    assert.equal(atas, bawah, `garis atas ${atas} tanda, garis bawah ${bawah}`);
    assert.ok(atas > 10, 'garis harus punya tanda pisah yang berarti');
  });

  it('garis bawah harus bergeser tepat empat kolom ke kanan', () => {
    const lines = render().split('\n');
    assert.ok(lines[0].startsWith('─'), 'garis atas harus mulai di kolom 0');
    assert.ok(lines[2].startsWith('    ─'), 'garis bawah harus bergeser empat spasi');
  });

  it('harus menyisipkan satu baris kosong sebelum baris status', () => {
    const lines = render().split('\n');
    const idx = lines.findIndex((l) => /^ {4}─+$/.test(l));
    assert.equal(lines[idx + 1], '', 'harus ada baris kosong setelah garis bawah');
    assert.match(lines[idx + 2], /~\s+│\s+Full access/);
  });

  it('harus menampilkan baris status sebagai baris terakhir', () => {
    const lines = render().split('\n');
    assert.match(lines[lines.length - 1], /Context \d+% left/);
  });

  it('harus menampilkan teks yang diketik pengguna di input', () => {
    assert.match(render('perbaiki error di src/index.js').split('\n')[1], /perbaiki error di src\/index\.js/);
  });

  it('harus menggambar status juga saat state submit', () => {
    const lines = render('sudah selesai', 'submit').split('\n');
    assert.match(lines[1], /sudah selesai/);
    assert.match(lines[lines.length - 1], /Context \d+% left/);
  });

  it('harus menggambar status juga saat state cancel', () => {
    const lines = render('batal', 'cancel').split('\n');
    assert.match(lines[lines.length - 1], /Context \d+% left/);
  });

  it('harus menggambar struktur sama saat input kosong maupun terisi', () => {
    assert.equal(render('').split('\n').length, render('halo').split('\n').length);
  });
});

describe('Prompt: Dropdown Perintah', () => {
  it('harus membuka dropdown hanya saat input diawali slash', () => {
    assert.ok(!render('halo', 'initial', { dropdownOpen: true }).includes('╭─ Perintah'));
    assert.ok(render('/he', 'initial', { dropdownOpen: true }).includes('╭─ Perintah'));
  });

  it('harus menyaring perintah sesuai yang diketik', () => {
    const out = render('/he', 'initial', { dropdownOpen: true });
    assert.ok(out.includes('/help'));
    assert.ok(!out.includes('/logout'), 'perintah yang tidak cocok tidak boleh muncul');
  });

  it('harus menandai perintah terpilih dengan ❯', () => {
    const out = render('/m', 'initial', { dropdownOpen: true, selectedIndex: 1 });
    const baris = out.split('\n').filter((l) => l.includes('❯'));
    assert.equal(baris.length, 1);
  });

  it('harus menampilkan pesan saat tidak ada perintah yang cocok', () => {
    const out = render('/zzz', 'initial', { dropdownOpen: true });
    assert.ok(out.includes('Tidak ada perintah yang cocok'));
  });

  it('harus tetap menggambar garis bawah dan status di balik dropdown', () => {
    const lines = render('/he', 'initial', { dropdownOpen: true }).split('\n');
    assert.ok(lines.findIndex((l) => /^ {4}─+$/.test(l)) > 0);
    assert.match(lines[lines.length - 1], /Context \d+% left/);
  });

  it('harus menormalkan indeks di luar jangkauan tanpa melempar error', () => {
    const out = render('/m', 'initial', { dropdownOpen: true, selectedIndex: 99 });
    assert.equal(out.split('\n').filter((l) => l.includes('❯')).length, 1);
  });

  it('harus tidak menggambar dropdown pada state submit meski flag terbuka', () => {
    const out = render('/help', 'submit', { dropdownOpen: true });
    assert.ok(!out.includes('╭─ Perintah'));
  });
});

describe('Prompt: Kebersihan Keluaran', () => {
  it('tidak boleh membocorkan undefined atau [object Object]', () => {
    for (const state of ['initial', 'submit', 'cancel']) {
      const out = render('/he', state, { dropdownOpen: true });
      assert.ok(!out.includes('undefined'), `state ${state} memuat "undefined"`);
      assert.ok(!out.includes('[object Object]'));
    }
  });

  it('harus tetap valid saat dipanggil tanpa argumen sama sekali', () => {
    const out = polos(buildPromptFrame());
    assert.match(out.split('\n')[0], /^─+$/);
    assert.match(out, /Context \d+% left/);
  });
});

describe('StatusLine: Penyesuaian Lebar Terminal', () => {
  const lebarTampil = (s) => [...polos(s)].length;

  it('harus tidak pernah melewati lebar terminal pada lebar mana pun', () => {
    // `@clack/core` membungkus frame dengan `hard: true`, jadi satu karakter
    // kelebihan akan membuat baris patah dan seluruh kotak ikut hancur.
    for (let w = 30; w <= 160; w += 1) {
      const line = polos(renderStatusLine({ maxWidth: w }));
      assert.ok(
        lebarTampil(line) <= w,
        `lebar ${w} -> baris memakai ${lebarTampil(line)} kolom`
      );
    }
  });

  it('harus melangkah bertahap saat lebar bertambah', () => {
    const sempit = polos(renderStatusLine({ maxWidth: 55 }));
    const lega = polos(renderStatusLine({ maxWidth: 140 }));
    assert.ok(lebarTampil(sempit) < lebarTampil(lega), 'versi sempit harus lebih pendek');
  });

  it('harus mengorbankan rincian token lebih dulu', () => {
    assert.match(polos(renderStatusLine({ maxWidth: 140 })), /≈ .* token/);
    assert.ok(!polos(renderStatusLine({ maxWidth: 75 })).includes('token'));
  });

  it('harus mengorbankan provider lebih dulu daripada nama model', () => {
    const sempit = polos(renderStatusLine({ maxWidth: 60 }));
    assert.ok(sempit.includes('step-5-preview'), 'nama model harus bertahan');
    assert.ok(!sempit.includes('StepFun'), 'provider boleh hilang dulu');
  });

  it('harus memakai bentuk paling ringkas saat sangat sempit', () => {
    const sangat = polos(renderStatusLine({ maxWidth: 30 }));
    assert.match(sangat, /Context \d+% left/);
    assert.ok(!sangat.includes('Full access'));
  });

  it('harus memangkas nama model alih-alih meluber di terminal sangat sempit', () => {
    const sempit = polos(renderStatusLine({ maxWidth: 40 }));
    assert.ok(lebarTampil(sempit) <= 40);
    assert.match(sempit, /…/, 'nama model harus dipangkas dengan ellipsis');
  });

  it('harus tetap memuat indikator konteks di semua lebar', () => {
    for (let w = 30; w <= 160; w += 13) {
      assert.match(polos(renderStatusLine({ maxWidth: w })), /Context \d+% left/);
    }
  });

  it('tidak boleh membocorkan escape atau karakter aneh saat dipotong', () => {
    for (let w = 30; w <= 160; w += 7) {
      const line = polos(renderStatusLine({ maxWidth: w }));
      assert.ok(!line.includes('undefined'));
      assert.ok(!line.includes('  │  │'), 'tidak boleh ada pemisah ganda');
    }
  });
});

describe('Prompt: Frame Tidak Melewati Lebar Terminal', () => {
  it('setiap baris frame harus muat dalam lebar terminal', () => {
    // Ini regresi langsung: sebelum status line Made adaptive, baris ini
    // 82 kolom di terminal 80 dan clack memorinya jadi dua baris acak.
    const lines = polos(
      buildPromptFrame({ placeholder: 'Ask bAIwor Code to do anything...' })
    ).split('\n');
    for (const line of lines) {
      assert.ok(line.length <= terminalWidth(), `baris panjang ${line.length}: ${line.slice(0, 40)}`);
    }
  });

  it('frame dengan dropdown juga harus muat', () => {
    const lines = polos(
      buildPromptFrame({
        value: '/',
        placeholder: 'Ask bAIwor Code to do anything...',
        dropdownOpen: true,
      })
    ).split('\n');
    for (const line of lines) {
      assert.ok(line.length <= terminalWidth(), `baris panjang ${line.length}`);
    }
  });

  it('frame dengan dropdown harus muat juga di terminal sempit', () => {
    // Regresi: kotak bawah dropdown dulu dipatok 76 kolom dan header 66 kolom,
    // sehingga di terminal < 76 kolom barisnya meluber dan kotak ikut patah.
    const orig = process.stdout.columns;
    try {
      for (const w of [40, 52, 68]) {
        process.stdout.columns = w;
        const lines = polos(
          buildPromptFrame({
            value: '/',
            placeholder: 'Ask bAIwor Code to do anything...',
            dropdownOpen: true,
          })
        ).split('\n');
        for (const line of lines) {
          assert.ok(line.length <= w, `lebar ${w}: baris ${line.length} kolom -> ${line.slice(0, 50)}`);
        }
        assert.ok(
          lines.some((l) => l.includes('Perintah')),
          `lebar ${w}: header dropdown hilang`
        );
      }
    } finally {
      process.stdout.columns = orig;
    }
  });

  it('baris status harus sama lebarnya dengan baris yang dirender langsung', () => {
    const fromFrame = polos(
      buildPromptFrame({ placeholder: 'Ask bAIwor Code to do anything...' })
    ).split('\n').at(-1);
    const langsung = polos(renderStatusLine());
    assert.equal(fromFrame.length, langsung.length);
  });
});

describe('Prompt: Perilaku CLI Saat Dipipe', () => {
  const jalankan = () =>
    execFileSync(process.execPath, [BIN], {
      input: '/exit\n',
      encoding: 'utf8',
      timeout: 30_000,
    });

  it('harus tetap mencetak baris status saat keluaran dialihkan', () => {
    const out = polos(jalankan());
    assert.match(out, /~\s+│\s+Full access/);
    assert.match(out, /Context \d+% left/);
  });

  it('harus bebas karakter escape saat dialihkan', () => {
    assert.equal(/\x1b/.test(jalankan()), false, 'keluaran pipe tidak boleh memuat escape ANSI');
  });

  it('harus tidak menggambar dua baris status di mode pipe', () => {
    const out = polos(jalankan());
    // `split` dengan argumen string tidak mengurai escape, jadi harus pakai regex.
    const kemunculan = out.match(/~\s+│\s+Full access/g) || [];
    assert.equal(kemunculan.length, 1, `baris status muncul ${kemunculan.length} kali`);
  });

  it('harus tidak menggambar area input bergaya TUI saat dialihkan', () => {
    // Area input hanya ada di TTY; pada mode pipe yang dipakai readline biasa.
    const out = polos(jalankan());
    assert.ok(!out.includes('Ask bAIwor Code to do anything...'));
  });
});

describe('Prompt: Daftar Perintah', () => {
  it('harus memuat perintah inti yang dipakai README', () => {
    const names = COMMANDS.map((c) => c.name);
    for (const wajib of ['/help', '/status', '/model', '/clear', '/exit']) {
      assert.ok(names.includes(wajib), `perintah ${wajib} hilang`);
    }
  });

  it('harus memberi deskripsi pada setiap perintah', () => {
    for (const cmd of COMMANDS) {
      assert.ok(cmd.desc && cmd.desc.length > 0, `${cmd.name} tidak punya deskripsi`);
    }
  });
});
