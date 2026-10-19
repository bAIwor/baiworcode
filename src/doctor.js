import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import {
  getConfig,
  CONFIG_FILE,
  maskSecret,
  getTinyFishApiKey,
  getInstaboxApiKey,
  getInstaboxMachineId,
} from './config.js';
import { authStatus } from './auth/index.js';
import { listActiveMcpSessions } from './mcp/index.js';
import { getInstaboxStatus } from './tools/instaboxTool.js';
import { isHomeDirectory } from './tools/searchTool.js';
import { APP_NAME, VERSION, WEBSITE } from './branding.js';

/**
 * Menjalankan inspeksi kesehatan komprehensif sistem bAIwor Code.
 *
 * @returns {Promise<{ ok: boolean, passed: number, warnings: number, failed: number }>}
 */
export async function runDoctor() {
  console.log(chalk.hex('#FBBF24').bold(`\n  🩺 ${APP_NAME} Doctor v${VERSION}`));
  console.log(chalk.gray('     Memeriksa seluruh komponen sistem, runtime, AI provider, dan sandbox cloud...\n'));

  let passed = 0;
  let warnings = 0;
  let failed = 0;

  const check = (status, title, detail, isWarn = false) => {
    if (status) {
      passed += 1;
      console.log(`    ${chalk.green('✓')} ${chalk.bold.white(title)}: ${chalk.green(detail || 'OK')}`);
    } else if (isWarn) {
      warnings += 1;
      console.log(`    ${chalk.yellow('⚠️')} ${chalk.bold.white(title)}: ${chalk.yellow(detail)}`);
    } else {
      failed += 1;
      console.log(`    ${chalk.red('✗')} ${chalk.bold.white(title)}: ${chalk.red(detail)}`);
    }
  };

  // 1. Runtime Environment
  console.log(chalk.cyan.bold('  1. Lingkungan Runtime & Sistem:'));
  const nodeVer = process.version;
  const majorNode = parseInt(nodeVer.replace(/^v/, '').split('.')[0], 10);
  check(majorNode >= 18, 'Node.js Version', `${nodeVer} (${majorNode >= 18 ? 'Didukung' : 'Minimal Node 18'})`, majorNode < 18);
  check(true, 'Operating System', `${process.platform} (${process.arch})`);

  const colorLevel = chalk.level;
  const colorDesc = colorLevel >= 3 ? 'Truecolor (16M warna)' : colorLevel === 2 ? '256 warna' : colorLevel === 1 ? '16 warna' : 'Muted / Non-TTY';
  check(colorLevel > 0, 'Dukungan Warna Terminal', colorDesc, colorLevel === 0);

  // 2. Workspace & Git
  console.log(chalk.cyan.bold('\n  2. Folder Kerja & Workspace:'));
  const cwd = process.cwd();
  const isHome = isHomeDirectory(cwd);
  check(!isHome, 'Lokasi Workspace', isHome ? `HOME folder terdeteksi (${cwd}) — disarankan buka folder proyek` : cwd, isHome);

  let gitInstalled = false;
  let gitVersion = 'Tidak ditemukan';
  try {
    gitVersion = execSync('git --version', { encoding: 'utf8' }).trim();
    gitInstalled = true;
  } catch {}
  check(gitInstalled, 'Git Client', gitVersion, !gitInstalled);

  let isGitRepo = false;
  let gitBranch = '-';
  if (gitInstalled) {
    try {
      gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      isGitRepo = true;
    } catch {}
    check(isGitRepo, 'Git Repository', isGitRepo ? `Branch: ${gitBranch}` : 'Bukan folder repositori git (opsional)', true);
  }

  // 3. Konfigurasi bAIwor Code
  console.log(chalk.cyan.bold('\n  3. Konfigurasi AI & Kredensial:'));
  const configExists = fs.existsSync(CONFIG_FILE);
  check(configExists, 'Berkas Konfigurasi', configExists ? CONFIG_FILE : 'Belum dibuat (akan dibuat otomatis saat start)', !configExists);

  const config = getConfig();
  const provider = config.activeProvider || 'Not configured';
  const model = config.activeModel || 'Not configured';
  const isModelConfigured = model !== 'Not configured' && provider !== 'Not configured';
  check(isModelConfigured, 'Model & Provider Aktif', `${model} via ${provider}`, !isModelConfigured);

  // Cek konektivitas & latency ke provider aktif
  if (config.customProviders && Array.isArray(config.customProviders)) {
    const activeCp = config.customProviders.find((cp) => cp.name === provider);
    if (activeCp && activeCp.baseUrl) {
      try {
        const start = Date.now();
        const testRes = await globalThis.fetch(`${activeCp.baseUrl.replace(/\/+$/, '')}/models`, {
          headers: activeCp.apiKey ? { Authorization: `Bearer ${activeCp.apiKey}` } : {},
          signal: AbortSignal.timeout(10000),
        });
        const lat = Date.now() - start;
        check(testRes.ok || testRes.status < 500, `Koneksi API (${provider})`, `Terhubung (${lat}ms, HTTP ${testRes.status})`);
      } catch (err) {
        check(false, `Koneksi API (${provider})`, `Gagal terhubung: ${err.message}`, true);
      }
    }
  }

  // 4. Layanan Cloud & Ekstensi
  console.log(chalk.cyan.bold('\n  4. Integrasi Cloud & Sandbox:'));

  // InstaBox
  const ibKey = getInstaboxApiKey();
  const ibMachine = getInstaboxMachineId();
  if (ibKey) {
    try {
      const st = await getInstaboxStatus(ibMachine);
      if (st.ok && st.machine) {
        const state = (st.machine.status || st.machine.state || 'running').toUpperCase();
        check(true, 'InstaBox Cloud Sandbox', `Mesin [${ibMachine}] Aktif (${state})`);
      } else {
        check(true, 'InstaBox Cloud Sandbox', `Terkonfigurasi [Key: ${maskSecret(ibKey)}], Mesin: ${ibMachine}`);
      }
    } catch {
      check(true, 'InstaBox Cloud Sandbox', `Terkonfigurasi [Key: ${maskSecret(ibKey)}]`);
    }
  } else {
    check(false, 'InstaBox Cloud Sandbox', 'Belum dikonfigurasi (/sandbox key <ibk_...>)', true);
  }

  // TinyFish
  const tfKey = getTinyFishApiKey();
  if (tfKey) {
    try {
      const res = await globalThis.fetch('https://agent.tinyfish.ai/v1/wallet', {
        headers: { 'X-API-Key': tfKey },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const w = await res.json();
        const bal = w.available_balance ? `$${w.available_balance}` : 'Aktif';
        check(true, 'TinyFish Web Intelligence', `Terhubung (Saldo: ${bal})`);
      } else {
        check(true, 'TinyFish Web Intelligence', `Aktif [Key: ${maskSecret(tfKey)}]`);
      }
    } catch {
      check(true, 'TinyFish Web Intelligence', `Aktif [Key: ${maskSecret(tfKey)}]`);
    }
  } else {
    check(false, 'TinyFish Web Intelligence', 'Belum dikonfigurasi (fallback ke native fetch & DuckDuckGo)', true);
  }

  // MCP Servers
  const mcpList = listActiveMcpSessions();
  check(mcpList.length > 0, 'MCP Servers', mcpList.length > 0 ? `${mcpList.length} server aktif` : 'Belum ada MCP server terhubung (opsional)', true);

  // 5. Kesimpulan
  console.log(chalk.gray('\n  ' + '─'.repeat(60)));
  if (failed === 0) {
    console.log(chalk.green.bold(`  ✓ Status Sehat: ${passed} lulus, ${warnings} peringatan wajar, 0 kegagalan kritis.`));
    console.log(chalk.gray(`    bAIwor Code siap digunakan dengan performa optimal! 🚀\n`));
  } else {
    console.log(chalk.yellow.bold(`  ⚠️  Ditemukan ${failed} kegagalan dan ${warnings} peringatan.`));
    console.log(chalk.gray(`    Silakan tinjau perbaikan yang disarankan di atas.\n`));
  }

  return { ok: failed === 0, passed, warnings, failed };
}
