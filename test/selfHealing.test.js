import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  findProjectRoot,
  runSelfHealingDiagnostics,
  buildAutoRepairPrompt,
  buildDiagnosticWarningMessage,
} from '../src/chat/selfHealing.js';

describe('Self-Healing Diagnostics', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-selfhealing-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('findProjectRoot', () => {
    it('harus mengembalikan cwd jika tidak ada berkas yang dimodifikasi', () => {
      const cwd = '/some/path';
      const result = findProjectRoot([], cwd);
      assert.equal(result, cwd);
    });

    it('harus mengembalikan direktori dari satu berkas', () => {
      const filePath = path.join(tempDir, 'src', 'index.js');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, 'test');

      const result = findProjectRoot([filePath], tempDir);
      assert.equal(result, path.dirname(filePath));
    });

    it('harus mengembalikan common ancestor dari beberapa berkas', () => {
      const file1 = path.join(tempDir, 'src', 'a.js');
      const file2 = path.join(tempDir, 'src', 'b.js');
      const file3 = path.join(tempDir, 'lib', 'c.js');

      fs.mkdirSync(path.dirname(file1), { recursive: true });
      fs.mkdirSync(path.dirname(file3), { recursive: true });
      fs.writeFileSync(file1, 'test');
      fs.writeFileSync(file2, 'test');
      fs.writeFileSync(file3, 'test');

      const result = findProjectRoot([file1, file2, file3], tempDir);
      assert.equal(result, tempDir);
    });

    it('harus menangani path relatif', () => {
      const result = findProjectRoot(['src/index.js', 'lib/util.js'], tempDir);
      assert.equal(result, tempDir);
    });
  });

  describe('runSelfHealingDiagnostics', () => {
    it('harus lulus jika tidak ada script diagnostik yang terdeteksi', async () => {
      // Buat proyek kosong tanpa package.json atau config
      const projectDir = path.join(tempDir, 'empty-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const result = await runSelfHealingDiagnostics(['src/index.js'], { cwd: projectDir });

      assert.equal(result.passed, true);
      assert.ok(result.output.includes('Tidak ada pemeriksaan diagnostik'));
      assert.deepEqual(result.errors, []);
    });

    it('harus menjalankan diagnostik dan lulus jika tidak ada error', async () => {
      // Buat proyek dengan script lint yang selalu lulus
      const projectDir = path.join(tempDir, 'good-project');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify({
          scripts: {
            lint: 'echo "Lint passed"',
          },
        })
      );

      const result = await runSelfHealingDiagnostics(['src/index.js'], { cwd: projectDir });

      assert.equal(result.passed, true);
      assert.ok(result.output.includes('Semua pemeriksaan lulus'));
    });

    it('harus mendeteksi error dari diagnostik yang gagal', async () => {
      // Buat proyek dengan script lint yang selalu gagal
      const projectDir = path.join(tempDir, 'bad-project');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify({
          scripts: {
            lint: 'echo "Error: Unexpected token" && exit 1',
          },
        })
      );

      const result = await runSelfHealingDiagnostics(['src/index.js'], { cwd: projectDir });

      assert.equal(result.passed, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some((e) => e.includes('Error')));
    });
  });

  describe('buildAutoRepairPrompt', () => {
    it('harus membangun pesan retry dengan konteks error', () => {
      const prompt = buildAutoRepairPrompt(0, 'Lint failed: syntax error', ['Error: Unexpected token']);

      assert.ok(prompt.includes('retry 1/2'));
      assert.ok(prompt.includes('Error: Unexpected token'));
      assert.ok(prompt.includes('Perbaiki error tersebut'));
    });

    it('harus membatasi jumlah error yang ditampilkan', () => {
      const manyErrors = Array.from({ length: 20 }, (_, i) => `Error ${i}`);
      const prompt = buildAutoRepairPrompt(1, 'Multiple errors', manyErrors);

      assert.ok(prompt.includes('retry 2/2'));
      // Hanya 10 error pertama yang ditampilkan
      assert.ok(prompt.includes('Error 0'));
      assert.ok(prompt.includes('Error 9'));
      assert.ok(!prompt.includes('Error 10'));
    });
  });

  describe('buildDiagnosticWarningMessage', () => {
    it('harus membangun pesan peringatan untuk pengguna', () => {
      const warning = buildDiagnosticWarningMessage('Lint failed', ['Error: syntax error']);

      assert.ok(warning.includes('Peringatan Diagnostik'));
      assert.ok(warning.includes('2x retry'));
      assert.ok(warning.includes('Error: syntax error'));
      assert.ok(warning.includes('periksa dan perbaiki manual'));
    });

    it('harus membatasi jumlah error yang ditampilkan', () => {
      const manyErrors = Array.from({ length: 10 }, (_, i) => `Error ${i}`);
      const warning = buildDiagnosticWarningMessage('Multiple errors', manyErrors);

      // Hanya 5 error pertama yang ditampilkan
      assert.ok(warning.includes('Error 0'));
      assert.ok(warning.includes('Error 4'));
      assert.ok(!warning.includes('Error 5'));
    });
  });
});
