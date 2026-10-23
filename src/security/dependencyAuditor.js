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
 * Menjalankan perintah audit dengan pengumpulan stdout/stderr + timeout.
 *
 * `shell: true` sengaja TIDAK dipakai: pada Windows itu berarti argumen
 * dirangkai ke command line, sehingga karakter khusus pada path proyek bisa
 * ditafsirkan sebagai perintah lain. Sebagai gantinya, nama executable
 *Apa Ini resolved ke bentuk Windows-nya (`.cmd`/`.exe`) dan dijalankan lewat
 * spawn tanpa shell.
 *
 * @param {string[]} candidates - Nama executable yang dicoba berurutan
 * @param {string[]} args
 * @param {string} cwd
 * @param {number} timeout - ms
 * @returns {Promise<{stdout: string, stderr: string, code: number|null, failed: boolean, error?: string}>}
 */
function runAuditCommand(candidates, args, cwd, timeout) {
  return new Promise((resolve) => {
    let attempt = 0;

    const tryNext = () => {
      if (attempt >= candidates.length) {
        resolve({
          stdout: '',
          stderr: '',
          code: null,
          failed: true,
          error: `Perintah audit tidak ditemukan: ${candidates.join(', ')}`,
        });
        return;
      }

      const command = candidates[attempt];
      attempt += 1;

      // Resolusi ke node + file JS entry bila executable adalah shim
      // `.cmd`/`.bat` Windows (Node memblokir spawn-nya tanpa shell).
      let spawnCommand = command;
      let spawnArgs = args;
      const jsEntry = resolveWindowsJsEntry(command);
      if (jsEntry) {
        spawnCommand = process.execPath;
        spawnArgs = [jsEntry, ...args];
      }

      let child;
      try {
        child = spawn(spawnCommand, spawnArgs, {
          cwd,
          shell: false,
          windowsHide: true,
        });
      } catch (err) {
        resolve({
          stdout: '',
          stderr: '',
          code: null,
          failed: true,
          error: `Gagal menjalankan ${command}: ${err.message}`,
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill('SIGTERM');
        } catch {}
        resolve({
          stdout,
          stderr,
          code: null,
          failed: true,
          error: `${command} timeout setelah ${timeout} ms`,
        });
      }, timeout);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // ENOENT → executable ini tidak ada; coba kandidat berikutnya.
        if (err.code === 'ENOENT' && attempt < candidates.length) {
          tryNext();
          return;
        }
        resolve({
          stdout,
          stderr,
          code: null,
          failed: true,
          error: `${command} gagal: ${err.message}`,
        });
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, code, failed: false });
      });
    };

    tryNext();
  });
}

/**
 * Kandidat nama executable untuk sebuah tool, lintas platform.
 *
 * @param {string} name
 * @returns {string[]}
 */
function commandCandidates(name) {
  if (process.platform !== 'win32') return [name];
  return [`${name}.cmd`, `${name}.exe`, name];
}

/**
 * Mencari file JS entry dari sebuah shim `.cmd`/`.bat` Windows.
 *
 * `npm.cmd` dan friends adalah shim yang memanggil `node <path>/npm-cli.js`.
 * Node memblokir spawn file `.cmd`/`.bat` tanpa `shell: true` (perbaikan
 * CVE-2024-27980), sehingga di Windows kita menjalankan file JS-nya langsung
 * memakai `process.execPath` — tanpa shell, jadi aman dari injeksi.
 *
 * @param {string} command - Nama executable (mis. "npm.cmd")
 * @returns {string|null} Path absolut file JS entry, atau null
 */
function resolveWindowsJsEntry(command) {
  if (process.platform !== 'win32') return null;
  if (!/\.(cmd|bat)$/i.test(command)) return null;

  const toolName = command.replace(/\.(cmd|bat)$/i, '');

  // Lokasi umum shim global Node.
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', toolName, 'bin', `${toolName}-cli.js`),
    path.join(path.dirname(process.execPath), 'node_modules', toolName, 'bin', `${toolName}.js`),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }

  return null;
}

/**
 * Parse output `npm audit --json`.
 *
 * @param {string} stdout
 * @returns {Array<object>}
 */
function parseNpmAuditJson(stdout) {
  const auditData = JSON.parse(stdout);
  const vulnerabilities = [];

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

  return vulnerabilities;
}

/**
 * Parse output `pnpm audit --json` (bentuk `advisories`).
 *
 * @param {string} stdout
 * @returns {Array<object>}
 */
function parsePnpmAuditJson(stdout) {
  const auditData = JSON.parse(stdout);
  const vulnerabilities = [];

  const advisories = auditData.advisories || {};
  for (const [pkgName, adv] of Object.entries(advisories)) {
    vulnerabilities.push({
      package: pkgName,
      version: adv.vulnerable_versions || 'unknown',
      severity: adv.severity || 'medium',
      title: adv.title || 'Unknown vulnerability',
      url: adv.url,
      fix: adv.patched_versions
        ? `Upgrade to versi yang sudah dipatch: ${adv.patched_versions}`
        : 'No automatic fix available',
    });
  }

  return vulnerabilities;
}

/**
 * Parse output `yarn audit --json` (classic) — JSON per baris.
 *
 * @param {string} stdout
 * @returns {Array<object>}
 */
function parseYarnClassicAuditJson(stdout) {
  const vulnerabilities = [];

  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (entry.type !== 'auditAdvisory' || !entry.data) continue;
    const advisory = entry.data.advisory || {};
    const resolution = entry.data.resolution || {};

    vulnerabilities.push({
      package: advisory.module_name || 'unknown',
      version: resolution.path || advisory.findings?.[0]?.version || 'unknown',
      severity: advisory.severity || 'medium',
      title: advisory.title || advisory.overview || 'Unknown vulnerability',
      url: advisory.url,
      fix: advisory.patched_versions
        ? `Upgrade ke ${advisory.patched_versions}`
        : 'Tidak ada fix otomatis',
    });
  }

  return vulnerabilities;
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
  const res = await runAuditCommand(commandCandidates('npm'), ['audit', '--json'], dir, timeout);

  if (res.failed) {
    return {
      success: false,
      vulnerabilities: [],
      totalDependencies: 0,
      output: res.stdout + res.stderr,
      error: res.error || 'npm audit gagal',
    };
  }

  try {
    const auditData = JSON.parse(res.stdout);
    return {
      success: true,
      vulnerabilities: parseNpmAuditJson(res.stdout),
      totalDependencies: auditData.metadata?.totalDependencies || 0,
      output: res.stdout,
    };
  } catch (err) {
    return {
      success: false,
      vulnerabilities: [],
      totalDependencies: 0,
      output: res.stdout + res.stderr,
      error: `Gagal mengurai output npm audit: ${err.message}`,
    };
  }
}

/**
 * Jalankan audit untuk yarn.
 *
 * Yarn Berry (>=2) memakai `yarn npm audit --json` dengan format JSON mirip
 * npm. Yarn Classic (1.x) memakai `yarn audit --json` dengan format JSON
 * per-baris. Keduanya dicoba berurutan.
 *
 * @param {string} dir
 * @param {{timeout?: number}} [options]
 * @returns {Promise<AuditResult>}
 */
async function runYarnAudit(dir, options = {}) {
  const timeout = options.timeout || 60000;

  // Yarn Berry dulu (format npm-like).
  const berry = await runAuditCommand(commandCandidates('yarn'), ['npm', 'audit', '--json'], dir, timeout);
  if (!berry.failed) {
    try {
      const parsed = JSON.parse(berry.stdout);
      if (parsed.vulnerabilities || parsed.metadata) {
        return {
          success: true,
          vulnerabilities: parseNpmAuditJson(berry.stdout),
          totalDependencies: parsed.metadata?.totalDependencies || 0,
          output: berry.stdout,
        };
      }
    } catch {
      // Bukan format Berry — lanjut ke Yarn Classic.
    }
  }

  // Yarn Classic.
  const classic = await runAuditCommand(commandCandidates('yarn'), ['audit', '--json'], dir, timeout);
  if (classic.failed) {
    return {
      success: false,
      vulnerabilities: [],
      totalDependencies: 0,
      output: classic.stdout + classic.stderr,
      error: classic.error || 'yarn audit gagal',
    };
  }

  try {
    const vulnerabilities = parseYarnClassicAuditJson(classic.stdout);
    return {
      success: true,
      vulnerabilities,
      totalDependencies: vulnerabilities.length,
      output: classic.stdout,
    };
  } catch (err) {
    return {
      success: false,
      vulnerabilities: [],
      totalDependencies: 0,
      output: classic.stdout + classic.stderr,
      error: `Gagal mengurai output yarn audit: ${err.message}`,
    };
  }
}

/**
 * Jalankan audit untuk pnpm.
 *
 * @param {string} dir
 * @param {{timeout?: number}} [options]
 * @returns {Promise<AuditResult>}
 */
async function runPnpmAudit(dir, options = {}) {
  const timeout = options.timeout || 60000;
  const res = await runAuditCommand(commandCandidates('pnpm'), ['audit', '--json'], dir, timeout);

  if (res.failed) {
    return {
      success: false,
      vulnerabilities: [],
      totalDependencies: 0,
      output: res.stdout + res.stderr,
      error: res.error || 'pnpm audit gagal',
    };
  }

  try {
    const auditData = JSON.parse(res.stdout);
    return {
      success: true,
      vulnerabilities: parsePnpmAuditJson(res.stdout),
      totalDependencies: auditData.metadata?.dependencies || 0,
      output: res.stdout,
    };
  } catch (err) {
    return {
      success: false,
      vulnerabilities: [],
      totalDependencies: 0,
      output: res.stdout + res.stderr,
      error: `Gagal mengurai output pnpm audit: ${err.message}`,
    };
  }
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
  const res = await runAuditCommand(commandCandidates('pip-audit'), ['--format', 'json'], dir, timeout);

  if (res.failed) {
    return {
      success: false,
      vulnerabilities: [],
      totalDependencies: 0,
      output: res.stdout + res.stderr,
      error: `${res.error}. Pastikan pip-audit terpasang (pip install pip-audit)`,
    };
  }

  try {
    const auditData = JSON.parse(res.stdout);
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

    return {
      success: true,
      vulnerabilities,
      totalDependencies: auditData.length || 0,
      output: res.stdout,
    };
  } catch (err) {
    return {
      success: false,
      vulnerabilities: [],
      totalDependencies: 0,
      output: res.stdout + res.stderr,
      error: `Gagal mengurai output pip-audit: ${err.message}`,
    };
  }
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
      error: 'Tidak ada package manager yang didukung (npm, yarn, pnpm, pip)',
      packageManager: null,
    };
  }

  let result;
  switch (packageManager) {
    case 'npm':
      result = await runNpmAudit(dir, options);
      break;
    case 'yarn':
      result = await runYarnAudit(dir, options);
      break;
    case 'pnpm':
      result = await runPnpmAudit(dir, options);
      break;
    case 'pip':
      result = await runPipAudit(dir, options);
      break;
    default:
      result = {
        success: false,
        vulnerabilities: [],
        totalDependencies: 0,
        output: '',
        error: `Package manager tidak didukung: ${packageManager}`,
      };
  }

  return { ...result, packageManager };
}

/**
 * Generate laporan human-readable dari hasil audit.
 *
 * @param {AuditResult} auditResult
 * @returns {string}
 */
export function formatDependencyAuditReport(auditResult) {
  const { success, vulnerabilities, totalDependencies, output, error, packageManager } = auditResult;

  let report = `\n📦 Dependency Audit Report\n`;
  report += `${'='.repeat(60)}\n`;
  if (packageManager) report += `Package manager: ${packageManager}\n`;
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
    const fixCmd =
      packageManager === 'yarn'
        ? 'yarn npm audit'
        : packageManager === 'pnpm'
          ? 'pnpm audit --fix'
          : packageManager === 'pip'
            ? 'pip-audit -r requirements.txt'
            : 'npm audit fix';
    report += `  - Jalankan \`${fixCmd}\` untuk memeriksa/memperbaiki vulnerability\n`;
    report += `  - Update dependencies ke versi terbaru\n`;
    report += `  - Review manual untuk vulnerability tanpa fix otomatis\n`;
  }

  return report;
}
