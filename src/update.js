import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
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
 * @returns {Promise<{ updated: boolean, message: string }>}
 */
export async function runUpdate(options = {}) {
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
      await updateSandboxRemote();
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

  // 5. Tarik pembaruan
  console.log(theme.info('\n  2. Mengunduh dan menerapkan pembaruan (git pull origin main)...'));
  try {
    execSync('git pull origin main', { cwd: REPO_ROOT, stdio: 'inherit' });
  } catch (err) {
    console.log(theme.error(`  ✗ Gagal pull pembaruan: ${err.message}`));
    return { updated: false, message: err.message };
  }

  // 6. Instal dependensi baru jika ada
  console.log(theme.info('  3. Memperbarui dependensi (npm install)...'));
  try {
    execSync('npm install --prefer-offline', { cwd: REPO_ROOT, stdio: 'ignore' });
  } catch {}

  console.log(theme.success.bold(`\n  ✓ ${APP_NAME} berhasil diperbarui ke commit ${remoteHead.slice(0, 7)}!`));
  console.log(theme.muted('    Semua fitur dan perbaikan terbaru kini aktif.\n'));

  if (options.syncSandbox) {
    await updateSandboxRemote();
  }

  return { updated: true, message: `Updated to ${remoteHead.slice(0, 7)}` };
}

async function updateSandboxRemote() {
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
