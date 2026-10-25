import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildPromptFrame, COMMANDS, SUBCOMMANDS, getPromptContext, SlashTextPrompt, resetPromptHistory, savePromptHistory, getPromptHistory } from '../src/prompt.js';
import { renderStatusLine, statusRule, terminalWidth } from '../src/statusLine.js';
import { getConfig } from '../src/config.js';

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
  });

  it('harus mengikuti lebar terminal walau melewati 200 kolom (fullscreen)', () => {
    // Regresi: dulu ada cap 200 sehingga saat terminal di-fullscreen lebih
    // lebar dari itu, garis berhenti mengikuti ukuran layar.
    assert.equal(terminalWidth(300), 300);
    assert.equal(terminalWidth(240), 240);
    assert.equal(terminalWidth(120), 120);
    assert.equal(terminalWidth(10), 40, 'tetap menghormati lebar minimum');
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
    assert.match(line, /^\s+~\s+│\s+(?:Safe|Auto|Plan|YOLO)\s+│/);
    assert.match(line, /✦/);
    assert.match(line, /Konteks \d+% tersisa/);
  });

  it('harus menyisipkan prefix tugas bila diberikan', () => {
    assert.match(polos(renderStatusLine({ prefix: 'Explore baiworcode', maxWidth: 120 })), /Explore baiworcode/);
  });

  it('harus tetap menampilkan indikator konteks walau model belum dikonfigurasi', () => {
    assert.match(polos(renderStatusLine()), /Konteks \d+% tersisa/);
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
    const lines = render().split('\n');
    assert.match(lines[2], /^─+$/, 'garis bawah harus ada di baris ke-2 (setelah input)');
  });

  it('kedua garis harus berakhir di kolom yang sama dan sejajar sempurna di kiri (simetris)', () => {
    const lines = render().split('\n');
    const atas = lines[0].length;
    const bawah = lines[2].length;
    assert.ok(atas > 10, 'garis harus punya tanda pisah yang berarti');
    assert.equal(
      atas,
      bawah,
      `panjang garis atas ${atas} harus persis sama dengan panjang garis bawah ${bawah}`
    );
  });

  it('garis atas dan garis bawah harus sama-sama mulai di kolom 0 (tepi kiri sejajar)', () => {
    const lines = render().split('\n');
    assert.ok(lines[0].startsWith('─'), 'garis atas harus mulai di kolom 0');
    assert.ok(lines[2].startsWith('─'), 'garis bawah harus mulai di kolom 0 (sejajar)');
  });

  it('harus menyisipkan satu baris kosong sebelum baris status', () => {
    const lines = render().split('\n');
    assert.equal(lines[3], '', 'harus ada baris kosong setelah garis bawah');
    assert.match(lines[4], /~\s+│\s+(?:Safe|Auto|Plan|YOLO)/);
  });

  it('harus menampilkan baris status sebagai baris terakhir', () => {
    const lines = render().split('\n');
    assert.match(lines[lines.length - 1], /Konteks \d+% tersisa/);
  });

  it('harus menampilkan teks yang diketik pengguna di input', () => {
    assert.match(render('perbaiki error di src/index.js').split('\n')[1], /perbaiki error di src\/index\.js/);
  });

  it('harus menggambar status juga saat state submit', () => {
    const lines = render('sudah selesai', 'submit').split('\n');
    assert.match(lines[1], /sudah selesai/);
    assert.match(lines[lines.length - 1], /Konteks \d+% tersisa/);
  });

  it('harus menggambar status juga saat state cancel', () => {
    const lines = render('batal', 'cancel').split('\n');
    assert.match(lines[lines.length - 1], /Konteks \d+% tersisa/);
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
    assert.ok(!out.includes('/tinyfish'), 'perintah yang tidak cocok tidak boleh muncul');
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
    assert.ok(lines.findIndex((l, idx) => idx > 1 && /^─+$/.test(l)) > 0);
    assert.match(lines[lines.length - 1], /Konteks \d+% tersisa/);
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
    assert.match(out, /Konteks \d+% tersisa/);
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
    const config = getConfig();
    let sempit = polos(renderStatusLine({ maxWidth: 55 }));
    if (config.activeProvider && sempit.includes(config.activeProvider)) {
      for (let w = 54; w >= 40; w--) {
        const s = polos(renderStatusLine({ maxWidth: w }));
        if (!s.includes(config.activeProvider)) {
          sempit = s;
          break;
        }
      }
    }
    const modelSnippet = (config.activeModel || 'Not configured').slice(0, 10);
    assert.ok(sempit.includes(modelSnippet), 'nama model harus bertahan');
    if (config.activeProvider && config.activeProvider !== 'baiwor.my.id' && config.activeProvider !== 'Not configured') {
      assert.ok(!sempit.includes(config.activeProvider), 'provider boleh hilang dulu');
    }
  });

  it('harus memakai bentuk paling ringkas saat sangat sempit', () => {
    const sangat = polos(renderStatusLine({ maxWidth: 30 }));
    assert.match(sangat, /Konteks \d+% tersisa/);
    assert.ok(!/Safe|Auto|Plan|YOLO/.test(sangat), 'label mode izin harus dikorbankan di lebar paling sempit');
  });

  it('harus memangkas nama model alih-alih meluber di terminal sangat sempit', () => {
    const sempit = polos(renderStatusLine({ maxWidth: 40 }));
    assert.ok(lebarTampil(sempit) <= 40);
    assert.match(sempit, /…/, 'nama model harus dipangkas dengan ellipsis');
  });

  it('harus tetap memuat indikator konteks di semua lebar', () => {
    for (let w = 30; w <= 160; w += 13) {
      assert.match(polos(renderStatusLine({ maxWidth: w })), /Konteks \d+% tersisa/);
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
      timeout: 90_000,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

  it('harus tetap mencetak baris status saat keluaran dialihkan', () => {
    const out = polos(jalankan());
    assert.match(out, /~\s+│\s+(?:Safe|Auto|Plan|YOLO)/);
    assert.match(out, /Konteks \d+% tersisa/);
  });

  it('harus bebas karakter escape saat dialihkan', () => {
    assert.equal(/\x1b/.test(jalankan()), false, 'keluaran pipe tidak boleh memuat escape ANSI');
  });

  it('harus tidak menggambar dua baris status di mode pipe', () => {
    const out = polos(jalankan());
    // `split` dengan argumen string tidak mengurai escape, jadi harus pakai regex.
    const kemunculan = out.match(/~\s+│\s+(?:Safe|Auto|Plan|YOLO)/g) || [];
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
    for (const wajib of ['/help', '/status', '/model', '/clear', '/exit', '/q']) {
      assert.ok(names.includes(wajib), `perintah ${wajib} hilang`);
    }
  });

  it('harus memberi deskripsi pada setiap perintah', () => {
    for (const cmd of COMMANDS) {
      assert.ok(cmd.desc && cmd.desc.length > 0, `${cmd.name} tidak punya deskripsi`);
    }
  });

  it('harus keluar dengan bersih saat menerima input /q', () => {
    const out = polos(
      execFileSync(process.execPath, [BIN], {
        input: '/q\n',
        encoding: 'utf8',
        timeout: 90_000,
      })
    );
    assert.match(out, /Matur nuwun! Sampun nganggo bAIwor Code/);
  });
});

describe('Prompt: Flicker-Free Rendering (Anti-Kedip)', () => {
  function createMockPrompt() {
    const writes = [];
    const fakeOutput = {
      write(s) {
        writes.push(s);
      },
      on() {},
      off() {},
      columns: 80,
    };
    const fakeInput = {
      on() {},
      off() {},
      pause() {},
      resume() {},
    };
    const prompt = new SlashTextPrompt({
      placeholder: 'Test input...',
      output: fakeOutput,
      input: fakeInput,
    });
    return { prompt, writes };
  }

  it('harus membungkus pembaruan frame dengan sinkronisasi mode 2026', () => {
    const { prompt, writes } = createMockPrompt();
    prompt.state = 'initial';
    prompt.render();
    assert.ok(writes.length > 0);
    assert.ok(writes[0].startsWith('\x1b[?2026h'));
    assert.ok(writes[0].endsWith('\x1b[?2026l'));
  });

  it('harus menulis tepat 1 buffer atomik saat mengetik 1 karakter', () => {
    const { prompt, writes } = createMockPrompt();
    prompt.state = 'initial';
    prompt.render();
    writes.length = 0;

    prompt.value = 'a';
    prompt.render();

    assert.equal(writes.length, 1, 'setiap ketikan harus memicu tepat satu pemanggilan output.write()');
  });

  it('tidak boleh memakai \\x1b[2K untuk menghapus baris saat pengetikan biasa', () => {
    const { prompt, writes } = createMockPrompt();
    prompt.state = 'initial';
    prompt.render();
    writes.length = 0;

    prompt.value = 'halo';
    prompt.render();

    // \\x1b[2K mengosongkan seluruh baris ke spasi sebelum menulis teks baru,
    // pemicu utama kedipan/strobing di terminal Windows.
    assert.ok(
      !writes[0].includes('\x1b[2K'),
      'pembaruan pengetikan satu baris tidak boleh mengosongkan baris secara penuh'
    );
    // Harus memakai overwrite in-place dengan pembersihan sisa akhir baris \\x1b[K
    assert.ok(writes[0].includes('\x1b[K'));
  });

  it('harus tetap atomik saat dropdown dibuka dan navigasi panah', () => {
    const { prompt, writes } = createMockPrompt();
    prompt.state = 'initial';
    prompt.render();
    writes.length = 0;

    // Buka dropdown
    prompt.value = '/';
    prompt.emit('value', '/');
    prompt.render();
    assert.equal(writes.length, 1);
    assert.ok(writes[0].startsWith('\x1b[?2026h'));
    assert.ok(writes[0].endsWith('\x1b[?2026l'));
  });

  it('harus membersihkan sisa baris saat dropdown ditutup tanpa meninggalkan baris sampah', () => {
    const { prompt, writes } = createMockPrompt();
    prompt.state = 'initial';
    prompt.render();

    // Buka dropdown
    prompt.value = '/';
    prompt.emit('value', '/');
    prompt.render();
    writes.length = 0;

    // Tutup dropdown (mis. dengan Esc atau input bukan slash)
    prompt.value = 'bukan slash';
    prompt.emit('value', 'bukan slash');
    prompt.render();

    assert.equal(writes.length, 1);
    assert.ok(writes[0].startsWith('\x1b[?2026h'));
    assert.ok(writes[0].endsWith('\x1b[?2026l'));
  });
});

describe('Prompt: Pengamanan Ctrl+C dan Escape (Anti-Exit Tidak Disengaja)', () => {
  function createMockPrompt() {
    const writes = [];
    const fakeOutput = {
      write(s) {
        writes.push(s);
      },
      on() {},
      off() {},
      columns: 80,
    };
    const fakeInput = {
      on() {},
      off() {},
      pause() {},
      resume() {},
      unpipe() {},
      removeListener() {},
    };
    const prompt = new SlashTextPrompt({
      placeholder: 'Ask bAIwor Code to do anything...',
      output: fakeOutput,
      input: fakeInput,
    });
    prompt.state = 'active';
    return { prompt, writes };
  }

  it('Ctrl+C saat input terisi harus menghapus teks tanpa keluar', () => {
    const { prompt } = createMockPrompt();
    prompt.value = 'sedang mengetik instruksi penting';
    prompt._cursor = prompt.value.length;

    // Tekan Ctrl+C
    prompt.onKeypress('\u0003', { name: 'c', ctrl: true, sequence: '\u0003' });

    assert.equal(prompt.value, '', 'teks input harus dibersihkan');
    assert.equal(prompt._cursor, 0, 'posisi kursor harus kembali ke awal');
    assert.equal(prompt.state, 'active', 'state harus tetap aktif dan tidak cancel');
  });

  it('Ctrl+C sekali saat input kosong tidak boleh langsung keluar, melainkan menampilkan peringatan', () => {
    const { prompt, writes } = createMockPrompt();
    prompt.value = '';
    writes.length = 0;

    // Tekan Ctrl+C pertama kali
    prompt.onKeypress('\u0003', { name: 'c', ctrl: true, sequence: '\u0003' });

    assert.equal(prompt.state, 'active', 'state tidak boleh cancel pada penekanan pertama');
    assert.ok(writes.length > 0);
    assert.match(writes[writes.length - 1], /Tekan Ctrl\+C (sekali lagi|lagi) untuk keluar/);
  });

  it('Ctrl+C berulang cepat (< 400ms karena key repeat / bounce) harus diabaikan dan tidak langsung keluar', () => {
    const { prompt } = createMockPrompt();
    prompt.value = '';

    // Tekan pertama
    prompt.onKeypress('\u0003', { name: 'c', ctrl: true, sequence: '\u0003' });
    assert.equal(prompt.state, 'active');

    // Key repeat langsung tiba
    prompt.onKeypress('\u0003', { name: 'c', ctrl: true, sequence: '\u0003' });
    assert.equal(prompt.state, 'active', 'key repeat < 400ms tidak boleh memicu keluar');
  });

  it('Ctrl+C dua kali berturut-turut pada input kosong harus mengizinkan pembatalan/keluar', async () => {
    const { prompt } = createMockPrompt();
    prompt.value = '';

    // Tekan Ctrl+C pertama kali
    prompt.onKeypress('\u0003', { name: 'c', ctrl: true, sequence: '\u0003' });
    assert.equal(prompt.state, 'active');

    // Jeda antar penekanan fisik manusia yang sah (> 400ms)
    await new Promise((r) => setTimeout(r, 450));

    // Tekan Ctrl+C kedua kali
    prompt.onKeypress('\u0003', { name: 'c', ctrl: true, sequence: '\u0003' });
    assert.equal(prompt.state, 'cancel', 'state harus menjadi cancel pada penekanan kedua');
  });

  it('mengetik tombol lain setelah Ctrl+C pertama harus membatalkan status peringatan keluar', () => {
    const { prompt, writes } = createMockPrompt();
    prompt.value = '';

    // Tekan Ctrl+C pertama kali
    prompt.onKeypress('\u0003', { name: 'c', ctrl: true, sequence: '\u0003' });
    assert.equal(prompt.state, 'active');

    // Ketik huruf a
    writes.length = 0;
    prompt.value = 'a';
    prompt.onKeypress('a', { name: 'a' });

    assert.equal(prompt.state, 'active');
    assert.ok(!writes[writes.length - 1].includes('Tekan Ctrl+C'));
  });

  it('Escape saat baris terisi harus membersihkan teks tanpa keluar', () => {
    const { prompt } = createMockPrompt();
    prompt.value = 'perintah salah';

    prompt.onKeypress('', { name: 'escape' });

    assert.equal(prompt.value, '', 'teks input harus dibersihkan');
    assert.equal(prompt.state, 'active', 'Escape tidak boleh menutup prompt');
  });

  it('Escape saat baris kosong tidak boleh menutup prompt / keluar', () => {
    const { prompt } = createMockPrompt();
    prompt.value = '';

    prompt.onKeypress('', { name: 'escape' });

    assert.equal(prompt.state, 'active', 'Escape pada baris kosong tidak boleh cancel');
  });

  it('memasang listener SIGINT pada readline interface saat rl di-assign', () => {
    const { prompt } = createMockPrompt();
    const fakeRl = {
      _listeners: {},
      on(evt, fn) {
        this._listeners[evt] = this._listeners[evt] || [];
        this._listeners[evt].push(fn);
      },
      listenerCount(evt) {
        return (this._listeners[evt] || []).length;
      },
      line: '',
      cursor: 0,
    };

    prompt.rl = fakeRl;
    assert.ok(fakeRl.listenerCount('SIGINT') > 0, 'rl harus dipasangi listener SIGINT');
    assert.equal(prompt.rl, fakeRl);
  });

  it('me-render ulang dan menyesuaikan ukuran frame saat event resize dipancarkan', () => {
    let resizeCb = null;
    const writes = [];
    const fakeOutput = {
      columns: 80,
      write(s) {
        writes.push(s);
      },
      on(evt, cb) {
        if (evt === 'resize') resizeCb = cb;
      },
      off() {},
    };
    const fakeInput = {
      on() {},
      off() {},
      pause() {},
      resume() {},
      unpipe() {},
      removeListener() {},
    };

    const prompt = new SlashTextPrompt({
      placeholder: 'Resize test...',
      output: fakeOutput,
      input: fakeInput,
    });
    prompt.state = 'initial';
    prompt.render();
    writes.length = 0;

    assert.ok(typeof resizeCb === 'function', 'listener resize harus terdaftar pada output');

    // Ubah ukuran terminal menjadi lebih lebar (mis. fullscreen 160 kolom)
    fakeOutput.columns = 160;
    resizeCb();

    assert.ok(writes.length > 0, 'resize harus memicu render ulang');
    const lastWrite = writes[writes.length - 1];
    // Garis frame harus menyesuaikan lebar baru (159 tanda pisah)
    assert.ok(lastWrite.includes('─'.repeat(159)), 'frame harus menyesuaikan ke 160 kolom');

    // Tutup prompt dan pastikan cleanup berjalan
    prompt.close();
  });
});

function createMockPrompt() {
  const writes = [];
  const fakeOutput = {
    write(s) {
      writes.push(s);
    },
    on() {},
    off() {},
    columns: 80,
  };
  const fakeInput = {
    on() {},
    off() {},
    pause() {},
    resume() {},
    unpipe() {},
    removeListener() {},
  };
  const prompt = new SlashTextPrompt({
    placeholder: 'Ask bAIwor Code to do anything...',
    output: fakeOutput,
    input: fakeInput,
  });
  return { prompt, writes };
}

describe('Prompt: Interaksi Slash Dropdown (/ Tab, Spasi, Panah, Enter)', () => {

  it('menekan Tab saat baris kosong harus memunculkan "/" dan membuka dropdown', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '';
    prompt.onKeypress('\t', { name: 'tab' });
    assert.equal(prompt.value, '/');
  });

  it('mengetik "/" lalu spasi "/ " harus tetap mempertahankan dropdown dengan semua perintah', () => {
    const out = polos(buildPromptFrame({ value: '/ ', dropdownOpen: true }));
    assert.ok(out.includes('Perintah'));
    assert.ok(out.includes('/help'));
    assert.ok(out.includes('/permission'));
    assert.ok(!out.includes('Tidak ada perintah yang cocok'));
  });

  it('mengetik "/" lalu panah bawah lalu Tab harus melengkapi perintah yang dipilih ke input frame dan menutup dropdown', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '/';
    prompt.emit('value', '/');
    prompt.onKeypress('', { name: 'down' }); // pindah ke /permission (1)
    prompt.onKeypress('', { name: 'down' }); // pindah ke /compact (2)
    prompt.onKeypress('\t', { name: 'tab' });
    assert.equal(prompt.value, '/compact ');
    assert.equal(prompt.state, 'active');
    // Dropdown tertutup: tekan Enter langsung submit nilai di input frame
    prompt.onKeypress('\r', { name: 'return' });
    assert.equal(prompt.state, 'submit');
    assert.equal(prompt.value, '/compact ');
  });

  it('mengetik "/" lalu Tab tanpa navigasi harus melengkapi perintah pertama ke input frame dan menutup dropdown', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '/';
    prompt.emit('value', '/');
    prompt.onKeypress('\t', { name: 'tab' });
    assert.equal(prompt.value, '/help ');
    assert.equal(prompt.state, 'active');
    prompt.onKeypress('\r', { name: 'return' });
    assert.equal(prompt.state, 'submit');
    assert.equal(prompt.value, '/help ');
  });

  it('mengetik "/" lalu panah bawah harus berpindah pilihan tanpa menutup dropdown', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '/';
    prompt.emit('value', '/');
    prompt.onKeypress('', { name: 'down' });
    assert.equal(prompt.state, 'active');
  });

  it('mengetik "/" lalu langsung Enter tanpa navigasi harus submit "/" agar p.select terbuka', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '/';
    prompt.emit('value', '/');
    prompt.onKeypress('\r', { name: 'return' });
    assert.equal(prompt.state, 'submit');
    assert.equal(prompt.value, '/');
  });

  it('mengetik "/" lalu navigasi panah bawah lalu Enter harus submit perintah yang di-highlight', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '/';
    prompt.emit('value', '/');
    prompt.onKeypress('', { name: 'down' }); // pindah dari /help (0)
    prompt.onKeypress('', { name: 'down' }); // ke /permission (1) → /compact (2)
    prompt.onKeypress('\r', { name: 'return' });
    assert.equal(prompt.state, 'submit');
    assert.equal(prompt.value, '/compact');
  });

  it('Enter pada perintah bersubcommand (/{name}) membuka pilihan subcommand, bukan submit', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '/';
    prompt.emit('value', '/');
    prompt.onKeypress('', { name: 'down' }); // pindah ke /permission (1)
    prompt.onKeypress('\r', { name: 'return' });
    // Punya SUBCOMMANDS → Enter melengkapi ke "/permission " & buka dropdown sub
    assert.equal(prompt.state, 'active');
    assert.equal(prompt.value, '/permission ');
  });
});

describe('Prompt: Subcommand Context & Dropdown (/timeline, /session, /skill)', () => {
  it('getPromptContext harus mengenali root command dan subcommands dengan benar', () => {
    // Kosong / Teks biasa
    assert.equal(getPromptContext('').type, 'none');
    assert.equal(getPromptContext('halo dunia').type, 'none');

    // Root command
    const root = getPromptContext('/tim');
    assert.equal(root.type, 'command');
    assert.ok(root.matches.some((c) => c.name === '/timeline'));

    // Command dengan spasi tapi tanpa sub-opsi terdaftar
    const free = getPromptContext('/compact ringkas');
    assert.equal(free.type, 'freeform');
    assert.equal(free.parentCmd, '/compact');

    // /timeline dengan spasi -> subcommands compact & detail
    const timeCtx = getPromptContext('/timeline ');
    assert.equal(timeCtx.type, 'subcommand');
    assert.equal(timeCtx.parentCmd, '/timeline');
    assert.equal(timeCtx.matches.length, 2);
    assert.equal(timeCtx.matches[0].name, 'compact');
    assert.equal(timeCtx.matches[1].name, 'detail');

    // /timeline dengan filter query
    const timeComp = getPromptContext('/timeline comp');
    assert.equal(timeComp.matches.length, 1);
    assert.equal(timeComp.matches[0].name, 'compact');

    const timeDet = getPromptContext('/timeline det');
    assert.equal(timeDet.matches.length, 1);
    assert.equal(timeDet.matches[0].name, 'detail');

    // /session dengan spasi -> subcommands list, resume, delete, clear
    const sessCtx = getPromptContext('/session ');
    assert.equal(sessCtx.type, 'subcommand');
    assert.equal(sessCtx.parentCmd, '/session');
    assert.ok(sessCtx.matches.some((s) => s.name === 'list'));
    assert.ok(sessCtx.matches.some((s) => s.name === 'resume'));
    assert.ok(sessCtx.matches.some((s) => s.name === 'delete'));
    assert.ok(sessCtx.matches.some((s) => s.name === 'clear'));
  });

  it('buildPromptFrame harus merender header Pilihan /timeline dan opsi compact/detail', () => {
    const out = polos(buildPromptFrame({ value: '/timeline ', dropdownOpen: true, selectedIndex: 0 }));
    assert.ok(out.includes('Pilihan /timeline'));
    assert.ok(out.includes('compact'));
    assert.ok(out.includes('detail'));
    assert.ok(out.includes('❯ compact'));

    const outDetail = polos(buildPromptFrame({ value: '/timeline ', dropdownOpen: true, selectedIndex: 1 }));
    assert.ok(outDetail.includes('❯ detail'));
  });

  it('menavigasi ke /timeline lalu tekan Enter TIDAK langsung eksekusi, melainkan memunculkan opsi subperintah', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '/';
    prompt.emit('value', '/');

    // Indeks /timeline di COMMANDS
    const timelineIdx = COMMANDS.findIndex((c) => c.name === '/timeline');
    assert.ok(timelineIdx >= 0);

    for (let i = 0; i < timelineIdx; i++) {
      prompt.onKeypress('', { name: 'down' });
    }

    // Tekan Enter saat /timeline ter-highlight
    prompt.onKeypress('\r', { name: 'return' });

    // TIDAK boleh submit! Harus berubah menjadi "/timeline " dan state tetap active
    assert.equal(prompt.state, 'active');
    assert.equal(prompt.value, '/timeline ');

    // Tekan panah bawah untuk memilih "detail"
    prompt.onKeypress('', { name: 'down' });

    // Tekan Enter untuk submit "detail"
    prompt.onKeypress('\r', { name: 'return' });
    assert.equal(prompt.state, 'submit');
    assert.equal(prompt.value, '/timeline detail');
  });

  it('menavigasi ke /timeline lalu tekan Spasi harus berpindah ke mode subperintah', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '/';
    prompt.emit('value', '/');

    const timelineIdx = COMMANDS.findIndex((c) => c.name === '/timeline');
    for (let i = 0; i < timelineIdx; i++) {
      prompt.onKeypress('', { name: 'down' });
    }

    // Tekan Spasi
    prompt.onKeypress(' ', { name: 'space' });

    assert.equal(prompt.state, 'active');
    assert.equal(prompt.value, '/timeline ');

    // Tekan Enter langsung memilih opsi pertama (compact)
    prompt.onKeypress('\r', { name: 'return' });
    assert.equal(prompt.state, 'submit');
    assert.equal(prompt.value, '/timeline compact');
  });

  it('mengetik /time lalu tekan Tab harus auto-complete ke "/timeline " dan menutup dropdown', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '/time';
    prompt.emit('value', '/time');

    // Tekan Tab
    prompt.onKeypress('\t', { name: 'tab' });

    assert.equal(prompt.state, 'active');
    assert.equal(prompt.value, '/timeline ');

    // Tekan Enter untuk submit /timeline
    prompt.onKeypress('\r', { name: 'return' });
    assert.equal(prompt.state, 'submit');
    assert.equal(prompt.value, '/timeline ');
  });

  it('mengetik /timeline lalu spasi lalu Tab harus melengkapi subperintah yang dipilih ke input frame dan menutup dropdown', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '/timeline ';
    prompt.emit('value', '/timeline ');

    // Pindah ke opsi kedua "detail"
    prompt.onKeypress('', { name: 'down' });
    // Tekan Tab untuk melengkapi "detail"
    prompt.onKeypress('\t', { name: 'tab' });

    assert.equal(prompt.value, '/timeline detail ');
    assert.equal(prompt.state, 'active');

    // Tekan Enter untuk submit
    prompt.onKeypress('\r', { name: 'return' });
    assert.equal(prompt.state, 'submit');
    assert.equal(prompt.value, '/timeline detail ');
  });

  it('mengetik "/timeline" lengkap lalu tekan Enter harus transisi ke pilihan subperintah', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '/timeline';
    prompt.emit('value', '/timeline');

    // Tekan Enter
    prompt.onKeypress('\r', { name: 'return' });

    assert.equal(prompt.state, 'active');
    assert.equal(prompt.value, '/timeline ');

    // Tekan Enter pada pilihan pertama (compact)
    prompt.onKeypress('\r', { name: 'return' });
    assert.equal(prompt.state, 'submit');
    assert.equal(prompt.value, '/timeline compact');
  });

  it('harus memanggil kembali perintah sebelumnya dengan Panah Atas dan maju dengan Panah Bawah', () => {
    resetPromptHistory();
    savePromptHistory('perintah pertama');
    savePromptHistory('perintah kedua');

    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '';

    // Tekan Panah Atas (↑): harus memanggil 'perintah kedua' (terbaru)
    prompt.onKeypress('', { name: 'up' });
    assert.equal(prompt.value, 'perintah kedua');

    // Tekan Panah Atas lagi: harus memanggil 'perintah pertama' (lebih lama)
    prompt.onKeypress('', { name: 'up' });
    assert.equal(prompt.value, 'perintah pertama');

    // Tekan Panah Bawah (↓): kembali ke 'perintah kedua'
    prompt.onKeypress('', { name: 'down' });
    assert.equal(prompt.value, 'perintah kedua');

    // Tekan Panah Bawah lagi: kembali ke input semula (string kosong)
    prompt.onKeypress('', { name: 'down' });
    assert.equal(prompt.value, '');
  });
});

describe('Prompt: Stdin Recovery & Anti-freeze Protections', () => {
  it('Prompt.prototype harus memiliki patch proteksi stdin global', async () => {
    const { Prompt } = await import('@clack/core');
    assert.equal(Prompt.prototype._baiworStdinPatched, true);
  });

  it('prompt.close() harus mematikan rawMode namun TIDAK mem-pause input stream (cegah race ConPTY)', () => {
    let isRaw = true;
    let paused = false;
    let pauseCalled = false;
    const fakeInput = {
      isTTY: true,
      isRaw: true,
      setRawMode(val) { isRaw = val; this.isRaw = val; },
      on() {},
      off() {},
      pause() { paused = true; pauseCalled = true; },
      resume() { paused = false; },
      unpipe() {},
      removeListener() {},
      once() {},
    };
    const fakeOutput = {
      write() {},
      on() {},
      off() {},
      columns: 80,
    };
    const prompt = new SlashTextPrompt({
      placeholder: 'Test input...',
      input: fakeInput,
      output: fakeOutput,
    });
    prompt.close();
    assert.equal(isRaw, false, 'rawMode harus dimatikan setelah prompt ditutup');
    assert.equal(paused, false, 'input stream TIDAK boleh di-pause setelah prompt ditutup');
    assert.equal(pauseCalled, false, 'patch stdin tidak boleh memanggil pause() sama sekali');
  });

  it('Ctrl+C pada SlashTextPrompt baris kosong penekanan pertama memicu peringatan', () => {
    const fakeOutput = { write() {}, on() {}, off() {}, columns: 80 };
    const prompt = new SlashTextPrompt({
      placeholder: 'Test...',
      output: fakeOutput,
    });
    prompt.state = 'active';
    prompt.value = '';
    // Ctrl+C pertama: memicu peringatan keluar
    prompt.onKeypress('', { name: 'c', ctrl: true });
    assert.equal(prompt.state, 'active');
  });
});


