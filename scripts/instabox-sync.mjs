/**
 * Utilitas: sinkronkan berkas lokal ke mesin InstaBox, lalu jalankan perintah
 * di sandbox cloud.
 *
 * Dipakai untuk menjalankan beban kerja berat (test suite penuh, build besar,
 * benchmarking) di MicroVM InstaBox 4 vCPU / 8 GiB RAM — bukan di laptop user.
 *
 * Contoh:
 *   node scripts/instabox-sync.mjs src/tools/sandbox.js test/sandbox.test.js
 *   node scripts/instabox-sync.mjs --run "npm test"
 *   node scripts/instabox-sync.mjs src/tools/sandbox.js --run "npm test -- test/sandbox.test.js"
 *
 * Opsi:
 *   --dest <dir>   Direktori tujuan di sandbox (default: /data/home/work/repo)
 *   --run <cmd>    Perintah shell yang dijalankan setelah sinkronisasi
 *   --machine <id> ID/nama mesin InstaBox (default: dari config)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sandbox } from '@insforge/instabox-sdk';
import { getInstaboxApiKey, getInstaboxMachineId } from '../src/config.js';
import { USER_AGENT } from '../src/branding.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTABOX_API_ENDPOINT = 'https://api.instabox.sh';
const DEFAULT_DEST = '/data/home/work/repo';

/** Parse argumen CLI sederhana: --dest <dir>, --run <cmd>, --machine <id>. */
function parseArgs(argv) {
  const opts = { files: [], dest: DEFAULT_DEST, run: null, machine: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dest') opts.dest = argv[++i];
    else if (arg === '--run') opts.run = argv[++i];
    else if (arg === '--machine') opts.machine = argv[++i];
    else opts.files.push(arg);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = getInstaboxApiKey();
  if (!apiKey) {
    console.error('API Key InstaBox belum dikonfigurasi. Atur via /sandbox key <api_key>.');
    process.exit(1);
  }

  const machine = opts.machine || getInstaboxMachineId() || 'baiwor';
  const box = await Sandbox.connect(machine, {
    apiKey,
    apiUrl: INSTABOX_API_ENDPOINT,
    fetch: (url, init) => {
      const headers = new Headers(init?.headers || {});
      headers.set('User-Agent', USER_AGENT);
      return globalThis.fetch(url, { ...init, headers });
    },
  });

  for (const rel of opts.files) {
    const abs = path.resolve(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) {
      console.error(`Berkas tidak ditemukan: ${abs}`);
      process.exit(1);
    }
    const target = `${opts.dest.replace(/\/+$/, '')}/${rel.split(path.sep).join('/')}`;
    const data = fs.readFileSync(abs);
    await box.files.write(target, data);
    console.log(`[push] ${rel} -> ${target} (${data.length} bytes)`);
  }

  if (opts.run) {
    const res = await box.commands.run(opts.run, { timeoutMs: 600_000, cwd: opts.dest });
    console.log(`[run] ${opts.run} (exit ${res.exitCode})`);
    console.log(res.stdout || '');
    if (res.stderr) console.error(`[stderr]\n${res.stderr}`);
    process.exitCode = res.exitCode === 0 ? 0 : 1;
  }
}

main().catch((err) => {
  console.error(`Gagal: ${err.message}`);
  process.exit(1);
});
