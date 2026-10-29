import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import * as p from '@clack/prompts';
import {
  getConfig,
  saveConfig,
  getTinyFishApiKey,
  getTavilyApiKey,
  getFirecrawlApiKey,
  getFloviaApiKey,
  isMcpProjectTrusted,
  trustMcpProject,
} from '../config.js';
import { registerTool, unregisterTool, hasTool } from '../tools/registry.js';

const MCP_TIMEOUT_MS = 60000;
const activeSessions = new Map(); // serverName -> McpSession

/**
 * Environment yang aman diwariskan ke server MCP stdio.
 *
 * Sebelumnya seluruh `process.env` diteruskan, sehingga API key pengguna
 * ikut terbaca oleh server MCP pihak ketiga. Hanya variabel sistem
 * yang dibutuhkan untuk menemukan executable dan berjalan normal yang
 * diwariskan; kredensial harus dideklarasikan eksplisit di `env` server.
 */
const SAFE_ENV_KEYS = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
  'PROGRAMW6432', 'COMMONPROGRAMFILES', 'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'OS', 'SHELL', 'TERM',
  'TERMINFO', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'USER', 'USERNAME',
  'LOGNAME', 'PWD', 'OLDPWD', 'TZ', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
  'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'DISPLAY', 'WAYLAND_DISPLAY',
  'DBUS_SESSION_BUS_ADDRESS',
]);

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * Memvalidasi URL server MCP remote. HTTP hanya diizinkan untuk loopback
 * (server lokal saat pengembangan); host lain wajib HTTPS agar header API key
 * tidak dikirim tanpa enkripsi.
 *
 * @param {string} raw
 * @returns {string}
 */
export function validateMcpUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error(`URL MCP tidak valid: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Skema URL MCP tidak didukung (${url.protocol}). Gunakan http atau https.`);
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error('Server MCP remote wajib memakai HTTPS (HTTP hanya diizinkan untuk localhost).');
  }
  return url.toString();
}

/**
 * Menandai nilai yang masih mengandung placeholder variabel lingkungan.
 * Bentuknya `${NAMA}` atau `${NAMA:-nilai_cadangan}` — sama seperti yang dipakai
 * dokumentasi MCP client lain (Cursor, Claude Code) untuk menyembunyikan API key
 * dari berkas konfigurasi.
 */
const ENV_PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Mengganti `${VAR}` di seluruh nilai konfigurasi server MCP dengan isi
 * environment. Berlaku rekursif (object/array/string), hanya pada nilai — nama
 * key tidak pernah diganti.
 *
 * Placeholder tanpa cadangan yang variabelnya kosong dianggap kesalahan
 * konfigurasi, bukan dikirim sebagai string kosong: server akan menolak dengan
 * pesan 401 yang membingungkan bagi pemula.
 *
 * @param {any} value konfigurasi mentah
 * @param {Record<string,string|undefined>} [env]
 * @param {string} [serverName] dipakai agar pesan kesalahan menyebut servernya
 * @returns {any} salinan konfigurasi dengan placeholder terselesaikan
 */
export function resolveMcpSecrets(value, env = process.env, serverName = '') {
  const missing = new Set();

  const walk = (v) => {
    if (typeof v === 'string') {
      if (!v.includes('${')) return v;
      return v.replace(ENV_PLACEHOLDER, (_whole, name, fallback) => {
        const fromEnv = env[name];
        if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv;
        if (fallback !== undefined) return fallback;
        missing.add(name);
        return '';
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };

  const resolved = walk(value);
  if (missing.size > 0) {
    const label = serverName ? `'${serverName}' ` : '';
    throw new Error(
      `Server MCP ${label}membutuhkan variabel lingkungan yang belum diisi: ` +
        `${[...missing].map((n) => `\${${n}}`).join(', ')}. ` +
        `Isi lewat terminal sebelum menjalankan baiworcode, atau tulis kunci langsung di konfigurasi.`
    );
  }
  return resolved;
}

/**
 * Menyusun environment untuk proses MCP stdio: variabel sistem yang aman +
 * `env` eksplisit dari konfigurasi server.
 *
 * @param {Record<string,string>} [extra]
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @returns {Record<string,string>}
 */
export function buildSafeMcpEnv(extra = {}, baseEnv = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (typeof value === 'string' && SAFE_ENV_KEYS.has(key.toUpperCase())) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(extra || {})) {
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

/** Fetch MCP dengan batas waktu agar startup tidak menggantung selamanya. */
function mcpFetch(url, init = {}) {
  return fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(MCP_TIMEOUT_MS),
  });
}

/**
 * Mengambil berkas-berkas JSON dari bingkai SSE (`event: …` + `data: …`).
 * Data satu peristiwa dapat terpecah ke beberapa baris `data:`, jadi disatukan
 * sebelum diurai.
 *
 * @param {string} text
 * @returns {any[]}
 */
function parseSsePayloads(text) {
  const payloads = [];
  for (const block of String(text).split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data || data === '[DONE]') continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {}
  }
  return payloads;
}

/**
 * Membaca balasan server MCP.
 *
 * Spesifikasinya mengizinkan dua wujud: JSON biasa atau aliran SSE. Server
 * bawaan memakai JSON, tetapi layanan besar seperti Tavily dan Firecrawl selalu
 * membalas dengan bingkai SSE — tanpa penanganan ini connect akan gagal dengan
 * kesalahan parse JSON.
 *
 * Yang diambil adalah balasan JSON-RPC terakhir, karena server boleh mengirim
 * notifikasi (mis. progress) mendahului jawaban permintaan.
 *
 * @param {Response} res
 * @returns {Promise<any>}
 */
export async function readMcpJson(res) {
  const text = await res.text();
  const trimmed = text.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }

  const payloads = parseSsePayloads(text);
  const jawaban = payloads.filter((p) => p && ('result' in p || 'error' in p || 'id' in p));
  if (jawaban.length > 0) return jawaban[jawaban.length - 1];
  if (payloads.length > 0) return payloads[payloads.length - 1];

  throw new Error(
    `Balasan MCP tidak dapat dibaca (content-type: ${res.headers.get('content-type') || 'tidak ada'}): ${trimmed.slice(0, 160)}`
  );
}

/**
 * Kelas penanganan koneksi MCP Session (HTTP / Stdio)
 */
const WINDOWS_SHELL_COMMANDS = new Set(['npx', 'npm', 'pnpm', 'yarn', 'uvx', 'uv', 'bunx', 'bun']);
const CONTROL_CHARS_RE = /[\0\r\n]/;

/**
 * Windows hanya butuh shell untuk shim .cmd/.bat (npx, uvx, dsb.). Perintah
 * executable biasa (node, path .exe) dijalankan tanpa shell agar argumen tidak
 * diinterpretasikan sebagai perintah shell.
 *
 * @param {string} command
 * @param {NodeJS.Platform} [platform]
 * @returns {boolean}
 */
export function needsWindowsShell(command, platform = process.platform) {
  if (platform !== 'win32') return false;
  const value = String(command || '').toLowerCase();
  if (value.endsWith('.cmd') || value.endsWith('.bat')) return true;
  if (/[\\/]/.test(value)) return false;
  return WINDOWS_SHELL_COMMANDS.has(value);
}

/**
 * Tolak karakter kontrol (NUL/newline) yang bisa memecah command/argumen
 * menjadi perintah tambahan pada shell Windows.
 *
 * @param {string} command
 * @param {Array<string|number>} [args]
 */
export function assertSafeStdioSpec(command, args = []) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('MCP stdio: command wajib berupa string non-kosong.');
  }
  if (!Array.isArray(args)) {
    throw new Error('MCP stdio: args harus berupa array.');
  }
  for (const value of [command, ...args]) {
    if (typeof value === 'string' && CONTROL_CHARS_RE.test(value)) {
      throw new Error('MCP stdio: command/args mengandung karakter kontrol (NUL/newline).');
    }
  }
}

export class McpSession {
  constructor(name, config) {
    this.name = name;
    this.config = resolveMcpSecrets(config, process.env, name);
    this.type = this.config.type || (this.config.command ? 'stdio' : 'remote');
    this.status = 'disconnected';
    this.tools = [];
    this.sessionId = null;
    this.childProcess = null;
    this.pendingRequests = new Map();
    this.nextId = 1;
    this.registeredToolNames = [];
  }

  async connect() {
    this.status = 'connecting';
    try {
      if (this.type === 'stdio') {
        await this._connectStdio();
      } else {
        await this._connectRemote();
      }
    } catch (err) {
      // Jangan tinggalkan proses stdio yatim saat inisialisasi gagal.
      this.close();
      throw err;
    }
  }

  async _connectRemote() {
    if (!this.config.url) throw new Error(`Server MCP '${this.name}' tidak memiliki parameter 'url'.`);
    const url = validateMcpUrl(this.config.url);

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.config.headers || {}),
    };

    // 1. Initialize
    const initRes = await mcpFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'bAIworCode', version: '1.0.0' },
        },
      }),
    });

    if (!initRes.ok) {
      const errText = await initRes.text();
      throw new Error(`MCP initialize gagal (HTTP ${initRes.status}): ${errText}`);
    }

    // Ambil session-id jika disediakan oleh server MCP
    this.sessionId = initRes.headers.get('mcp-session-id') || null;

    // 2. Notifications: initialized
    const notifyHeaders = { ...headers };
    if (this.sessionId) notifyHeaders['mcp-session-id'] = this.sessionId;

    try {
      await mcpFetch(url, {
        method: 'POST',
        headers: notifyHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });
    } catch {}

    // 3. Tools: list
    const toolsRes = await mcpFetch(url, {
      method: 'POST',
      headers: notifyHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'tools/list',
        params: {},
      }),
    });

    if (!toolsRes.ok) {
      throw new Error(`MCP tools/list gagal (HTTP ${toolsRes.status})`);
    }

    const toolsData = await readMcpJson(toolsRes);
    this.tools = Array.isArray(toolsData.result?.tools) ? toolsData.result.tools : [];
    this.status = 'connected';
  }

  async _connectStdio() {
    const { command, args = [], env = {} } = this.config;
    if (!command) throw new Error(`Server MCP stdio '${this.name}' wajib menentukan 'command'.`);
    assertSafeStdioSpec(command, args);

    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: buildSafeMcpEnv(env),
      // Shell hanya untuk shim .cmd/.bat yang memang membutuhkannya.
      shell: needsWindowsShell(command),
      windowsHide: true,
    });

    this.childProcess = child;

    const rl = readline.createInterface({
      input: child.stdout,
      terminal: false,
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const { resolve, reject, timer } = this.pendingRequests.get(msg.id);
          clearTimeout(timer);
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || `MCP Error code: ${msg.error.code}`));
          } else {
            resolve(msg.result);
          }
        }
      } catch {}
    });

    child.on('error', (err) => {
      this.status = 'error';
      for (const { reject, timer } of this.pendingRequests.values()) {
        clearTimeout(timer);
        reject(err);
      }
      this.pendingRequests.clear();
    });

    child.on('exit', () => {
      this.status = 'disconnected';
    });

    // 1. Initialize
    await this._sendStdioRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'bAIworCode', version: '1.0.0' },
    });

    // 2. Notifications: initialized
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }) + '\n'
    );

    // 3. Tools: list
    const toolsRes = await this._sendStdioRequest('tools/list', {});
    this.tools = Array.isArray(toolsRes?.tools) ? toolsRes.tools : [];
    this.status = 'connected';
  }

  _sendStdioRequest(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.childProcess || !this.childProcess.stdin) {
        return reject(new Error('Child process stdio tidak tersedia'));
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request '${method}' melebihi batas waktu ${MCP_TIMEOUT_MS}ms`));
        }
      }, MCP_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.childProcess.stdin.write(payload);
    });
  }

  async callTool(toolName, args = {}) {
    if (this.type === 'stdio') {
      const res = await this._sendStdioRequest('tools/call', {
        name: toolName,
        arguments: args,
      });
      return this._formatToolOutput(res);
    } else {
      const url = validateMcpUrl(this.config.url);
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.config.headers || {}),
      };
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

      const res = await mcpFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.nextId++,
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          success: false,
          output: `Gagal memanggil MCP tool '${toolName}' (HTTP ${res.status}): ${errText}`,
        };
      }

      const data = await readMcpJson(res);
      if (data.error) {
        return {
          success: false,
          output: `Error MCP tool '${toolName}': ${data.error.message || JSON.stringify(data.error)}`,
        };
      }

      return this._formatToolOutput(data.result);
    }
  }

  _formatToolOutput(result) {
    if (!result) return { success: true, output: '' };
    const isError = !!result.isError;
    const contents = Array.isArray(result.content) ? result.content : [];
    const texts = contents.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
    return {
      success: !isError,
      output: texts || JSON.stringify(result, null, 2),
    };
  }

  close() {
    if (this.childProcess) {
      try {
        this.childProcess.kill();
      } catch {}
      this.childProcess = null;
    }
    for (const toolName of this.registeredToolNames) {
      try {
        unregisterTool(toolName);
      } catch {}
    }
    this.registeredToolNames = [];
    this.status = 'disconnected';
    this.tools = [];
  }
}

/**
 * Membaca satu berkas konfigurasi MCP dan memvalidasi bentuknya.
 *
 * @param {string} filePath
 * @returns {{ servers: Record<string, Object>, raw: string }}
 */
function readMcpConfigFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const servers = parsed?.mcpServers || parsed;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error('format mcpServers tidak valid');
  }
  return { servers, raw };
}

/**
 * Membaca konfigurasi MCP global dan proyek, sekaligus menyimpan metadata
 * proyek (berkas + hash) untuk mekanisme persetujuan.
 *
 * @param {string} [cwd]
 * @returns {{
 *   configs: Record<string, Object>,
 *   globalConfigs: Record<string, Object>,
 *   project: null|{ file: string, hash: string, servers: Record<string, Object> }
 * }}
 */
export function loadMcpConfigDetailed(cwd = process.cwd()) {
  const globalConfigs = {};

  // 1. Konfigurasi bawaan config.json (~/.baiwor/config.json -> mcpServers)
  try {
    const mainConfig = getConfig();
    if (mainConfig.mcpServers && typeof mainConfig.mcpServers === 'object') {
      Object.assign(globalConfigs, mainConfig.mcpServers);
    }
  } catch {}

  // 2. Jika TinyFish key tersedia dan belum ada entri 'tinyfish', daftarkan otomatis
  const tinyfishKey = getTinyFishApiKey();
  if (tinyfishKey && !globalConfigs.tinyfish) {
    globalConfigs.tinyfish = {
      type: 'remote',
      url: 'https://agent.tinyfish.ai/mcp',
      headers: {
        'X-API-Key': tinyfishKey,
      },
    };
  }

  // 2b. Tavily & Firecrawl: daftarkan otomatis bila usernyanya punya API key,
  //     selama entri dengan nama itu belum dibuat manual. Kunci dikirim lewat
  //     header Authorization (bukan query string) agar tidak tersimpan di URL
  //     maupun log server.
  const tavilyKey = getTavilyApiKey();
  if (tavilyKey && !globalConfigs.tavily) {
    globalConfigs.tavily = {
      type: 'remote',
      url: 'https://mcp.tavily.com/mcp/',
      headers: { Authorization: `Bearer ${tavilyKey}` },
    };
  }

  const firecrawlKey = getFirecrawlApiKey();
  if (firecrawlKey && !globalConfigs.firecrawl) {
    globalConfigs.firecrawl = {
      type: 'remote',
      url: 'https://mcp.firecrawl.dev/v2/mcp',
      headers: { Authorization: `Bearer ${firecrawlKey}` },
    };
  }

  // 2c. Flovia: satu MCP server resmi yang menyediakan data X (post publik
  //     7 hari terakhir), riset web (Exa/Firecrawl), data on-chain (Nansen,
  //     CoinGecko, Zerion, QuickNode) dan generasi teks. Didaftarkan otomatis
  //     bila pengguna punya FLOVIA_KEY (env) atau floviaApiKey di konfigurasi,
  //     selama entri 'flovia' belum dibuat manual. Kunci dikirim lewat header
  //     Authorization agar tidak tersimpan di URL maupun log server.
  const floviaKey = getFloviaApiKey();
  if (floviaKey && !globalConfigs.flovia) {
    globalConfigs.flovia = {
      type: 'remote',
      url: 'https://api.flovia.dev/mcp',
      headers: { Authorization: `Bearer ${floviaKey}` },
    };
  }

  // 3. Konfigurasi ~/.baiwor/mcp.json jika ada
  try {
    const globalMcpFile = path.join(os.homedir(), '.baiwor', 'mcp.json');
    if (fs.existsSync(globalMcpFile)) {
      const { servers } = readMcpConfigFile(globalMcpFile);
      Object.assign(globalConfigs, servers);
    }
  } catch {}

  // 4. Konfigurasi proyek lokal .baiwor/mcp.json atau .mcp.json.
  //    Isinya TIDAK langsung dieksekusi: initAllMcpServers meminta
  //    persetujuan lebih dulu (lihat isMcpProjectTrusted/trustMcpProject).
  let project = null;
  for (const file of [path.join(cwd, '.baiwor', 'mcp.json'), path.join(cwd, '.mcp.json')]) {
    if (!fs.existsSync(file)) continue;
    try {
      const { servers, raw } = readMcpConfigFile(file);
      project = {
        file,
        hash: crypto.createHash('sha256').update(raw).digest('hex'),
        servers,
      };
      break;
    } catch {}
  }

  return {
    configs: { ...globalConfigs, ...(project ? project.servers : {}) },
    globalConfigs,
    project,
  };
}

/**
 * Membersihkan deskripsi tool yang berasal dari server MCP eksternal.
 *
 * Deskripsi tool MCP masuk ke system prompt bAIwor Code apa adanya. Server
 * luar adalah pihak ketiga yang tidak dipercaya, sehingga deskripsi yang
 * berisi "ignore previous instructions" atau blok instruksi sejenis bisa
 * menyuntik perintah ke prompt sistem.
 *
 * Yang dilakukan:
 *   - membuang karakter kontrol/ANSI,
 *   - memotong panjang deskripsi,
 *   - menandai blok instruksi yang menyerupai perintah sistem.
 *
 * @param {string} serverName
 * @param {string} description
 * @returns {string}
 */
export function sanitizeMcpToolDescription(serverName, description) {
  const MAX_LEN = 400;
  const raw = String(description ?? '');

  // Buang karakter kontrol (ESC, BEL, dll) except newline & tab.
  let text = raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ');

  // Ratakan baris baru agar deskripsi tetap satu baris di system prompt.
  text = text.replace(/\s+/g, ' ').trim();

  // Tandai pola injeksi yang lazim dipakai prompt-injection.
  const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
    /disregard\s+(all\s+)?(previous|prior|above)/gi,
    /you\s+are\s+now\s+/gi,
    /system\s*:\s*/gi,
    /<\s*\/?\s*(system|assistant|instructions?)\s*>/gi,
    /override\s+(your\s+)?(system\s+)?(prompt|rules?|instructions?)/gi,
  ];
  for (const pattern of INJECTION_PATTERNS) {
    text = text.replace(pattern, (match) => `[ditandai: ${match}]`);
  }

  if (text.length > MAX_LEN) {
    text = `${text.slice(0, MAX_LEN).trimEnd()}…`;
  }

  return `[MCP: ${serverName}] ${text || '(tanpa deskripsi)'}`;
}

/**
 * Membaca konfigurasi server MCP dari file konfigurasi global dan proyek.
 *
 * @param {string} [cwd]
 * @returns {Record<string, Object>}
 */
export function loadMcpConfig(cwd = process.cwd()) {
  return loadMcpConfigDetailed(cwd).configs;
}

/**
 * Ringkasan server MCP untuk prompt persetujuan. Tidak pernah mencetak
 * header/env karena bisa berisi kredensial.
 */
function describeProjectServers(servers) {
  return Object.entries(servers)
    .map(([name, cfg]) => {
      if (!cfg || typeof cfg !== 'object') return `• ${name}: (konfigurasi tidak valid)`;
      if (cfg.command) {
        const args = Array.isArray(cfg.args) ? cfg.args : [];
        return `• ${name}: ${[cfg.command, ...args].join(' ')}`;
      }
      if (cfg.url) return `• ${name}: ${cfg.type || 'remote'} ${cfg.url}`;
      return `• ${name}: (tanpa command/url)`;
    })
    .join('\n');
}

/**
 * Menghubungkan satu server MCP dan mendaftarkan tool-nya ke Registry bAIwor Code
 *
 * @param {string} name
 * @param {Object} serverConfig
 * @returns {Promise<McpSession>}
 */
export async function connectMcpServer(name, serverConfig) {
  // Tutup sesi lama jika sudah ada
  if (activeSessions.has(name)) {
    activeSessions.get(name).close();
  }

  const session = new McpSession(name, serverConfig);
  await session.connect();
  activeSessions.set(name, session);

  // Daftarkan setiap tool dari MCP server ke Tool Registry bAIwor Code.
  // Prefix `mcp_` mencegah server eksternal menimpa tool bawaan (mis. tool
  // bernama `file` pada server `read` tidak bisa menjadi `read_file`).
  for (const tool of session.tools) {
    const baseName = `mcp_${name}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    let safeToolName = baseName;
    let suffix = 2;
    while (hasTool(safeToolName)) {
      safeToolName = `${baseName}_${suffix}`;
      suffix += 1;
    }
    registerTool({
      name: safeToolName,
      toolset: 'mcp',
      emoji: '🔌',
      schema: {
        description: sanitizeMcpToolDescription(name, tool.description || tool.name),
        parameters: tool.inputSchema || { type: 'object', properties: {} },
      },
      handler: async (args) => {
        return await session.callTool(tool.name, args);
      },
    });
    session.registeredToolNames.push(safeToolName);
  }

  return session;
}

/**
 * Menginisialisasi dan menghubungkan seluruh MCP server yang terkonfigurasi.
 *
 * Server dari `.mcp.json`/`.baiwor/mcp.json` proyek TIDAK dijalankan otomatis.
 * Pada sesi interaktif pengguna diminta menyetujui (per folder + hash file);
 * pada sesi non-TTY server proyek dilewati. Server global tetap berjalan.
 *
 * @param {Object} [options]
 * @param {string} [options.cwd]
 * @param {boolean} [options.interactive=true]
 * @returns {Promise<Array<{ name: string, status: string, toolCount: number, error?: string }>>}
 */
export async function initAllMcpServers({ cwd = process.cwd(), interactive = true } = {}) {
  const detailed = loadMcpConfigDetailed(cwd);
  let configs = detailed.configs;
  const results = [];
  const projectEntries = detailed.project ? Object.entries(detailed.project.servers) : [];

  if (projectEntries.length > 0 && !isMcpProjectTrusted(cwd, detailed.project.hash)) {
    const canPrompt = Boolean(interactive && process.stdin.isTTY && process.stdout.isTTY);
    let approved = false;

    if (canPrompt) {
      const answer = await p.confirm({
        message:
          'Folder ini mendefinisikan server MCP yang akan menjalankan perintah di komputermu:\n\n' +
          `${describeProjectServers(detailed.project.servers)}\n\n` +
          'Percayai dan aktifkan server MCP proyek ini?',
        initialValue: false,
      });
      approved = !p.isCancel(answer) && answer === true;
    }

    if (approved) {
      trustMcpProject(cwd, detailed.project.hash);
    } else {
      // Kembali ke server global saja; server proyek dilewati.
      configs = detailed.globalConfigs;
      for (const [name] of projectEntries) {
        if (Object.prototype.hasOwnProperty.call(detailed.globalConfigs, name)) continue;
        results.push({
          name,
          status: 'skipped',
          toolCount: 0,
          error: canPrompt
            ? 'Tidak dipercaya oleh pengguna'
            : 'Perlu persetujuan interaktif — jalankan bAIwor di terminal (TTY) untuk menyetujui',
        });
      }
      console.log(
        canPrompt
          ? '  ℹ️  Server MCP proyek tidak diaktifkan (belum dipercaya).'
          : '  ⚠️  Server MCP proyek dilewati: persetujuan membutuhkan terminal interaktif.'
      );
    }
  }

  // Tutup sesi yang sudah tidak ada di konfigurasi (dihapus atau belum dipercaya).
  for (const [name, session] of [...activeSessions.entries()]) {
    if (!Object.prototype.hasOwnProperty.call(configs, name)) {
      try {
        session.close();
      } catch {}
      activeSessions.delete(name);
    }
  }

  for (const [name, srvConfig] of Object.entries(configs)) {
    if (!srvConfig || typeof srvConfig !== 'object') continue;
    try {
      const session = await connectMcpServer(name, srvConfig);
      results.push({
        name,
        status: session.status,
        toolCount: session.tools.length,
      });
    } catch (err) {
      results.push({
        name,
        status: 'error',
        toolCount: 0,
        error: err.message,
      });
    }
  }

  return results;
}

/**
 * Mendapatkan daftar seluruh sesi MCP yang sedang aktif
 *
 * @returns {Array<{ name: string, type: string, status: string, tools: Array<{name:string, description:string}> }>}
 */
export function listActiveMcpSessions() {
  const list = [];
  for (const session of activeSessions.values()) {
    list.push({
      name: session.name,
      type: session.type,
      status: session.status,
      url: session.config?.url,
      command: session.config?.command,
      tools: session.tools.map((t) => ({ name: t.name, description: t.description })),
    });
  }
  return list;
}

/**
 * Memutuskan seluruh koneksi MCP aktif
 */
export function disconnectAllMcpServers() {
  for (const session of activeSessions.values()) {
    session.close();
  }
  activeSessions.clear();
}

/**
 * Nama server dipakai membentuk nama tool (`mcp_<nama>_<tool>`), jadi harus
 * bebas spasi dan karakter pemisah.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isValidMcpServerName(name) {
  return /^[a-z][a-z0-9_-]{0,39}$/i.test(String(name || '').trim());
}

/**
 * Menyimpan/menimpa satu entri server MCP di konfigurasi global
 * (~/.baiwor/config.json → `mcpServers`). Entri lain tetap utuh.
 *
 * @param {string} name
 * @param {Object} serverConfig
 * @returns {string} nama yang tersimpan (sudah dipangkas)
 */
export function saveMcpServer(name, serverConfig) {
  const clean = String(name || '').trim();
  if (!isValidMcpServerName(clean)) {
    throw new Error(
      `Nama server '${clean}' tidak valid. Mulai dengan huruf, lalu huruf/angka/_/- (maks 40 karakter, tanpa spasi).`
    );
  }
  const servers = { ...(getConfig().mcpServers || {}) };
  servers[clean] = serverConfig;
  saveConfig({ mcpServers: servers });
  return clean;
}

/**
 * Menghapus server MCP dari konfigurasi global sekaligus memutuskan koneksi dan
 * melepas tool-nya dari registry.
 *
 * @param {string} name
 * @returns {boolean} true bila entri konfigurasi sebelumnya ada
 */
export function removeMcpServer(name) {
  const clean = String(name || '').trim();
  const servers = { ...(getConfig().mcpServers || {}) };
  const existed = Object.prototype.hasOwnProperty.call(servers, clean);
  if (existed) {
    delete servers[clean];
    saveConfig({ mcpServers: servers });
  }
  const session = activeSessions.get(clean);
  if (session) {
    session.close();
    activeSessions.delete(clean);
  }
  return existed;
}
