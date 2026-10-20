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
import { isSubPath } from '../src/tools/sandbox.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTABOX_API_ENDPOINT = 'https://api.instabox.sh';
const DEFAULT_DEST = '/data/home/work/repo';

/** Parse argumen CLI sederhana: --dest <dir>, --run <cmd>, --machine <id>. */
function parseArgs(argv) {
  const opts = { files: [], dest: DEFAULT_DEST, run: null, machine: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dest' || arg === '--run' || arg === '--machine') {
      const value = argv[++i];
      if (!value) throw new Error(`Opsi ${arg} membutuhkan nilai.`);
      if (arg === '--dest') opts.dest = value;
      else if (arg === '--run') opts.run = value;
      else opts.machine = value;
    } else {
      opts.files.push(arg);
    }
  }
  return opts;
}

/**
 * Validasi path relatif yang akan diunggah: harus berada di dalam repo dan
 * bukan symlink yang mengarah keluar. Path absolut/`..` ditolak.
 */
function resolveRepoFile(rel) {
  if (!rel || typeof rel !== 'string' || path.isAbsolute(rel)) {
    throw new Error(`Path berkas harus relatif: ${rel}`);
  }
  const abs = path.resolve(REPO_ROOT, rel);
  if (!isSubPath(REPO_ROOT, abs)) {
    throw new Error(`Path keluar dari repo: ${rel}`);
  }
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    throw new Error(`Berkas tidak ditemukan: ${abs}`);
  }
  if (!isSubPath(fs.realpathSync(REPO_ROOT), real)) {
    throw new Error(`Berkas symlink mengarah keluar repo: ${rel}`);
  }
  if (!fs.statSync(real).isFile()) {
    throw new Error(`Bukan berkas biasa: ${rel}`);
  }
  const normalized = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
  if (normalized.startsWith('..') || normalized.includes('/../')) {
    throw new Error(`Path tidak aman: ${rel}`);
  }
  return { abs: real, normalized };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = getInstaboxApiKey();
  if (!apiKey) {
    console.error('API Key InstaBox belum dikonfigurasi. Atur via /sandbox key <api_key>.');
    process.exit(1);
  }

  if (typeof opts.dest !== 'string' || !opts.dest.startsWith('/') || opts.dest.split('/').includes('..')) {
    throw new Error(`Direktori tujuan tidak aman: ${opts.dest}`);
  }

  const files = opts.files.map(resolveRepoFile);

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

  for (const { abs, normalized } of files) {
    const target = `${opts.dest.replace(/\/+$/, '')}/${normalized}`;
    const data = fs.readFileSync(abs);
    await box.files.write(target, data);
    console.log(`[push] ${normalized} -> ${target} (${data.length} bytes)`);
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
