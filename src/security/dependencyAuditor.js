import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dependency Auditor untuk bAIwor Code.
 *
 * Wrapper untuk menjalankan dependency audit tools (npm audit, pip-audit, dll)
 * dan memparse hasilnya menjadi format terstruktur. Mendeteksi vulnerable
 * dependencies dan memberikan rekomendasi perbaikan.
 *
 * Supported package managers:
 * - npm (package.json + package-lock.json)
 * - yarn (package.json + yarn.lock)
 * - pnpm (package.json + pnpm-lock.yaml)
 * - pip (requirements.txt, Pipfile, pyproject.toml)
 */

/**
 * @typedef {Object} Vulnerability
 * @property {string} package - Nama package
 * @property {string} version - Versi yang terinstall
 * @property {string} severity - Tingkat keparahan (critical, high, medium, low)
 * @property {string} title - Judul vulnerability
 * @property {string} [url] - Link ke advisory
 * @property {string} [fix] - Rekomendasi perbaikan
 */

/**
 * @typedef {Object} AuditResult
 * @property {boolean} success - Apakah audit berhasil dijalankan
 * @property {Vulnerability[]} vulnerabilities - Daftar vulnerability yang ditemukan
 * @property {number} totalDependencies - Total dependencies yang di-audit
 * @property {string} output - Raw output dari audit tool
 * @property {string} [error] - Error message jika gagal
 */

/**
 * Deteksi package manager yang digunakan di sebuah direktori.
 *
 * @param {string} dir
 * @returns {'npm' | 'yarn' | 'pnpm' | 'pip' | null}
 */
export function detectPackageManager(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
  if (fs.existsSync(path.join(dir, 'package.json'))) return 'npm';
  if (
    fs.existsSync(path.join(dir, 'requirements.txt')) ||
    fs.existsSync(path.join(dir, 'Pipfile')) ||
    fs.existsSync(path.join(dir, 'pyproject.toml'))
  ) {
    return 'pip';
  }
  return null;
}

/**
 * Jalankan npm audit dan parse hasilnya.
 *
 * @param {string} dir
 * @param {{timeout?: number}} [options]
 * @returns {Promise<AuditResult>}
 */
async function runNpmAudit(dir, options = {}) {
  const timeout = options.timeout || 60000;

  return new Promise((resolve) => {
    const child = spawn('npm', ['audit', '--json'], {
      cwd: dir,
      shell: true,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        success: false,
        vulnerabilities: [],
        totalDependencies: 0,
        output: stdout + stderr,
        error: 'npm audit timeout',
      });
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);

      try {
        const auditData = JSON.parse(stdout);
        const vulnerabilities = [];

        // npm audit JSON format
        if (auditData.vulnerabilities) {
          for (const [pkgName, pkgData] of Object.entries(auditData.vulnerabilities)) {
            const via = Array.isArray(pkgData.via) ? pkgData.via : [];
            const advisory = via[0] || {};

            vulnerabilities.push({
              package: pkgName,
              version: pkgData.range || 'unknown',
              severity: pkgData.severity || 'medium',
              title: advisory.title || pkgData.title || 'Unknown vulnerability',
              url: advisory.url || advisory.link,
              fix: pkgData.fixAvailable
                ? typeof pkgData.fixAvailable === 'object'
                  ? `Upgrade to ${pkgData.fixAvailable.name}@${pkgData.fixAvailable.version}`
                  : 'Run npm audit fix'
                : 'No automatic fix available',
            });
          }
        }

        resolve({
          success: true,
          vulnerabilities,
          totalDependencies: auditData.metadata?.totalDependencies || 0,
          output: stdout,
        });
      } catch (err) {
        resolve({
          success: false,
          vulnerabilities: [],
          totalDependencies: 0,
          output: stdout + stderr,
          error: `Failed to parse npm audit output: ${err.message}`,
        });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        vulnerabilities: [],
        totalDependencies: 0,
        output: stderr,
        error: `npm audit failed: ${err.message}`,
      });
    });
  });
}

/**
 * Jalankan pip-audit dan parse hasilnya.
 *
 * @param {string} dir
 * @param {{timeout?: number}} [options]
 * @returns {Promise<AuditResult>}
 */
async function runPipAudit(dir, options = {}) {
  const timeout = options.timeout || 60000;

  return new Promise((resolve) => {
    const child = spawn('pip-audit', ['--format', 'json'], {
      cwd: dir,
      shell: true,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        success: false,
        vulnerabilities: [],
        totalDependencies: 0,
        output: stdout + stderr,
        error: 'pip-audit timeout',
      });
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);

      try {
        const auditData = JSON.parse(stdout);
        const vulnerabilities = [];

        if (Array.isArray(auditData)) {
          for (const vuln of auditData) {
            vulnerabilities.push({
              package: vuln.name || vuln.package || 'unknown',
              version: vuln.version || 'unknown',
              severity: vuln.severity || vuln.fix_versions?.[0] ? 'high' : 'medium',
              title: vuln.description || vuln.id || 'Unknown vulnerability',
              url: vuln.url || vuln.links?.[0],
              fix: vuln.fix_versions?.[0] ? `Upgrade to ${vuln.fix_versions[0]}` : 'No fix available',
            });
          }
        }

        resolve({
          success: true,
          vulnerabilities,
          totalDependencies: auditData.length || 0,
          output: stdout,
        });
      } catch (err) {
        resolve({
          success: false,
          vulnerabilities: [],
          totalDependencies: 0,
          output: stdout + stderr,
          error: `Failed to parse pip-audit output: ${err.message}`,
        });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        vulnerabilities: [],
        totalDependencies: 0,
        output: stderr,
        error: `pip-audit failed: ${err.message}. Make sure pip-audit is installed (pip install pip-audit)`,
      });
    });
  });
}

/**
 * Jalankan dependency audit berdasarkan package manager yang terdeteksi.
 *
 * @param {string} dir - Direktori proyek
 * @param {{timeout?: number, packageManager?: string}} [options]
 * @returns {Promise<AuditResult>}
 */
export async function runDependencyAudit(dir, options = {}) {
  const packageManager = options.packageManager || detectPackageManager(dir);

  if (!packageManager) {
    return {
      success: false,
      vulnerabilities: [],
      totalDependencies: 0,
      output: '',
      error: 'No supported package manager detected (npm, yarn, pnpm, pip)',
    };
  }

  switch (packageManager) {
    case 'npm':
    case 'yarn':
    case 'pnpm':
      return runNpmAudit(dir, options);
    case 'pip':
      return runPipAudit(dir, options);
    default:
      return {
        success: false,
        vulnerabilities: [],
        totalDependencies: 0,
        output: '',
        error: `Unsupported package manager: ${packageManager}`,
      };
  }
}

/**
 * Generate laporan human-readable dari hasil audit.
 *
 * @param {AuditResult} auditResult
 * @returns {string}
 */
export function formatDependencyAuditReport(auditResult) {
  const { success, vulnerabilities, totalDependencies, output, error } = auditResult;

  let report = `\n📦 Dependency Audit Report\n`;
  report += `${'='.repeat(60)}\n`;
  report += `Total dependencies: ${totalDependencies}\n`;
  report += `Vulnerabilities found: ${vulnerabilities.length}\n\n`;

  if (!success) {
    report += `❌ Audit failed: ${error}\n`;
    if (output) {
      report += `\nRaw output:\n${output}\n`;
    }
    return report;
  }

  if (vulnerabilities.length === 0) {
    report += `✅ No known vulnerabilities detected!\n`;
  } else {
    // Group by severity
    const bySeverity = { critical: [], high: [], medium: [], low: [] };
    for (const vuln of vulnerabilities) {
      const severity = vuln.severity.toLowerCase();
      if (bySeverity[severity]) {
        bySeverity[severity].push(vuln);
      } else {
        bySeverity.medium.push(vuln);
      }
    }

    for (const [severity, vulns] of Object.entries(bySeverity)) {
      if (vulns.length === 0) continue;

      const icon = severity === 'critical' ? '🔴' : severity === 'high' ? '🟠' : severity === 'medium' ? '🟡' : '🟢';
      report += `${icon} ${severity.toUpperCase()} (${vulns.length})\n`;

      for (const vuln of vulns.slice(0, 5)) {
        report += `  • ${vuln.package}@${vuln.version}\n`;
        report += `    ${vuln.title}\n`;
        if (vuln.url) report += `    ${vuln.url}\n`;
        if (vuln.fix) report += `    Fix: ${vuln.fix}\n`;
        report += `\n`;
      }

      if (vulns.length > 5) {
        report += `  ... and ${vulns.length - 5} more\n\n`;
      }
    }

    report += `\n💡 Recommendation:\n`;
    report += `  - Run \`npm audit fix\` untuk memperbaiki vulnerability otomatis\n`;
    report += `  - Update dependencies ke versi terbaru\n`;
    report += `  - Review manual untuk vulnerability tanpa fix otomatis\n`;
  }

  return report;
}
