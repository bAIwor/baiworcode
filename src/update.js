import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { theme } from './theme.js';
import { APP_NAME, VERSION, WEBSITE, CLI_USER_AGENT } from './branding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const NPM_PACKAGE = '@baiworcode/baiworcode';
const NPM_REGISTRY = 'https://registry.npmjs.org';

/** Versi terbaru paket di dist-tag `latest` npm, atau null bila tak terbaca. */
async function fetchLatestNpmVersion() {
  const res = await globalThis.fetch(
    `${NPM_REGISTRY}/${NPM_PACKAGE.replace('/', '%2F')}/latest`,
    {
      headers: { Accept: 'application/json', 'User-Agent': CLI_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return typeof data.version === 'string' ? data.version : null;
}

/**
 * Memperbarui instalasi bAIwor Code ke versi terbaru dari GitHub.
 *
 * @param {Object} [options]
 * @param {boolean} [options.yes=false] - Terapkan tanpa konfirmasi (untuk skrip/CI)
 * @returns {Promise<{ updated: boolean, message: string }>}
 */
export async function runUpdate(options = {}) {
  const assumeYes = options.yes === true;
  console.log(theme.cliTitle(`\n  🔄 Pembaruan ${APP_NAME} (Update Manager)`));
  console.log(theme.muted(`     Memeriksa pembaruan di repository resmi: ${WEBSITE}\n`));

  // 1. Cek apakah root instalasi adalah git repo
  let isGit = false;
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: REPO_ROOT, stdio: 'ignore' });
    isGit = true;
  } catch {}

  if (!isGit) {
    // Instalasi npm (mayoritas pengguna): update lewat npm, bukan git. Tetap
    // periksa registry supaya perintah ini benar-benar memberi informasi.
    console.log(theme.muted('  Instalasi ini dikelola npm (bukan checkout Git).'));
    let latest = null;
    try {
      latest = await fetchLatestNpmVersion();
    } catch (err) {
      console.log(theme.warning(`  ⚠️  Tidak dapat memeriksa registry npm: ${err.message}`));
    }

    if (latest && latest === VERSION) {
      console.log(theme.success(`\n  ✓ ${APP_NAME} v${VERSION} sudah versi terbaru di npm.\n`));
    } else if (latest) {
      console.log(theme.success(`\n  ✦ Versi terbaru di npm: v${latest} (terpasang: v${VERSION}).`));
      console.log(theme.muted('    Perbarui dengan:'));
      console.log(`    ${chalk.cyan(`npm install -g ${NPM_PACKAGE}@latest`)}\n`);
    } else {
      console.log(theme.muted('\n    Periksa/perbarui dengan:'));
      console.log(`    ${chalk.cyan(`npm install -g ${NPM_PACKAGE}@latest`)}\n`);
    }

    return {
      updated: false,
      message: latest ? `Npm installation (latest ${latest})` : 'Npm installation',
    };
  }

  // 1b. Pastikan REPO_ROOT adalah root repo (bukan subfolder repo lain) dan
  //     origin-nya repositori resmi. Tanpa ini, update bisa menarik kode dari
  //     repo induk/fork yang tidak diharapkan.
  try {
    const topLevel = execSync('git rev-parse --show-toplevel', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    const resolvedTop = path.resolve(topLevel);
    const resolvedRoot = path.resolve(REPO_ROOT);
    const sameRoot = process.platform === 'win32'
      ? resolvedTop.toLowerCase() === resolvedRoot.toLowerCase()
      : resolvedTop === resolvedRoot;
    if (!sameRoot) {
      console.log(theme.warning('  ⚠️  Folder paket ini berada di dalam repo Git lain; update dibatalkan.'));
      return { updated: false, message: 'Package is not a git repository root' };
    }

    const originUrl = execSync('git remote get-url origin', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    const isOfficialOrigin = /github\.com[:/]bAIwor\/baiworcode(?:\.git)?\/?$/i.test(originUrl);
    if (!isOfficialOrigin && process.env.BAIWOR_ALLOW_UNOFFICIAL_UPDATE !== '1') {
      console.log(theme.warning(`  ⚠️  Origin Git bukan repositori resmi bAIwor: ${originUrl}`));
      console.log(theme.muted('      Set BAIWOR_ALLOW_UNOFFICIAL_UPDATE=1 bila ini memang fork yang dipercaya.\n'));
      return { updated: false, message: 'Untrusted git origin' };
    }
  } catch (err) {
    console.log(theme.error(`  ✗ Gagal memverifikasi repositori Git: ${err.message}`));
    return { updated: false, message: err.message };
  }

  // 2. Fetch remote origin
  console.log(theme.info('  1. Menghubungi GitHub (git fetch origin main)...'));
  try {
    execSync('git fetch origin main', { cwd: REPO_ROOT, stdio: 'ignore', timeout: 15000 });
  } catch (err) {
    console.log(theme.error(`  ✗ Gagal menghubungi remote GitHub: ${err.message}`));
    console.log(theme.muted('    Pastikan koneksi internet aktif.\n'));
    return { updated: false, message: err.message };
  }

  // 3. Bandingkan HEAD dengan origin/main. SHA yang berbeda belum tentu
  //    berarti ada pembaruan: commit lokal yang belum di-push juga membuat
  //    keduanya berbeda, dan pull --ff-only justru akan gagal.
  const localHead = execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const remoteHead = execSync('git rev-parse origin/main', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const countCommits = (range) =>
    Number(execSync(`git rev-list --count ${range}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()) || 0;
  const behind = countCommits('HEAD..origin/main');
  const ahead = countCommits('origin/main..HEAD');

  if (behind === 0) {
    console.log(theme.success(`\n  ✓ ${APP_NAME} v${VERSION} sudah pada versi terbaru!`));
    console.log(theme.muted(`    Commit aktif: ${localHead.slice(0, 7)} (up to date dengan origin/main).`));
    if (ahead > 0) {
      console.log(theme.muted(`    ${ahead} commit lokal belum di-push (bukan pembaruan yang tertinggal).`));
    }
    console.log('');

    return { updated: false, message: 'Already up to date' };
  }

  if (ahead > 0) {
    console.log(theme.warning(`\n  ⚠️  Riwayat lokal bercabang dari origin/main (${ahead} commit lokal, ${behind} commit remote).`));
    console.log(theme.muted('      Update otomatis dibatalkan agar commit lokal tidak hilang.'));
    console.log(theme.muted('      Selesaikan dengan git pull --rebase atau merge secara manual.\n'));
    return { updated: false, message: 'Diverged from origin/main' };
  }

  // 4. Ada pembaruan: tampilkan ringkasan commit baru
  console.log(theme.success(`\n  ✦ Ditemukan pembaruan baru dari GitHub! (${localHead.slice(0, 7)} → ${remoteHead.slice(0, 7)})`));
  try {
    const changelog = execFileSync('git', ['log', `${localHead}..${remoteHead}`, '--oneline'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    if (changelog) {
      console.log(theme.muted('\n     Daftar Perubahan Baru:'));
      for (const line of changelog.split('\n')) {
        console.log(theme.muted(`     • ${line}`));
      }
    }
  } catch {}

  // 5. Konfirmasi sebelum menerapkan kode remote + menjalankan npm.
  if (!assumeYes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log(theme.warning('\n  ⚠️  Pembaruan memerlukan konfirmasi interaktif.'));
      console.log(theme.muted('      Jalankan ulang di terminal, atau gunakan `baiworcode update --yes`.\n'));
      return { updated: false, message: 'Confirmation required' };
    }
    const answer = await p.confirm({
      message: `Terapkan pembaruan ke commit ${remoteHead.slice(0, 7)}? Kode remote akan di-pull dan dependensi dipasang ulang.`,
      initialValue: false,
    });
    if (p.isCancel(answer) || answer !== true) {
      console.log(theme.muted('\n  Pembaruan dibatalkan.\n'));
      return { updated: false, message: 'Cancelled by user' };
    }
  }

  // 6. Tarik pembaruan (fast-forward saja; tidak membuat merge commit).
  console.log(theme.info('\n  2. Mengunduh dan menerapkan pembaruan (git pull --ff-only origin main)...'));
  try {
    execSync('git pull --ff-only origin main', { cwd: REPO_ROOT, stdio: 'inherit' });
  } catch (err) {
    console.log(theme.error(`  ✗ Gagal pull pembaruan: ${err.message}`));
    return { updated: false, message: err.message };
  }

  // 7. Instal dependensi baru tanpa lifecycle script (mengurangi permukaan RCE).
  console.log(theme.info('  3. Memperbarui dependensi (npm install --ignore-scripts)...'));
  let depsOk = true;
  try {
    execSync('npm install --ignore-scripts --prefer-offline', { cwd: REPO_ROOT, stdio: 'ignore' });
  } catch (err) {
    depsOk = false;
    console.log(theme.warning(`  ⚠️  Kode berhasil diperbarui, tetapi pemasangan dependensi gagal: ${err.message}`));
    console.log(theme.muted('      Jalankan `npm install` secara manual di folder paket.\n'));
  }

  if (depsOk) {
    console.log(theme.success.bold(`\n  ✓ ${APP_NAME} berhasil diperbarui ke commit ${remoteHead.slice(0, 7)}!`));
    console.log(theme.muted('    Semua fitur dan perbaikan terbaru kini aktif.\n'));
  }

  return {
    updated: true,
    message: depsOk
      ? `Updated to ${remoteHead.slice(0, 7)}`
      : `Updated to ${remoteHead.slice(0, 7)}, but npm install failed`,
  };
}

