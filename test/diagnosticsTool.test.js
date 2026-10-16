import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectDiagnosticCommands, handleDiagnostics } from '../src/tools/diagnosticsTool.js';

/** Membuat direktori proyek tiruan. */
function makeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-diag-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

const created = [];
function track(dir) {
  created.push(dir);
  return dir;
}

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

describe('diagnostics: deteksi perintah', () => {
  it('memprioritaskan script agregat "check"', () => {
    const dir = track(makeProject({
      'package.json': JSON.stringify({ scripts: { check: 'npm run all', lint: 'eslint .' } }),
    }));
    const cmds = detectDiagnosticCommands(dir);
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].command, 'npm run check');
  });

  it('menggabungkan typecheck lalu lint', () => {
    const dir = track(makeProject({
      'package.json': JSON.stringify({ scripts: { typecheck: 'tsc --noEmit', lint: 'eslint .' } }),
    }));
    const cmds = detectDiagnosticCommands(dir).map((c) => c.command);
    assert.deepEqual(cmds, ['npm run typecheck', 'npm run lint']);
  });

  it('jatuh ke tsc bila ada tsconfig.json tanpa script', () => {
    const dir = track(makeProject({
      'package.json': JSON.stringify({ scripts: {} }),
      'tsconfig.json': '{}',
    }));
    const cmds = detectDiagnosticCommands(dir).map((c) => c.command);
    assert.ok(cmds.some((c) => c.includes('tsc --noEmit')));
  });

  it('jatuh ke eslint bila ada konfigurasi ESLint tanpa script', () => {
    const dir = track(makeProject({
      'package.json': JSON.stringify({ scripts: {} }),
      'eslint.config.js': 'export default [];',
    }));
    const cmds = detectDiagnosticCommands(dir).map((c) => c.command);
    assert.ok(cmds.some((c) => c.includes('eslint .')));
  });

  it('mengembalikan daftar kosong bila tak ada apa-apa', () => {
    const dir = track(makeProject({ 'readme.md': '# kosong' }));
    assert.deepEqual(detectDiagnosticCommands(dir), []);
  });
});

describe('diagnostics: menjalankan pemeriksaan', () => {
  it('memberi pesan ramah saat tak ada pemeriksaan terdeteksi', async () => {
    const dir = track(makeProject({ 'readme.md': '# kosong' }));
    const res = await handleDiagnostics({ path: dir });
    assert.equal(res.success, true);
    assert.match(res.output, /Tidak ada pemeriksaan mutu yang terdeteksi/);
  });

  it('melaporkan sukses saat semua perintah lulus', async () => {
    const dir = track(makeProject({ 'readme.md': '# kosong' }));
    const res = await handleDiagnostics({ path: dir, commands: ['node --version'] });
    assert.equal(res.success, true);
    assert.match(res.output, /Semua pemeriksaan lulus/);
  });

  it('melaporkan gagal saat salah satu perintah gagal', async () => {
    const dir = track(makeProject({ 'readme.md': '# kosong' }));
    const res = await handleDiagnostics({ path: dir, commands: ['node --definitely-not-a-flag'] });
    assert.equal(res.success, false);
    assert.match(res.output, /Ada pemeriksaan yang gagal/);
  });

  it('menolak direktori yang tidak ada', async () => {
    const res = await handleDiagnostics({ path: path.join(os.tmpdir(), 'baiwor-tidak-ada-xyz') });
    assert.equal(res.success, false);
    assert.match(res.output, /tidak ditemukan/i);
  });
});
