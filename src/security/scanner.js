import { scanDirectoryForSecrets, formatSecretScanReport } from './secretDetector.js';
import { runDependencyAudit, formatDependencyAuditReport } from './dependencyAuditor.js';

/**
 * Security Scanner untuk bAIwor Code.
 *
 * Main entry point untuk menjalankan berbagai jenis security scan:
 * - Secret detection (hardcoded API keys, passwords, tokens)
 * - Dependency audit (vulnerable packages)
 * - Basic SAST (pattern-based vulnerability detection)
 *
 * Bisa dipanggil via tool `security_scan` atau command `/security-scan`.
 */

/**
 * @typedef {Object} ScanOptions
 * @property {boolean} [scanSecrets=true] - Apakah scan hardcoded secrets
 * @property {boolean} [scanDependencies=true] - Apakah audit dependencies
 * @property {boolean} [scanSAST=false] - Apakah jalankan basic SAST (belum diimplementasi)
 * @property {number} [maxFiles=1000] - Maksimal file yang di-scan untuk secrets
 * @property {number} [timeout=60000] - Timeout untuk dependency audit (ms)
 */

/**
 * @typedef {Object} ScanResult
 * @property {boolean} success - Apakah scan berhasil dijalankan
 * @property {Object} secrets - Hasil secret scan
 * @property {Object} dependencies - Hasil dependency audit
 * @property {Object} sast - Hasil SAST scan (jika diaktifkan)
 * @property {string} report - Laporan human-readable
 * @property {number} totalIssues - Total issues yang ditemukan
 */

/**
 * Jalankan security scan lengkap pada sebuah direktori.
 *
 * @param {string} dir - Direktori yang akan di-scan
 * @param {ScanOptions} [options]
 * @returns {Promise<ScanResult>}
 */
export async function runSecurityScan(dir, options = {}) {
  const {
    scanSecrets = true,
    scanDependencies = true,
    scanSAST = false,
    maxFiles = 1000,
    timeout = 60000,
  } = options;

  const result = {
    success: true,
    secrets: null,
    dependencies: null,
    sast: null,
    report: '',
    totalIssues: 0,
  };

  let fullReport = `\n🔒 Security Scan Report\n`;
  fullReport += `${'='.repeat(60)}\n`;
  fullReport += `Directory: ${dir}\n`;
  fullReport += `Scan time: ${new Date().toISOString()}\n\n`;

  // Secret Detection
  if (scanSecrets) {
    try {
      const secretResult = scanDirectoryForSecrets(dir, { maxFiles });
      result.secrets = secretResult;
      result.totalIssues += secretResult.matches.length;
      fullReport += formatSecretScanReport(secretResult);
    } catch (err) {
      result.success = false;
      fullReport += `\n❌ Secret scan failed: ${err.message}\n`;
    }
  }

  // Dependency Audit
  if (scanDependencies) {
    try {
      const depResult = await runDependencyAudit(dir, { timeout });
      result.dependencies = depResult;
      result.totalIssues += depResult.vulnerabilities.length;
      fullReport += formatDependencyAuditReport(depResult);
    } catch (err) {
      result.success = false;
      fullReport += `\n❌ Dependency audit failed: ${err.message}\n`;
    }
  }

  // SAST (placeholder for future implementation)
  if (scanSAST) {
    result.sast = {
      success: false,
      vulnerabilities: [],
      error: 'SAST scan not yet implemented',
    };
    fullReport += `\n⚠️  SAST scan not yet implemented\n`;
  }

  // Summary
  fullReport += `\n${'='.repeat(60)}\n`;
  fullReport += `SUMMARY\n`;
  fullReport += `${'='.repeat(60)}\n`;
  fullReport += `Total issues found: ${result.totalIssues}\n`;

  if (result.secrets) {
    fullReport += `  • Secrets: ${result.secrets.matches.length}\n`;
  }
  if (result.dependencies) {
    fullReport += `  • Vulnerable dependencies: ${result.dependencies.vulnerabilities.length}\n`;
  }

  if (result.totalIssues === 0) {
    fullReport += `\n✅ No security issues detected!\n`;
  } else if (result.totalIssues < 5) {
    fullReport += `\n⚠️  Found ${result.totalIssues} issue(s) — review recommended\n`;
  } else {
    fullReport += `\n❌ Found ${result.totalIssues} issue(s) — immediate action required\n`;
  }

  result.report = fullReport;
  return result;
}

/**
 * Quick scan untuk secrets saja (lebih cepat dari full scan).
 *
 * @param {string} dir
 * @param {{maxFiles?: number}} [options]
 * @returns {Object}
 */
export function quickSecretScan(dir, options = {}) {
  return scanDirectoryForSecrets(dir, options);
}

