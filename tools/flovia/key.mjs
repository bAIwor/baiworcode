/**
 * Resolver key Flovia — SELALU baca dari sumber tepercaya, jangan pernah print nilainya.
 *
 * Urutan prioritas:
 *   1. process.env.FLOVIA_KEY
 *   2. HKCU\Environment:FLOVIA_KEY   (dipasang via setx)
 *   3. HKLM\Environment:FLOVIA_KEY   (dipasang lewat SystemProperties)
 *   4. ~/.baiwor/config.json -> mcpServers.flovia.headers.Authorization
 *   5. ~/.flovia/credentials.json / ~/.flovia/config.json (kalau ada)
 *
 * Semua sumber dibaca fresh tiap dipanggil, jadi key baru langsung terdeteksi
 * tanpa perlu restart proses agent.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

const KEY_RE = /flv_[A-Za-z0-9_\-]{8,}/;

function fromRegistry(hive) {
  try {
    const out = execFileSync(
      'reg',
      ['query', hive, 'Environment', '/v', 'FLOVIA_KEY'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const m = out.match(/FLOVIA_KEY\s+REG_\w+\s+([^\r\n]+)/);
    return m ? m[1].trim() : null;
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

/** @returns {{key: string|null, source: string}} */
export function resolveFloviaKey() {
  const fromEnv = process.env.FLOVIA_KEY;
  if (fromEnv && fromEnv.trim().startsWith('flv_')) {
    return { key: fromEnv.trim(), source: 'process.env.FLOVIA_KEY' };
  }
  const hu = fromRegistry('HKCU');
  if (hu) return { key: hu, source: 'HKCU\\Environment:FLOVIA_KEY' };
  const hlm = fromRegistry('HKLM');
  if (hlm) return { key: hlm, source: 'HKLM\\Environment:FLOVIA_KEY' };
  const baiwor = fromBaiworConfig();
  if (baiwor) return { key: baiwor, source: '~/.baiwor/config.json (mcpServers.flovia)' };
  const home = fromFloviaHome();
  if (home) return { key: home, source: '~/.flovia/*' };
  return { key: null, source: null };
}

/**
 * Sidik jari non-reversible untuk verifikasi key mana yang aktif.
 * Tampilkan hanya 16 hex char + panjang — cukup untuk membandingkan tanpa membocorkan.
 */
export function fingerprint(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
