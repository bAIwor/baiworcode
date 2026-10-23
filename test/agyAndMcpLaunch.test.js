import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAgyPrompt } from '../src/chat/client.js';
import { resolveMcpLaunchMode } from '../src/mcp/launchMode.js';

/* ------------------------------------------------------------------ *
 * Jembatan agy: perakitan prompt teks-murni
 * ------------------------------------------------------------------ */

test('buildAgyPrompt menyertakan petunjuk sistem, history, dan instruksi terakhir', () => {
  const prompt = buildAgyPrompt([
    { role: 'system', content: 'Kamu adalah asisten terminal.' },
    { role: 'user', content: 'Halo, apa kabar?' },
    { role: 'assistant', content: 'Baik, terima kasih.' },
    { role: 'user', content: 'Buatkan file hello.txt' },
  ]);

  assert.match(prompt, /\[PETUNJUK SISTEM\]:/);
  assert.match(prompt, /Kamu adalah asisten terminal\./);
  assert.match(prompt, /\[KONTEKS PERCAKAPAN SEBELUMNYA\]:/);
  assert.match(prompt, /\[ASSISTANT\]: Baik, terima kasih\./);
  assert.match(prompt, /\[INSTRUKSI PENGGUNA\]:\nBuatkan file hello\.txt$/);
});

test('buildAgyPrompt tidak menduplikasi pesan user terakhir saat giliran terakhir adalah assistant', () => {
  // Regresi: implementasi lama memakai slice(0, -1) yang mengasumsikan
  // pesan terakhir selalu ber-role 'user'. Saat array diakhiri balasan
  // assistant, pesan user terakhir ikut masuk history DAN menjadi instruksi
  // (terduplikasi), sementara balasan assistant hilang.
  const prompt = buildAgyPrompt([
    { role: 'system', content: 'Sistem.' },
    { role: 'user', content: 'Tanya satu' },
    { role: 'assistant', content: 'Jawab satu' },
  ]);

  const occurrences = prompt.split('Tanya satu').length - 1;
  assert.equal(occurrences, 1, 'pesan user terakhir harus muncul tepat satu kali');
  assert.match(prompt, /\[ASSISTANT\]: Jawab satu/, 'balasan assistant harus tetap ada di history');
  assert.match(prompt, /\[INSTRUKSI PENGGUNA\]:\nTanya satu$/);
});

test('buildAgyPrompt tidak menduplikasi pesan user saat giliran terakhir adalah hasil tool', () => {
  const prompt = buildAgyPrompt([
    { role: 'system', content: 'Sistem.' },
    { role: 'user', content: 'Baca file contoh.txt' },
    { role: 'assistant', content: 'Siap, saya baca.' },
    { role: 'tool', name: 'read_file', content: 'isi file' },
  ]);

  const occurrences = prompt.split('Baca file contoh.txt').length - 1;
  assert.equal(occurrences, 1, 'pesan user terakhir harus muncul tepat satu kali');
  assert.match(prompt, /\[ASSISTANT\]: Siap, saya baca\./);
  assert.match(prompt, /\[TOOL read_file\]: isi file/);
});

test('buildAgyPrompt memotong isi tool yang terlalu panjang', () => {
  const panjang = 'x'.repeat(5000);
  const prompt = buildAgyPrompt([
    { role: 'user', content: 'Tolong jalankan tool' },
    { role: 'tool', name: 'read_file', content: panjang },
  ]);

  assert.match(prompt, /\[dipotong\]/);
  assert.ok(prompt.length < 5000, `prompt harus terpotong, panjangnya ${prompt.length}`);
});

test('buildAgyPrompt menangani pesan tanpa system dan tanpa history', () => {
  const prompt = buildAgyPrompt([{ role: 'user', content: 'Hanya satu pesan' }]);
  assert.equal(prompt, '[INSTRUKSI PENGGUNA]:\nHanya satu pesan');
});

test('buildAgyPrompt tidak melempar error saat messages kosong', () => {
  const prompt = buildAgyPrompt([]);
  assert.equal(prompt, '[INSTRUKSI PENGGUNA]:\n');
});

/* ------------------------------------------------------------------ *
 * Mode peluncuran perintah `baiworcode mcp`
 * ------------------------------------------------------------------ */

test('resolveMcpLaunchMode menjalankan server stdio untuk klien MCP eksternal', () => {
  // Klien stdio menutup stdin & stdout dengan pipe.
  const mode = resolveMcpLaunchMode({
    wantsServe: false,
    action: undefined,
    stdinIsTty: false,
    stdoutIsTty: false,
    wasSlashMcp: false,
  });
  assert.equal(mode, 'serve');
});

test('resolveMcpLaunchMode tidak menggantung saat stdin di-pipe tetapi stdout terminal', () => {
  // Regresi: script/CI seperti `echo | baiworcode mcp` sebelumnya dianggap
  // klien dan menggantung sebagai server stdio.
  const mode = resolveMcpLaunchMode({
    wantsServe: false,
    action: undefined,
    stdinIsTty: false,
    stdoutIsTty: true,
    wasSlashMcp: false,
  });
  assert.equal(mode, 'manage');
});

test('resolveMcpLaunchMode memakai mode kelola saat dijalankan dari terminal interaktif', () => {
  const mode = resolveMcpLaunchMode({
    wantsServe: false,
    action: undefined,
    stdinIsTty: true,
    stdoutIsTty: true,
    wasSlashMcp: false,
  });
  assert.equal(mode, 'manage');
});

test('resolveMcpLaunchMode menghormati permintaan eksplisit --serve dan subperintah serve', () => {
  assert.equal(
    resolveMcpLaunchMode({ wantsServe: true, stdinIsTty: true, stdoutIsTty: true }),
    'serve'
  );
  assert.equal(
    resolveMcpLaunchMode({ action: 'serve', stdinIsTty: true, stdoutIsTty: true }),
    'serve'
  );
  assert.equal(
    resolveMcpLaunchMode({ action: 'server', stdinIsTty: true, stdoutIsTty: true }),
    'serve'
  );
});

test('resolveMcpLaunchMode memperlakukan `/mcp` sebagai perintah kelola, bukan server', () => {
  const mode = resolveMcpLaunchMode({
    wantsServe: false,
    action: undefined,
    stdinIsTty: false,
    stdoutIsTty: false,
    wasSlashMcp: true,
  });
  assert.equal(mode, 'manage');
});

test('resolveMcpLaunchMode tidak pernah menjadi server bila ada subperintah eksplisit', () => {
  const mode = resolveMcpLaunchMode({
    wantsServe: false,
    action: 'list',
    stdinIsTty: false,
    stdoutIsTty: false,
    wasSlashMcp: false,
  });
  assert.equal(mode, 'manage');
});
