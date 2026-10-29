#!/usr/bin/env node
/**
 * Probe resmi Flovia lewat MCP Streamable HTTP.
 *
 * Usage:
 *   node tools/flovia/mcp-probe.mjs list
 *   node tools/flovia/mcp-probe.mjs call <tool> [json-args]
 *
 * Auth: env FLOVIA_KEY (Bearer). Nilai key tidak pernah dicetak.
 */
import process from 'node:process';
import { resolveFloviaKey } from './key.mjs';

const ENDPOINT = process.env.FLOVIA_MCP_URL || 'https://api.flovia.dev/mcp';
const { key, source } = resolveFloviaKey();
if (!key) {
  console.error('Key Flovia tidak ditemukan (env FLOVIA_KEY / registry / ~/.baiwor/config.json).');
  process.exit(1);
}
console.error(`[key dari ${source}, len=${key.length}]`);

let sessionId = null;

function parseBody(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through to SSE */
    }
  }
  // SSE framing: event: message\ndata: {...}
  const chunks = [];
  for (const block of trimmed.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    if (dataLines.length) {
      try {
        chunks.push(JSON.parse(dataLines.join('\n')));
      } catch {
        /* ignore non-JSON frames */
      }
    }
  }
  return chunks.length ? chunks[chunks.length - 1] : null;
}

async function rpc(method, params, id) {
  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const body = { jsonrpc: '2.0', method, params };
  if (id !== undefined) body.id = id;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = text.slice(0, 2000);
    throw err;
  }
  return parseBody(text);
}

async function init() {
  const res = await rpc(
    'initialize',
    {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'baiworcode-flovia-probe', version: '0.1.0' },
    },
    1
  );
  // session ready notification
  await rpc('notifications/initialized', {}, undefined);
  return res;
}

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

const [, , cmd = 'list', ...rest] = process.argv;

try {
  await init();

  if (cmd === 'list') {
    const res = await rpc('tools/list', {}, 2);
    const tools = res?.result?.tools || [];
    console.log(`MCP tools tersedia: ${tools.length}`);
    for (const t of tools) {
      console.log(`- ${t.name}: ${(t.description || '').split('\n')[0].slice(0, 140)}`);
    }
  } else if (cmd === 'call') {
    const name = rest[0];
    const args = rest[1] ? JSON.parse(rest[1]) : {};
    const res = await rpc('tools/call', { name, arguments: args }, 3);
    print(res);
  } else if (cmd === 'status') {
    const res = await rpc('tools/call', { name: 'flovia_status', arguments: {} }, 3);
    print(res);
  } else {
    console.error(`Perintah tidak dikenal: ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`GAGAL: ${e.message}`);
  if (e.body) console.error(e.body);
  process.exit(1);
}
