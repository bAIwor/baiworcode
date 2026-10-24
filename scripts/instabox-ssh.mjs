/**
 * Utilitas: perpanjang certificate SSH InstaBox untuk mesin yang terdaftar di
 * config baiworcode, lalu perbarui known_hosts khusus InstaBox.
 *
 * Certificate dari InstaBox bersifat sementara (default 1 jam, maksimal 24 jam),
 * jadi jalankan ulang script ini setiap kali `ssh instabox` menolak koneksi.
 *
 * Contoh:
 *   node scripts/instabox-ssh.mjs
 *   node scripts/instabox-ssh.mjs --ttl 86400
 *   node scripts/instabox-ssh.mjs --key ~/.ssh/id_other --machine m_xxx
 *
 * Opsi:
 *   --key <path>      Private key SSH (default: ~/.ssh/id_ed25519_instabox)
 *   --ttl <detik>     Masa berlaku certificate, 1..86400 (default: 28800 / 8 jam)
 *   --machine <id>    ID/nama mesin InstaBox (default: dari config)
 *   --alias <nama>    Alias `Host` di ~/.ssh/config untuk ditampilkan (default: instabox)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Sandbox } from '@insforge/instabox-sdk';
import { getInstaboxApiKey, getInstaboxMachineId } from '../src/config.js';
import { USER_AGENT } from '../src/branding.js';

const INSTABOX_API_ENDPOINT = 'https://api.instabox.sh';
const DEFAULT_KEY = path.join(os.homedir(), '.ssh', 'id_ed25519_instabox');
const DEFAULT_TTL = 8 * 60 * 60;
const MAX_TTL = 24 * 60 * 60;

/** Parse argumen CLI sederhana: --key, --ttl, --machine, --alias. */
function parseArgs(argv) {
  const opts = { key: DEFAULT_KEY, ttl: DEFAULT_TTL, machine: null, alias: 'instabox' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!['--key', '--ttl', '--machine', '--alias'].includes(arg)) {
      throw new Error(`Argumen tidak dikenal: ${arg}`);
    }
    const value = argv[++i];
    if (!value) throw new Error(`Opsi ${arg} membutuhkan nilai.`);
    if (arg === '--key') opts.key = value.replace(/^~(?=$|\/|\\)/, os.homedir());
    else if (arg === '--ttl') opts.ttl = Number(value);
    else if (arg === '--machine') opts.machine = value;
    else opts.alias = value;
  }
  if (!Number.isInteger(opts.ttl) || opts.ttl < 1 || opts.ttl > MAX_TTL) {
    throw new Error(`--ttl harus bilangan bulat 1..${MAX_TTL} detik.`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const apiKey = getInstaboxApiKey();
  if (!apiKey) {
    throw new Error('API Key InstaBox belum dikonfigurasi. Atur via /sandbox key <api_key>.');
  }

  const keyPath = path.resolve(opts.key);
  const pubPath = `${keyPath}.pub`;
  if (!fs.existsSync(keyPath) || !fs.existsSync(pubPath)) {
    throw new Error(
      `Key SSH tidak ditemukan: ${keyPath} (+ .pub).\n` +
        `Buat dengan: ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "baiworcode@instabox"`,
    );
  }

  const publicKey = fs.readFileSync(pubPath, 'utf8').trim().split(/\s+/).slice(0, 2).join(' ');
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

  const creds = await box.sshCredentials(publicKey, { ttlSeconds: opts.ttl });

  const certPath = `${keyPath}-cert.pub`;
  fs.writeFileSync(certPath, `${creds.certificate.trim()}\n`, { mode: 0o600 });

  const knownHostsPath = path.join(path.dirname(keyPath), 'known_hosts_instabox');
  const line = creds.knownHostsLine.trim();
  const lines = fs.existsSync(knownHostsPath)
    ? fs.readFileSync(knownHostsPath, 'utf8').split(/\r?\n/).filter(Boolean)
    : [];
  if (!lines.includes(line)) {
    lines.push(line);
    fs.writeFileSync(knownHostsPath, `${lines.join('\n')}\n`);
  }

  const expires = creds.expiresAt instanceof Date ? creds.expiresAt : new Date(creds.expiresAt);
  console.log(`[ok] Certificate InstaBox diperbarui untuk mesin ${machine}`);
  console.log(`     cert  : ${certPath}`);
  console.log(`     hosts : ${knownHostsPath}`);
  console.log(`     expiry: ${expires.toLocaleString('id-ID')} (${Math.round(opts.ttl / 3600)} jam)`);
  console.log(`     connect: ssh ${opts.alias}`);
}

main().catch((err) => {
  console.error(`Gagal: ${err.message}`);
  process.exit(1);
});
