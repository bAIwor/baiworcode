/**
 * Flovia doctor — cek key, auth, kuota, dan daftar tool MCP.
 *
 *   node tools/flovia/doctor.mjs
 *   node tools/flovia/doctor.mjs --call flovia_status
 *   node tools/flovia/doctor.mjs --call flovia_x '{"action":"counts","post_id":"..."}'
 *
 * Semua kandidat key (env, registry, ~/.baiwor/config.json) dicoba satu per satu
 * karena environment proses bisa masih memegang key lama setelah key baru
 * dipasang lewat `setx`. Nilai key tidak pernah dicetak — hanya sumber,
 * panjang, dan sidik jari SHA-256 (16 hex).
 */
import { collectFloviaKeys } from './key.mjs';

const ENDPOINT = process.env.FLOVIA_MCP_URL || 'https://api.flovia.dev/mcp';

let sessionId = null;

function parseBody(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* lanjut ke SSE */
    }
  }
  const frames = [];
  for (const block of trimmed.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!data) continue;
    try {
      frames.push(JSON.parse(data));
    } catch {
      /* abaikan frame non-JSON */
    }
  }
  return frames.length ? frames[frames.length - 1] : null;
}

async function rpc(method, params, id, key) {
  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const body = { jsonrpc: '2.0', method, params };
  if (id !== undefined) body.id = id;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = text.slice(0, 1200);
    throw err;
  }
  return parseBody(text);
}

/**
 * Coba satu key: initialize + tools/list.
 * @returns {Promise<{ok: boolean, error?: string, tools?: any[]}>}
 */
async function tryKey(key) {
  sessionId = null;
  try {
    await rpc(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'baiworcode-flovia-doctor', version: '0.1.0' },
      },
      1,
      key
    );
    await rpc('notifications/initialized', {}, undefined, key);
    const list = await rpc('tools/list', {}, 2, key);
    return { ok: true, tools: list?.result?.tools || [] };
  } catch (e) {
    return { ok: false, error: e.message, body: e.body };
  }
}

const candidates = collectFloviaKeys();

console.log('=== FLOVIA DOCTOR ===');
console.log(`Endpoint : ${ENDPOINT}`);
console.log(`Kandidat : ${candidates.length} key ditemukan`);
for (const c of candidates) {
  console.log(`  - ${c.source} | len=${c.key.length} | sha256=${c.fingerprint}`);
}
console.log('');

if (candidates.length === 0) {
  console.log('Key  : TIDAK DITEMUKAN');
  console.log('Cari di: env FLOVIA_KEY, HKCU/HKLM Environment, ~/.baiwor/config.json');
  process.exit(1);
}

let winner = null;
const failures = [];
for (const c of candidates) {
  const res = await tryKey(c.key);
  if (res.ok) {
    winner = { candidate: c, tools: res.tools };
    break;
  }
  failures.push({ candidate: c, error: res.error, body: res.body });
  console.log(`  x ${c.source} -> ${res.error}`);
}

if (!winner) {
  console.log('Auth : GAGAL untuk semua kandidat key');
  console.log('');
  for (const f of failures) {
    if (f.body) console.log(f.body);
  }
  console.log('Perbaikan (dari docs.flovia.dev/troubleshooting):');
  console.log('  1) Buka https://console.flovia.dev/auth/ -> "Confirm registration" di halaman yang tampil.');
  console.log('  2) Tab API Key -> Create API key (key yang terbit saat test tidak aktif).');
  console.log('  3) Simpan:  [Environment]::SetEnvironmentVariable("FLOVIA_KEY","flv_...","User")');
  console.log('     lalu restart terminal. JANGAN tempel key ke chat atau repo.');
  process.exit(1);
}

console.log(`Auth : OK (key dari ${winner.candidate.source})`);
console.log(`Tools: ${winner.tools.length} tersedia`);
for (const t of winner.tools) {
  console.log(`  - ${t.name}`);
}
console.log('');

const callIdx = process.argv.indexOf('--call');
const toolName = callIdx !== -1 ? process.argv[callIdx + 1] : 'flovia_status';
const rawArgs = callIdx !== -1 ? process.argv[callIdx + 2] : null;
const args = rawArgs ? JSON.parse(rawArgs) : {};

console.log(`--- ${toolName} ---`);
const res = await rpc('tools/call', { name: toolName, arguments: args }, 3, winner.candidate.key);
const content = res?.result?.content || [];
console.log(content.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n'));
