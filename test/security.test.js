import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  scanFileForSecrets,
  scanDirectoryForSecrets,
  formatSecretScanReport,
} from '../src/security/secretDetector.js';
import {
  detectPackageManager,
  runDependencyAudit,
  formatDependencyAuditReport,
} from '../src/security/dependencyAuditor.js';
import { runSecurityScan, quickSecretScan } from '../src/security/scanner.js';

describe('Security Scanning', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-security-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Secret Detector', () => {
    it('harus mendeteksi AWS Access Key', () => {
      const filePath = path.join(tempDir, 'test.js');
      fs.writeFileSync(filePath, 'const key = "AKIAIOSFODNN7EXAMPLE";');

      const matches = scanFileForSecrets(filePath);
      assert.ok(matches.length > 0);
      assert.equal(matches[0].type, 'aws-access-key');
    });

    it('harus mendeteksi GitHub token', () => {
      const filePath = path.join(tempDir, 'config.json');
      fs.writeFileSync(filePath, '{"token": "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"}');

      const matches = scanFileForSecrets(filePath);
      assert.ok(matches.length > 0);
      assert.equal(matches[0].type, 'github-token');
    });

    it('harus mendeteksi generic API key', () => {
      const filePath = path.join(tempDir, '.env');
      fs.writeFileSync(filePath, 'API_KEY="sk_test_1234567890abcdef1234"');

      const matches = scanFileForSecrets(filePath);
      assert.ok(matches.length > 0);
    });

    it('harus mendeteksi hardcoded password', () => {
      const filePath = path.join(tempDir, 'config.js');
      fs.writeFileSync(filePath, 'const password = "MySecretPassword123";');

      const matches = scanFileForSecrets(filePath);
      assert.ok(matches.length > 0);
      assert.equal(matches[0].type, 'password-in-config');
    });

    it('harus mendeteksi private key', () => {
      const filePath = path.join(tempDir, 'key.pem');
      fs.writeFileSync(filePath, '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...');

      const matches = scanFileForSecrets(filePath);
      assert.ok(matches.length > 0);
      assert.equal(matches[0].type, 'private-key');
    });

    it('harus scan direktori secara rekursif', () => {
      fs.mkdirSync(path.join(tempDir, 'src'));
      fs.writeFileSync(path.join(tempDir, 'src', 'config.js'), 'const apiKey = "sk_test_1234567890abcdef";');
      fs.writeFileSync(path.join(tempDir, 'test.js'), 'const password = "secret123";');

      const result = scanDirectoryForSecrets(tempDir);
      assert.ok(result.matches.length >= 2);
      assert.ok(result.filesScanned >= 2);
    });

    it('harus skip node_modules dan .git', () => {
      fs.mkdirSync(path.join(tempDir, 'node_modules'));
      fs.mkdirSync(path.join(tempDir, '.git'));
      fs.writeFileSync(path.join(tempDir, 'node_modules', 'secret.js'), 'const key = "AKIAIOSFODNN7EXAMPLE";');
      fs.writeFileSync(path.join(tempDir, 'src.js'), 'const password = "secret123";');

      const result = scanDirectoryForSecrets(tempDir);
      assert.equal(result.matches.length, 1);
      assert.ok(result.matches[0].file.includes('src.js'));
    });

    it('harus redact secret value di laporan', () => {
      const filePath = path.join(tempDir, 'test.js');
      fs.writeFileSync(filePath, 'const apiKey = "sk_test_1234567890abcdef";');

      const matches = scanFileForSecrets(filePath);
      const report = formatSecretScanReport({ matches, filesScanned: 1, errors: [] });

      assert.ok(report.includes('sk_t****'));
      assert.ok(!report.includes('sk_test_1234567890abcdef'));
    });

    it('harus mengembalikan array kosong jika tidak ada secret', () => {
      const filePath = path.join(tempDir, 'clean.js');
      fs.writeFileSync(filePath, 'console.log("Hello world");');

      const matches = scanFileForSecrets(filePath);
      assert.equal(matches.length, 0);
    });
  });

  describe('Dependency Auditor', () => {
    it('harus deteksi npm sebagai package manager', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name": "test"}');
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '{}');

      const pm = detectPackageManager(tempDir);
      assert.equal(pm, 'npm');
    });

    it('harus deteksi yarn sebagai package manager', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name": "test"}');
      fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '');

      const pm = detectPackageManager(tempDir);
      assert.equal(pm, 'yarn');
    });

    it('harus deteksi pip sebagai package manager', () => {
      fs.writeFileSync(path.join(tempDir, 'requirements.txt'), 'requests==2.26.0');

      const pm = detectPackageManager(tempDir);
      assert.equal(pm, 'pip');
    });

    it('harus return null jika tidak ada package manager', () => {
      const pm = detectPackageManager(tempDir);
      assert.equal(pm, null);
    });

    it('harus generate laporan dependency audit', () => {
      const auditResult = {
        success: true,
        vulnerabilities: [
          {
            package: 'lodash',
            version: '4.17.20',
            severity: 'high',
            title: 'Prototype Pollution',
            url: 'https://npmjs.com/advisories/1234',
            fix: 'Upgrade to 4.17.21',
          },
        ],
        totalDependencies: 100,
        output: '',
      };

      const report = formatDependencyAuditReport(auditResult);
      assert.ok(report.includes('lodash'));
      assert.ok(report.includes('Prototype Pollution'));
      assert.ok(report.includes('HIGH'));
    });
  });

  describe('Security Scanner', () => {
    it('harus jalankan full security scan', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name": "test"}');
      fs.writeFileSync(path.join(tempDir, 'config.js'), 'const password = "secret123";');

      const result = await runSecurityScan(tempDir);
      assert.ok(result.report);
      assert.ok(result.totalIssues >= 0);
    });

    it('harus quick secret scan', () => {
      fs.writeFileSync(path.join(tempDir, 'test.js'), 'const apiKey = "sk_test_1234567890abcdef";');

      const result = quickSecretScan(tempDir);
      assert.ok(result.matches.length > 0);
    });

    it('harus generate laporan lengkap', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name": "test"}');
      fs.writeFileSync(path.join(tempDir, 'secret.js'), 'const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh";');

      const result = await runSecurityScan(tempDir);
      assert.ok(result.report.includes('Security Scan Report'));
      assert.ok(result.report.includes('SUMMARY'));
    });
  });
});
