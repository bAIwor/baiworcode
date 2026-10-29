/**
 * Flovia doctor — cek key, auth, kuota, dan daftar tool MCP.
 *
 *   node tools/flovia/doctor.mjs
 *   node tools/flovia/doctor.mjs --call flovia_status
 *   node tools/flovia/doctor.mjs --call flovia_x '{"action":"counts","post_id":"..."}'
 *
 * Key dibaca dari: env FLOVIA_KEY -> HKCU/HKLM Environment -> ~/.baiwor/config.json.
 * Nilai key tidak pernah dicetak; hanya sumber, panjang, dan sidik jari SHA-256 (16 hex).
 */
import { resolveFloviaKey, fingerprint } from './key.mjs';

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

const { key, source } = resolveFloviaKey();
console.log('=== FLOVIA DOCTOR ===');
if (!key) {
  console.log('Key  : TIDAK DITEMUKAN');
  console.log('Cari di: env FLOVIA_KEY, HKCU/HKLM Environment, ~/.baiwor/config.json');
  process.exit(1);
}
console.log(`Key  : ada (len=${key.length}, prefix=flv_, sha256=${fingerprint(key)})`);
console.log(`Sumber: ${source}`);
console.log(`Endpoint: ${ENDPOINT}`);
console.log('');

try {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'baiworcode-flovia-doctor', version: '0.1.0' },
  }, 1, key);
  await rpc('notifications/initialized', {}, undefined, key);
  console.log('Auth : OK (initialize berhasil)');

  const list = await rpc('tools/list', {}, 2, key);
  const tools = list?.result?.tools || [];
  console.log(`Tools: ${tools.length} tersedia`);
  for (const t of tools) {
    console.log(`  - ${t.name}`);
  }
  console.log('');

  const callIdx = process.argv.indexOf('--call');
  if (callIdx !== -1) {
    const name = process.argv[callIdx + 1];
    const rawArgs = process.argv[callIdx + 2];
    const args = rawArgs ? JSON.parse(rawArgs) : {};
    console.log(`--- call ${name} ---`);
    const res = await rpc('tools/call', { name, arguments: args }, 3, key);
    const content = res?.result?.content || [];
    console.log(content.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n'));
  } else {
    const res = await rpc('tools/call', { name: 'flovia_status', arguments: {} }, 3, key);
    const content = res?.result?.content || [];
    console.log('--- flovia_status ---');
    console.log(content.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n'));
  }
} catch (e) {
  console.log(`Auth : GAGAL — ${e.message}`);
  if (e.body) console.log(e.body);
  console.log('');
  console.log('Perbaikan (dari docs.flovia.dev/troubleshooting):');
  console.log('  1) Buka https://console.flovia.dev/auth/ -> "Confirm registration" di halaman yang tampil.');
  console.log('  2) Tab API Key -> Create API key (key yang terbit saat test tidak aktif).');
  console.log('  3) Simpan:  [Environment]::SetEnvironmentVariable("FLOVIA_KEY","flv_...","User")');
  console.log('     lalu restart terminal. JANGAN tempel key ke chat atau repo.');
  process.exit(1);
}
