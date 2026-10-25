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

/** Batas ukuran berkas yang boleh dipindai (5 MB). */
const MAX_SCAN_FILE_BYTES = 5 * 1024 * 1024;

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
 * Segmen path yang menandai berkas fixture test.
 *
 * Secret di folder test hampir selalu dummy (contoh: token contoh untuk
 * menguji detektornya sendiri). Tanpa penanda, satu repo dengan 20 file
 * test akan menghasilkan puluhan temuan palsu yang menutupi secret asli.
 * Berkas TETAP dipindai — hanya hasil temuannya yang diberi label agar
 * pengguna bisa menilai sendiri.
 */
const TEST_DIR_SEGMENTS = new Set([
  'test',
  'tests',
  '__tests__',
  '__test__',
  'spec',
  'specs',
  'e2e',
  'fixtures',
  '__fixtures__',
  'mocks',
  '__mocks__',
]);

/**
 * Cek apakah path berada di dalam folder test/fixture.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function isLikelyTestFixture(filePath) {
  const segments = String(filePath || '')
    .replace(/\\/g, '/')
    .split('/');
  return segments.some((seg) => TEST_DIR_SEGMENTS.has(seg.toLowerCase()));
}

/**
 * Cek apakah path harus di-skip berdasarkan SKIP_PATTERNS.
 *
 * Pencocokan dilakukan per SEGMENT path, bukan substring. Dengan substring,
 * '.git' ikut menyaring '.github/workflows/ci.yml' dan 'build' ikut
 * menyaring 'my-buildings/' — dua tempat yang justru sering menyimpan
 * secret yang perlu ditemukan.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function shouldSkip(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return SKIP_PATTERNS.some((pattern) => {
    if (pattern.startsWith('*.')) {
      return normalized.endsWith(pattern.slice(1));
    }
    return segments.includes(pattern);
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

const PRIVATE_KEY_BLOCK_RE =
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g;

const REDACTION_RULES = [
  ...SECRET_PATTERNS.map(({ pattern }) => ({
    pattern: new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    ),
  })),
  // Bentuk .env / CLI yang tidak memakai tanda kutip: API_KEY=rahasia...
  {
    pattern:
      /(?:api[_-]?key|apikey|secret|token|password|passwd|pwd)\s*[:=]\s*['"]?([A-Za-z0-9_\-./+=]{16,})['"]?/gi,
  },
];

/**
 * Menyensor nilai secret yang dikenali dari teks bebas. Dipakai saat menulis
 * session JSONL ke disk: konteks percakapan di memori tetap utuh, tetapi
 * rahasia yang terbaca tool tidak ikut tersimpan permanen.
 *
 * @param {string} text
 * @returns {string}
 */
export function redactSecretsInText(text) {
  let out = String(text ?? '');
  if (!out) return out;

  out = out.replace(PRIVATE_KEY_BLOCK_RE, '[REDACTED PRIVATE KEY]');
  for (const rule of REDACTION_RULES) {
    out = out.replace(rule.pattern, (...args) => {
      const match = args[0];
      // Capture terakhir sebelum offset+string adalah nilai secret, bila ada.
      const groups = args.slice(1, -2);
      const secret = groups.find((group) => typeof group === 'string' && group.length > 0);
      if (secret) return match.replace(secret, '[REDACTED]');
      return '[REDACTED]';
    });
  }
  return out;
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

  // Jangan muat berkas raksasa ke memori: satu file 2 GB sudah cukup untuk
  // menghabiskan memori proses CLI.
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_SCAN_FILE_BYTES) return matches;
  } catch {
    return matches;
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return matches;
  }

  const lines = content.split('\n');

  // Satu secret bisa cocok beberapa pola (mis. "ghp_..." cocok github-token
  // sekaligus generic-secret). Tanpa dedup, satu kredensial dihitung berkali-
  // kali dan jumlah temuan jadi tidak akurat. Kunci dedup: berkas + baris +
  // nilai secret itu sendiri.
  const seen = new Map();

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    for (const { type, pattern, description } of SECRET_PATTERNS) {
      const match = pattern.exec(line);
      if (match) {
        const secretValue = match[1] || match[0];
        const dedupKey = `${filePath}:${lineNum + 1}:${secretValue}`;

        // Sama persis kredensialnya sudah ketemu di pola lain pada baris ini.
        // Kalau pola yang baru punya capture group, redaksinya lebih informatif
        // (konteks baris tetap terlihat, hanya nilainya yang disensor) —
        // pakai yang itu. Kalau tidak, temuan pertama tetap dipakai.
        const existing = seen.get(dedupKey);
        if (existing) {
          if (match[1] && !existing.hasCaptureGroup) {
            existing.snippet = line
              .trim()
              .replace(match[1], redactSecret(match[1]))
              .slice(0, 100);
            existing.hasCaptureGroup = true;
          }
          continue;
        }

        // Redact secret value dari snippet.
        // Pola BERKUMPUL KELOMPOK (capture group) menyisakan konteks baris.
        // Pola TANPA capture group (AWS key, GitHub token, JWT, Slack, Stripe)
        // match[0]-nya justru kredensial itu sendiri, jadi SELURUH baris
        // direduct — kalau hanya match[0] yang disensor, sisa kredensial
        // (mis. badan private key di baris berikutnya) tetap bocor.
        let snippet = line.trim();
        if (match[1]) {
          snippet = snippet.replace(match[1], redactSecret(match[1]));
        } else {
          snippet = redactSecret(snippet);
        }

        matches.push({
          file: filePath,
          line: lineNum + 1,
          type,
          description,
          snippet: snippet.slice(0, 100),
          likelyFixture: isLikelyTestFixture(filePath),
          hasCaptureGroup: Boolean(match[1]),
        });
        seen.set(dedupKey, matches[matches.length - 1]);
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

  // Pisahkan temuan fixture test dari temuan pada kode produksi — yang
  // fixture biasanya dummy dan hanya menutupi masalah sebenarnya.
  const realMatches = matches.filter((m) => !m.likelyFixture);
  const fixtureMatches = matches.filter((m) => m.likelyFixture);

  let report = `\n🔍 Secret Scan Report\n`;
  report += `${'='.repeat(60)}\n`;
  report += `Files scanned: ${filesScanned}\n`;
  report += `Secrets found: ${realMatches.length}\n`;
  if (fixtureMatches.length > 0) {
    report += `Likely test fixtures (dummy): ${fixtureMatches.length}\n`;
  }
  report += `\n`;

  if (realMatches.length === 0) {
    report += `✅ No hardcoded secrets detected!\n`;
  } else {
    report += `⚠️  Found ${realMatches.length} potential secret(s):\n\n`;

    // Group by type
    const byType = {};
    for (const match of realMatches) {
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

  if (fixtureMatches.length > 0) {
    report += `\nℹ️  ${fixtureMatches.length} temuan lain berada di folder test/fixture `;
    report += `(umumnya token dummy — tetap periksa bila pernah dipakai di produksi).\n`;
  }

  if (errors.length > 0) {
    report += `\n⚠️  Errors encountered:\n`;
    for (const err of errors.slice(0, 5)) {
      report += `  - ${err}\n`;
    }
  }

  return report;
}
