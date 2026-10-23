import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseScanArg,
  runScan,
  runSecretScan,
  runDependencyScan,
  formatScanHelp,
  SCAN_MODES,
} from '../src/security/scanCommand.js';
import { isLikelyTestFixture } from '../src/security/secretDetector.js';
import { COMMANDS, SUBCOMMANDS } from '../src/prompt.js';

describe('Guardian Security Scan (/scan)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-scan-cmd-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('parseScanArg', () => {
    it('harus memetakan subcommand ke mode yang benar', () => {
      assert.equal(parseScanArg('secrets').mode, 'secrets');
      assert.equal(parseScanArg('deps').mode, 'deps');
      assert.equal(parseScanArg('all').mode, 'all');
    });

    it('harus menerima alias', () => {
      assert.equal(parseScanArg('secret').mode, 'secrets');
      assert.equal(parseScanArg('dependencies').mode, 'deps');
      assert.equal(parseScanArg('audit').mode, 'deps');
      assert.equal(parseScanArg('full').mode, 'all');
    });

    it('harus case-insensitive', () => {
      assert.equal(parseScanArg('SECRETS').mode, 'secrets');
      assert.equal(parseScanArg('Deps').mode, 'deps');
    });

    it('harus membiarkan argumen kosong berarti mode all', () => {
      assert.equal(parseScanArg('').mode, 'all');
      assert.equal(parseScanArg('   ').mode, 'all');
    });

    it('harus menangkap target path sebagai argumen kedua', () => {
      const parsed = parseScanArg('secrets src/lib');
      assert.equal(parsed.mode, 'secrets');
      assert.equal(parsed.target, 'src/lib');
    });

    it('harus menandai subcommand yang tidak dikenal', () => {
      const parsed = parseScanArg('ngawur');
      assert.equal(parsed.unknown, 'ngawur');
      assert.equal(parsed.mode, 'all');
    });

    it('harus exposing daftar mode yang valid', () => {
      assert.deepEqual(SCAN_MODES, ['secrets', 'deps', 'all']);
    });
  });

  describe('runSecretScan', () => {
    it('harus mendeteksi secret pada berkas kode', () => {
      fs.writeFileSync(
        path.join(tempDir, 'config.js'),
        'const awsKey = "AKIAIOSFODNN7EXAMPLE";'
      );

      const res = runSecretScan(tempDir);
      assert.equal(res.success, true);
      assert.ok(res.matches.length > 0);
      assert.equal(res.matches[0].type, 'aws-access-key');
    });

    it('harus selalu mensensor nilai secret pada laporan', () => {
      fs.writeFileSync(
        path.join(tempDir, 'config.js'),
        'const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";'
      );

      const res = runSecretScan(tempDir);
      assert.ok(!res.report.includes('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'));
      assert.ok(res.report.includes('ghp_****'));
    });

    it('harus memisahkan temuan fixture test dari temuan nyata', () => {
      fs.mkdirSync(path.join(tempDir, 'test'));
      fs.writeFileSync(
        path.join(tempDir, 'test', 'dummy.js'),
        'const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";'
      );
      fs.writeFileSync(
        path.join(tempDir, 'prod.js'),
        'const awsKey = "AKIAIOSFODNN7EXAMPLE";'
      );

      const res = runSecretScan(tempDir);
      // Fixture tidak boleh dihitung sebagai temuan nyata.
      assert.equal(res.matches.length, 1);
      assert.equal(res.fixtureMatches.length, 1);
      assert.equal(res.matches[0].type, 'aws-access-key');
    });

    it('harus menandai path fixture dengan benar', () => {
      assert.equal(isLikelyTestFixture('/proj/test/foo.js'), true);
      assert.equal(isLikelyTestFixture('/proj/tests/foo.js'), true);
      assert.equal(isLikelyTestFixture('/proj/__tests__/foo.js'), true);
      assert.equal(isLikelyTestFixture('/proj/src/foo.js'), false);
      assert.equal(isLikelyTestFixture('/proj/contest/foo.js'), false);
    });
  });

  describe('runDependencyScan', () => {
    it('harus melaporkan package manager yang terdeteksi', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"test"}');
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '{}');

      const res = await runDependencyScan(tempDir, { timeout: 5000 });
      assert.equal(res.packageManager, 'npm');
    });

    it('harus menangani folder tanpa package manager tanpa melempar error', async () => {
      const res = await runDependencyScan(tempDir, { timeout: 5000 });
      assert.equal(res.success, false);
      assert.equal(res.packageManager, null);
      assert.ok(res.error);
    });
  });

  describe('runScan', () => {
    it('harus menjalankan mode secrets saja tanpa audit dependency', async () => {
      fs.writeFileSync(path.join(tempDir, 'a.js'), 'const x = 1;');

      const res = await runScan({ mode: 'secrets', cwd: tempDir });
      assert.ok(res.secret);
      assert.equal(res.dependency, null);
      assert.ok(res.report.includes('Guardian Security Scan'));
    });

    it('harus menjalankan mode deps saja tanpa secret scan', async () => {
      const res = await runScan({ mode: 'deps', cwd: tempDir, timeout: 5000 });
      assert.equal(res.secret, null);
      assert.ok(res.dependency);
    });

    it('harus menyertakan ringkasan pada laporan', async () => {
      fs.writeFileSync(path.join(tempDir, 'a.js'), 'const awsKey = "AKIAIOSFODNN7EXAMPLE";');

      const res = await runScan({ mode: 'secrets', cwd: tempDir });
      assert.ok(res.report.includes('RINGKASAN'));
      assert.ok(res.report.includes('Total temuan'));
      assert.equal(res.totalIssues, res.secret.matches.length);
    });

    it('harus menghormati target path terpisah dari cwd', async () => {
      const sub = path.join(tempDir, 'sub');
      fs.mkdirSync(sub);
      fs.writeFileSync(path.join(sub, 'a.js'), 'const awsKey = "AKIAIOSFODNN7EXAMPLE";');

      const res = await runScan({ mode: 'secrets', cwd: tempDir, target: sub });
      assert.equal(res.dir, path.resolve(sub));
      assert.ok(res.totalIssues > 0);
    });
  });

  describe('Integrasi perintah', () => {
    it('harus mendaftarkan /scan di COMMANDS', () => {
      const cmd = COMMANDS.find((c) => c.name === '/scan');
      assert.ok(cmd, 'perintah /scan harus terdaftar di COMMANDS');
      assert.ok(cmd.desc.toLowerCase().includes('scan'));
    });

    it('harus mendaftarkan subcommand secrets, deps, dan all', () => {
      const subs = SUBCOMMANDS['/scan'];
      assert.ok(subs);
      const names = subs.map((s) => s.name);
      assert.ok(names.includes('secrets'));
      assert.ok(names.includes('deps'));
      assert.ok(names.includes('all'));
    });

    it('harus menyediakan bantuan /scan', () => {
      const help = formatScanHelp();
      assert.ok(help.includes('/scan secrets'));
      assert.ok(help.includes('/scan deps'));
      assert.ok(help.includes('/scan all'));
    });
  });
});
