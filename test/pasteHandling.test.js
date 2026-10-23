import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptFrame, getPromptContext, SlashTextPrompt } from '../src/prompt.js';

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const polos = (s) => String(s).replace(ANSI, '');

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

describe('Prompt: Bracketed Paste Mode & Multiline Input', () => {
  it('harus mengaktifkan mode bracketed paste (\\x1b[?2004h) pada render frame pertama', () => {
    const { prompt, writes } = createMockPrompt();
    prompt.render();
    assert.ok(
      writes.some((w) => w.includes('\x1b[?2004h')),
      'render awal harus mengirim kode terminal \\x1b[?2004h'
    );
  });

  it('harus menonaktifkan mode bracketed paste (\\x1b[?2004l) saat prompt ditutup', () => {
    const { prompt, writes } = createMockPrompt();
    prompt.render();
    prompt.close();
    assert.ok(
      writes.some((w) => w.includes('\x1b[?2004l')),
      'close prompt harus mengirim kode terminal \\x1b[?2004l'
    );
  });

  it('paste 2 baris teks TIDAK boleh langsung submit, melainkan menampung seluruh teks', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '';

    // Simulasi sequence bracketed paste dari terminal:
    // 1. paste-start
    prompt.onKeypress(undefined, { name: 'paste-start', sequence: '\x1b[200~' });
    assert.equal(prompt.state, 'active');

    // 2. Baris pertama
    prompt.onKeypress('b', { name: 'b', sequence: 'b' });
    prompt.onKeypress('a', { name: 'a', sequence: 'a' });
    prompt.onKeypress('r', { name: 'r', sequence: 'r' });
    prompt.onKeypress('1', { name: '1', sequence: '1' });

    // 3. Newline (\r\n / enter / return)
    prompt.onKeypress('\r', { name: 'return', sequence: '\r' });
    prompt.onKeypress('\n', { name: 'enter', sequence: '\n' });

    // TIDAK boleh submit di tengah paste!
    assert.equal(prompt.state, 'active', 'prompt tidak boleh berubah jadi submit saat ada newline di dalam paste');

    // 4. Baris kedua
    prompt.onKeypress('b', { name: 'b', sequence: 'b' });
    prompt.onKeypress('a', { name: 'a', sequence: 'a' });
    prompt.onKeypress('r', { name: 'r', sequence: 'r' });
    prompt.onKeypress('2', { name: '2', sequence: '2' });

    // 5. paste-end
    prompt.onKeypress(undefined, { name: 'paste-end', sequence: '\x1b[201~' });

    // State tetap active (belum dikirim oleh user)
    assert.equal(prompt.state, 'active');
    // Seluruh baris tersimpan dengan newline bersih
    assert.equal(prompt.value, 'bar1\nbar2');
  });

  it('menekan Enter setelah paste multiline harus mengeksekusi (submit) seluruh teks', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = '';

    // Tempelkan kode fungsi 3 baris
    prompt.onKeypress(undefined, { name: 'paste-start', sequence: '\x1b[200~' });
    prompt.onKeypress('f', { name: 'f', sequence: 'f' });
    prompt.onKeypress('o', { name: 'o', sequence: 'o' });
    prompt.onKeypress('o', { name: 'o', sequence: 'o' });
    prompt.onKeypress('\n', { name: 'enter', sequence: '\n' });
    prompt.onKeypress('b', { name: 'b', sequence: 'b' });
    prompt.onKeypress('a', { name: 'a', sequence: 'a' });
    prompt.onKeypress('r', { name: 'r', sequence: 'r' });
    prompt.onKeypress('\n', { name: 'enter', sequence: '\n' });
    prompt.onKeypress('b', { name: 'b', sequence: 'b' });
    prompt.onKeypress('a', { name: 'a', sequence: 'a' });
    prompt.onKeypress('z', { name: 'z', sequence: 'z' });
    prompt.onKeypress(undefined, { name: 'paste-end', sequence: '\x1b[201~' });

    assert.equal(prompt.state, 'active');
    assert.equal(prompt.value, 'foo\nbar\nbaz');

    // Pengguna sekarang menekan Enter biasa secara eksplisit
    prompt.onKeypress('\r', { name: 'return' });

    assert.equal(prompt.state, 'submit');
    assert.equal(prompt.value, 'foo\nbar\nbaz');
  });

  it('Ctrl+C saat ada teks multiline harus membersihkan teks tanpa langsung mematikan aplikasi', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = 'baris 1\nbaris 2\nbaris 3';

    prompt.onKeypress('\x03', { name: 'c', ctrl: true });

    assert.equal(prompt.state, 'active');
    assert.equal(prompt.value, '');
  });

  it('Alt+Enter menyisipkan newline tanpa submit', () => {
    const { prompt } = createMockPrompt();
    prompt.state = 'active';
    prompt.value = 'line1';
    prompt._cursor = 5;

    prompt.onKeypress('\x1b\r', { name: 'return', meta: true });

    assert.equal(prompt.state, 'active');
    assert.equal(prompt.value, 'line1\n');
  });

  it('getPromptContext mengabaikan input multiline agar kode komentar // tidak memicu menu slash', () => {
    const ctx = getPromptContext('// komentar javascript\nconst a = 1;');
    assert.equal(ctx.type, 'none');
    assert.equal(ctx.matches.length, 0);
  });
});

describe('Prompt: Multiline Frame Layout (buildPromptFrame)', () => {
  it('input 2 baris harus dirender dengan indentasi rapi pada baris kedua', () => {
    const out = polos(buildPromptFrame({ value: 'baris1\nbaris2' }));
    const lines = out.split('\n');

    // Baris 0: garis batas atas
    assert.match(lines[0], /^─+$/);
    // Baris 1: prompt › baris1
    assert.equal(lines[1], '  ›  baris1');
    // Baris 2: indentasi 5 spasi sejajar teks
    assert.equal(lines[2], '     baris2');
    // Baris 3: garis batas bawah
    assert.match(lines[3], /^─+$/);
  });

  it('input 5 baris harus menampilkan kelima baris secara penuh', () => {
    const text = 'satu\ndua\ntiga\nempat\nlima';
    const out = polos(buildPromptFrame({ value: text }));
    const lines = out.split('\n');

    assert.equal(lines[1], '  ›  satu');
    assert.equal(lines[2], '     dua');
    assert.equal(lines[3], '     tiga');
    assert.equal(lines[4], '     empat');
    assert.equal(lines[5], '     lima');
    assert.match(lines[6], /^─+$/);
  });

  it('input panjang (>5 baris) harus menampilkan 2 baris pertama dan badge ringkasan', () => {
    const longText = Array.from({ length: 12 }, (_, i) => `kode baris ${i + 1}`).join('\n');
    const out = polos(buildPromptFrame({ value: longText }));
    const lines = out.split('\n');

    assert.equal(lines[1], '  ›  kode baris 1');
    assert.equal(lines[2], '     kode baris 2');
    assert.ok(lines[3].includes('[📋 +10 baris disembunyikan · total 12 baris]'));
    assert.ok(lines[3].includes('Enter kirim'));
    assert.match(lines[4], /^─+$/);
  });

  it('state submit dengan teks multiline panjang harus menampilkan ringkasan padat', () => {
    const longText = Array.from({ length: 20 }, (_, i) => `baris ${i + 1}`).join('\n');
    const out = polos(buildPromptFrame({ value: longText, state: 'submit' }));
    const lines = out.split('\n');

    assert.equal(lines[1], '  ›  baris 1');
    assert.equal(lines[2], '     baris 2');
    assert.ok(lines[3].includes('[📋 +18 baris · total 20 baris]'));
    assert.match(lines[4], /^─+$/);
  });

  it('state cancel dengan teks multiline harus menandai pembatalan dengan jelas', () => {
    const text = 'batal baris 1\nbatal baris 2';
    const out = polos(buildPromptFrame({ value: text, state: 'cancel' }));
    const lines = out.split('\n');

    assert.ok(lines[1].includes('batal baris 1'));
    assert.ok(lines[2].includes('batal baris 2'));
  });
});
