/**
 * Resolver key Flovia — SELALU baca dari sumber tepercaya, jangan pernah print nilainya.
 *
 * Urutan prioritas untuk pemakaian tunggal:
 *   1. process.env.FLOVIA_KEY
 *   2. HKCU\Environment:FLOVIA_KEY   (dipasang via setx)
 *   3. HKLM\Environment:FLOVIA_KEY   (dipasang lewat SystemProperties)
 *   4. ~/.baiwor/config.json -> mcpServers.flovia.headers.Authorization
 *   5. ~/.flovia/credentials.json / ~/.flovia/config.json (kalau ada)
 *
 * Semua sumber dibaca fresh tiap dipanggil, jadi key baru langsung terdeteksi
 * tanpa perlu restart proses agent. `collectFloviaKeys()` mengembalikan SEMUA
 * kandidat — dipakai doctor untuk mencoba satu per satu, karena environment
 * proses bisa masih memegang key lama setelah key baru dipasang di registry.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

const KEY_RE = /flv_[A-Za-z0-9_\-]{8,}/;

function fromRegistry(hive) {
  try {
    // 'HKCU\\Environment' harus satu argumen: reg query HKCU Environment /v X
    // akan gagal karena 'Environment' dibaca sebagai nama key lain.
    const out = execFileSync(
      'reg',
      ['query', `${hive}\\Environment`, '/v', 'FLOVIA_KEY'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const m = out.match(/FLOVIA_KEY\s+REG_\w+\s+([^\r\n]+)/);
    if (!m) return null;
    const raw = m[1].trim().replace(/^"|"$/g, '');
    return raw.startsWith('flv_') ? raw : null;
  } catch {
    return null;
  }
}

function fromBaiworConfig() {
  const p = path.join(homedir(), '.baiwor', 'config.json');
  if (!existsSync(p)) return null;
  try {
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    const auth = cfg?.mcpServers?.flovia?.headers?.Authorization;
    if (typeof auth === 'string') {
      const m = auth.match(KEY_RE);
      if (m) return m[0];
    }
  } catch {
    /* abaikan config rusak */
  }
  return null;
}

function fromFloviaHome() {
  for (const name of ['credentials.json', 'config.json', 'key.txt']) {
    const p = path.join(homedir(), '.flovia', name);
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf8');
      const m = raw.match(KEY_RE);
      if (m) return m[0];
    } catch {
      /* abaikan */
    }
  }
  return null;
}

/**
 * Semua kandidat key yang ditemukan, unik berdasarkan sidik jari.
 * @returns {Array<{key: string, source: string, fingerprint: string}>}
 */
export function collectFloviaKeys() {
  const candidates = [];
  const push = (key, source) => {
    if (!key || !key.startsWith('flv_')) return;
    const fp = fingerprint(key);
    if (candidates.some((c) => c.fingerprint === fp)) return;
    candidates.push({ key, source, fingerprint: fp });
  };

  push(process.env.FLOVIA_KEY, 'process.env.FLOVIA_KEY');
  push(fromRegistry('HKCU'), 'HKCU\\Environment:FLOVIA_KEY');
  push(fromRegistry('HKLM'), 'HKLM\\Environment:FLOVIA_KEY');
  push(fromBaiworConfig(), '~/.baiwor/config.json (mcpServers.flovia)');
  push(fromFloviaHome(), '~/.flovia/*');

  return candidates;
}

/**
 * Key utama (sumber pertama yang tersedia) — dipakai saat hanya satu key yang
 * perlu dicoba, misalnya saat mendaftarkan MCP server.
 * @returns {{key: string|null, source: string|null}}
 */
export function resolveFloviaKey() {
  const first = collectFloviaKeys()[0];
  return first ? { key: first.key, source: first.source } : { key: null, source: null };
}

/**
 * Sidik jari non-reversible untuk verifikasi key mana yang aktif.
 * Tampilkan hanya 16 hex char + panjang — cukup untuk membandingkan tanpa membocorkan.
 */
export function fingerprint(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
