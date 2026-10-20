import fs from 'node:fs';
import path from 'node:path';

/**
 * Secret Detector untuk bAIwor Code.
 *
 * Mendeteksi hardcoded secrets (API keys, passwords, tokens) di berkas kode
 * menggunakan pattern matching. Penting untuk mencegah accidental commit
 * kredensial ke repository.
 *
 * Pattern yang dideteksi:
 * - API keys (generic patterns)
 * - AWS credentials
 * - GitHub tokens
 * - Private keys
 * - Passwords dalam konfigurasi
 */

/**
 * @typedef {Object} SecretMatch
 * @property {string} file - Path berkas
 * @property {number} line - Nomor baris
 * @property {string} type - Tipe secret (aws-key, github-token, dll)
 * @property {string} snippet - Potongan kode yang mengandung secret (redacted)
 */

/** Pattern regex untuk mendeteksi berbagai tipe secret. */
const SECRET_PATTERNS = [
  {
    type: 'aws-access-key',
    pattern: /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/,
    description: 'AWS Access Key ID',
  },
  {
    type: 'aws-secret-key',
    pattern: /(?:aws_secret_access_key|aws-secret-key|aws_secret)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/i,
    description: 'AWS Secret Access Key',
  },
  {
    type: 'github-token',
    pattern: /ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}/,
    description: 'GitHub Personal Access Token',
  },
  {
    type: 'generic-api-key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]([A-Za-z0-9_\-]{20,})['"]/i,
    description: 'Generic API Key',
  },
  {
    type: 'password-in-config',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]([^'"]{8,})['"]/i,
    description: 'Hardcoded Password',
  },
  {
    type: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
    description: 'Private Key',
  },
  {
    type: 'jwt-token',
    pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/,
    description: 'JWT Token',
  },
  {
    type: 'slack-token',
    pattern: /xox[baprs]-[0-9A-Za-z\-]{10,}/,
    description: 'Slack Token',
  },
  {
    type: 'stripe-key',
    pattern: /(?:sk|pk)_(?:test|live)_[0-9A-Za-z]{24,}/,
    description: 'Stripe API Key',
  },
  {
    type: 'generic-secret',
    pattern: /(?:secret|token)\s*[:=]\s*['"]([A-Za-z0-9_\-]{32,})['"]/i,
    description: 'Generic Secret/Token',
  },
];

/** Daftar file/direktori yang di-skip saat scanning. */
const SKIP_PATTERNS = [
  'node_modules',
  '.git',
  '.svn',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.baiwor',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

/**
 * Cek apakah path harus di-skip berdasarkan SKIP_PATTERNS.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function shouldSkip(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return SKIP_PATTERNS.some((pattern) => {
    if (pattern.startsWith('*.')) {
      return normalized.endsWith(pattern.slice(1));
    }
    return normalized.includes(pattern);
  });
}

/**
 * Redact secret value untuk ditampilkan di laporan (tampilkan hanya 4 karakter pertama).
 *
 * @param {string} value
 * @returns {string}
 */
function redactSecret(value) {
  if (!value || value.length < 8) return '***REDACTED***';
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 4, 20))}`;
}

/**
 * Scan sebuah berkas untuk mendeteksi hardcoded secrets.
 *
 * @param {string} filePath - Path berkas yang akan di-scan
 * @returns {SecretMatch[]}
 */
export function scanFileForSecrets(filePath) {
  const matches = [];

  if (!fs.existsSync(filePath)) return matches;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return matches;
  }

  const lines = content.split('\n');

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    for (const { type, pattern, description } of SECRET_PATTERNS) {
      const match = pattern.exec(line);
      if (match) {
        // Redact secret value dari snippet
        let snippet = line.trim();
        if (match[1]) {
          snippet = snippet.replace(match[1], redactSecret(match[1]));
        }

        matches.push({
          file: filePath,
          line: lineNum + 1,
          type,
          description,
          snippet: snippet.slice(0, 100),
        });
      }
    }
  }

  return matches;
}

/**
 * Scan direktori secara rekursif untuk mendeteksi hardcoded secrets.
 *
 * @param {string} dirPath - Direktori yang akan di-scan
 * @param {{maxFiles?: number, maxDepth?: number}} [options]
 * @returns {{matches: SecretMatch[], filesScanned: number, errors: string[]}}
 */
export function scanDirectoryForSecrets(dirPath, options = {}) {
  const { maxFiles = 1000, maxDepth = 10 } = options;
  const matches = [];
  const errors = [];
  let filesScanned = 0;

  function scanDir(currentPath, depth) {
    if (depth > maxDepth || filesScanned >= maxFiles) return;
    if (shouldSkip(currentPath)) return;

    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (err) {
      errors.push(`Cannot read ${currentPath}: ${err.message}`);
      return;
    }

    for (const entry of entries) {
      if (filesScanned >= maxFiles) break;

      const fullPath = path.join(currentPath, entry.name);

      if (shouldSkip(fullPath)) continue;

      if (entry.isDirectory()) {
        scanDir(fullPath, depth + 1);
      } else if (entry.isFile()) {
        // Skip binary files (simple check)
        if (entry.name.match(/\.(png|jpg|jpeg|gif|ico|pdf|zip|tar|gz|exe|dll|so|dylib)$/i)) {
          continue;
        }

        const fileMatches = scanFileForSecrets(fullPath);
        matches.push(...fileMatches);
        filesScanned++;
      }
    }
  }

  scanDir(dirPath, 0);

  return { matches, filesScanned, errors };
}

/**
 * Generate laporan human-readable dari hasil scan.
 *
 * @param {{matches: SecretMatch[], filesScanned: number, errors: string[]}} scanResult
 * @returns {string}
 */
export function formatSecretScanReport(scanResult) {
  const { matches, filesScanned, errors } = scanResult;

  let report = `\n🔍 Secret Scan Report\n`;
  report += `${'='.repeat(60)}\n`;
  report += `Files scanned: ${filesScanned}\n`;
  report += `Secrets found: ${matches.length}\n\n`;

  if (matches.length === 0) {
    report += `✅ No hardcoded secrets detected!\n`;
  } else {
    report += `⚠️  Found ${matches.length} potential secret(s):\n\n`;

    // Group by type
    const byType = {};
    for (const match of matches) {
      if (!byType[match.type]) byType[match.type] = [];
      byType[match.type].push(match);
    }

    for (const [type, typeMatches] of Object.entries(byType)) {
      report += `── ${typeMatches[0].description} (${type}) ──\n`;
      for (const match of typeMatches.slice(0, 5)) {
        report += `  ${match.file}:${match.line}\n`;
        report += `    ${match.snippet}\n\n`;
      }
      if (typeMatches.length > 5) {
        report += `  ... and ${typeMatches.length - 5} more\n\n`;
      }
    }

    report += `\n💡 Recommendation:\n`;
    report += `  - Move secrets to environment variables\n`;
    report += `  - Use .env files (add to .gitignore)\n`;
    report += `  - Use secret management tools (Vault, AWS Secrets Manager)\n`;
  }

  if (errors.length > 0) {
    report += `\n⚠️  Errors encountered:\n`;
    for (const err of errors.slice(0, 5)) {
      report += `  - ${err}\n`;
    }
  }

  return report;
}
