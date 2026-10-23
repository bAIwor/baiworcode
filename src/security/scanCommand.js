import path from 'node:path';
import { scanDirectoryForSecrets, formatSecretScanReport } from './secretDetector.js';
import { runDependencyAudit, formatDependencyAuditReport, detectPackageManager } from './dependencyAuditor.js';

/**
 * Command `/scan` untuk bAIwor Code — Guardian Banyumasan.
 *
 * Modul ini sengaja dipisah dari `bin/baiwor.js` supaya perilakunya bisa
 * diuji tanpa menjalankan CLI. `bin/baiwor.js` hanya memanggil
 * `handleScanCommand()` lalu mencetak hasilnya.
 *
 * Subcommand:
 *   /scan secrets  → pindai hardcoded secret (API key, token, private key)
 *   /scan deps     → audit dependency (npm/yarn/pnpm/pip)
 *   /scan all      → keduanya (default)
 *   /scan          → ringkasan + bantuan
 */

/** Mode scan yang dikenali. */
export const SCAN_MODES = ['secrets', 'deps', 'all'];

/** Alias yang diterima untuk tiap mode. */
const MODE_ALIASES = {
  secrets: 'secrets',
  secret: 'secrets',
  'hardcoded-secret': 'secrets',
  kredensial: 'secrets',
  deps: 'deps',
  dep: 'deps',
  dependencies: 'deps',
  dependency: 'deps',
  audit: 'deps',
  vuln: 'deps',
  all: 'all',
  full: 'all',
};

/**
 * Memetakan argumen `/scan` menjadi mode + target.
 *
 * Bentuk yang didukung:
 *   /scan                  → { mode: 'all', target: null }
 *   /scan secrets          → { mode: 'secrets', target: null }
 *   /scan deps             → { mode: 'deps', target: null }
 *   /scan all              → { mode: 'all', target: null }
 *   /scan secrets <path>   → scan secrets pada folder tertentu
 *
 * @param {string} arg
 * @returns {{ mode: string, target: string|null, unknown: string|null }}
 */
export function parseScanArg(arg = '') {
  const raw = String(arg || '').trim();
  if (!raw) return { mode: 'all', target: null, unknown: null };

  const parts = raw.split(/\s+/);
  const head = parts[0].toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  const mode = MODE_ALIASES[head];
  if (!mode) {
    return { mode: 'all', target: null, unknown: parts[0] };
  }

  return { mode, target: rest || null, unknown: null };
}

/**
 * Menjalankan pemindaian secret pada sebuah folder.
 *
 * @param {string} dir
 * @param {{maxFiles?: number, maxDepth?: number}} [options]
 * @returns {{ success: boolean, report: string, matches: Array, fixtureMatches: Array, filesScanned: number, errors: string[] }}
 */
export function runSecretScan(dir, options = {}) {
  try {
    const result = scanDirectoryForSecrets(dir, options);
    const realMatches = result.matches.filter((m) => !m.likelyFixture);
    const fixtureMatches = result.matches.filter((m) => m.likelyFixture);
    return {
      success: true,
      report: formatSecretScanReport(result),
      matches: realMatches,
      fixtureMatches,
      filesScanned: result.filesScanned,
      errors: result.errors,
    };
  } catch (err) {
    return {
      success: false,
      report: `\n❌ Secret scan gagal: ${err.message}\n`,
      matches: [],
      fixtureMatches: [],
      filesScanned: 0,
      errors: [err.message],
    };
  }
}

/**
 * Menjalankan audit dependency pada sebuah folder.
 *
 * @param {string} dir
 * @param {{timeout?: number}} [options]
 * @returns {Promise<{ success: boolean, report: string, vulnerabilities: Array, packageManager: string|null, error?: string }>}
 */
export async function runDependencyScan(dir, options = {}) {
  const result = await runDependencyAudit(dir, options);
  return {
    success: result.success,
    report: formatDependencyAuditReport(result),
    vulnerabilities: result.vulnerabilities || [],
    packageManager: result.packageManager ?? detectPackageManager(dir),
    error: result.error,
  };
}

/**
 * Menjalankan scan sesuai mode.
 *
 * @param {{mode?: string, cwd?: string, target?: string|null, timeout?: number, maxFiles?: number}} params
 * @returns {Promise<{ mode: string, dir: string, secret: object|null, dependency: object|null, totalIssues: number, report: string }>}
 */
export async function runScan({ mode = 'all', cwd = process.cwd(), target = null, timeout = 60000, maxFiles = 1000 } = {}) {
  const dir = target ? path.resolve(cwd, target) : path.resolve(cwd);

  let secret = null;
  let dependency = null;

  if (mode === 'secrets' || mode === 'all') {
    secret = runSecretScan(dir, { maxFiles });
  }

  if (mode === 'deps' || mode === 'all') {
    dependency = await runDependencyScan(dir, { timeout });
  }

  const totalIssues = (secret?.matches?.length || 0) + (dependency?.vulnerabilities?.length || 0);

  let report = `\n🛡️  Guardian Security Scan\n`;
  report += `${'='.repeat(60)}\n`;
  report += `Target  : ${dir}\n`;
  report += `Mode    : ${mode}\n`;
  report += `Waktu   : ${new Date().toISOString()}\n\n`;

  if (secret) report += secret.report;
  if (dependency) report += dependency.report;

  report += `\n${'='.repeat(60)}\n`;
  report += `RINGKASAN\n`;
  report += `${'='.repeat(60)}\n`;
  report += `Total temuan: ${totalIssues}\n`;
  if (secret) {
    report += `  • Secret hardcoded: ${secret.matches.length} (${secret.filesScanned} berkas dipindai)\n`;
    if (secret.fixtureMatches?.length) {
      report += `  • Fixture test (dummy): ${secret.fixtureMatches.length}\n`;
    }
  }
  if (dependency) {
    report += `  • Dependency rentan: ${dependency.vulnerabilities.length} (${dependency.packageManager || 'package manager tidak terdeteksi'})\n`;
  }
  report += totalIssues === 0 ? `\n✅ Tidak ada temuan keamanan.\n` : `\n⚠️  Periksa temuan di atas sebelum commit.\n`;

  return { mode, dir, secret, dependency, totalIssues, report };
}

/**
 * Bantuan `/scan` (dipakai saat command tanpa argumen).
 *
 * @returns {string}
 */
export function formatScanHelp() {
  return [
    '',
    '  🛡️  Guardian Security Scan',
    '',
    '  Perintah:',
    '    /scan secrets  → pindai hardcoded secret (API key, token, private key)',
    '    /scan deps     → audit dependency yang rentan (npm/yarn/pnpm/pip)',
    '    /scan all      → jalankan keduanya (default)',
    '    /scan secrets <path> → pindai secret pada folder tertentu',
    '',
    '  Secret yang dideteksi: AWS key, GitHub token, JWT, Slack/Stripe key,',
    '  private key, password & API key hardcoded.',
    '',
    '  Catatan: nilai secret yang ditemukan selalu disensor pada laporan.',
    '',
  ].join('\n');
}
