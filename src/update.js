import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { theme } from './theme.js';
import { handleInstaboxExec } from './tools/instaboxTool.js';
import { APP_NAME, VERSION, WEBSITE } from './branding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Memperbarui instalasi bAIwor Code ke versi terbaru dari GitHub.
 *
 * @param {Object} [options]
 * @param {boolean} [options.syncSandbox=false] - Sinkronkan juga instalasi di InstaBox
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
    console.log(theme.warning('  ⚠️  Instalasi bAIwor Code ini tidak dijalankan dari repositori Git.'));
    console.log(theme.muted('      Gunakan `npm update -g baiworcode` untuk pembaruan paket npm.\n'));
    return { updated: false, message: 'Non-git installation' };
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

  // 3. Bandingkan HEAD dengan origin/main
  const localHead = execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const remoteHead = execSync('git rev-parse origin/main', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

  if (localHead === remoteHead) {
    console.log(theme.success(`\n  ✓ ${APP_NAME} v${VERSION} sudah pada versi terbaru!`));
    console.log(theme.muted(`    Commit aktif: ${localHead.slice(0, 7)} (up to date dengan origin/main).\n`));

    if (options.syncSandbox) {
      await updateSandboxRemote(assumeYes);
    }
    return { updated: false, message: 'Already up to date' };
  }

  // 4. Ada pembaruan: tampilkan ringkasan commit baru
  console.log(theme.success(`\n  ✦ Ditemukan pembaruan baru dari GitHub! (${localHead.slice(0, 7)} → ${remoteHead.slice(0, 7)})`));
  try {
    const changelog = execSync(`git log ${localHead}..${remoteHead} --oneline`, {
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

  if (options.syncSandbox) {
    await updateSandboxRemote(assumeYes);
  }

  return {
    updated: true,
    message: depsOk
      ? `Updated to ${remoteHead.slice(0, 7)}`
      : `Updated to ${remoteHead.slice(0, 7)}, but npm install failed`,
  };
}

async function updateSandboxRemote(assumeYes = false) {
  if (!assumeYes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log(theme.warning('  ⚠️  Sinkronisasi sandbox memerlukan konfirmasi interaktif; dilewati. Gunakan --yes pada skrip.'));
      return;
    }
    const answer = await p.confirm({
      message: 'Sinkronkan InstaBox dengan `git reset --hard origin/main`? Perubahan lokal di sandbox akan dibuang.',
      initialValue: false,
    });
    if (p.isCancel(answer) || answer !== true) {
      console.log(theme.muted('  Sinkronisasi sandbox dibatalkan.\n'));
      return;
    }
  }
  console.log(theme.info('  4. Menyinkronkan pembaruan ke Cloud Sandbox InstaBox...'));
  const res = await handleInstaboxExec({
    command: 'cd /data/workspace/baiworcode && git fetch origin main && git reset --hard origin/main && npm install --prefer-offline',
    timeout_ms: 45000,
  });

  if (res.success) {
    console.log(chalk.green('  ✓ Cloud Sandbox InstaBox juga berhasil diperbarui ke versi terbaru!\n'));
  } else {
    console.log(chalk.yellow(`  ⚠️  InstaBox belum berhasil diperbarui: ${res.output}\n`));
  }
}
