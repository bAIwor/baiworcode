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
  isMcpProjectTrusted,
  trustMcpProject,
} from '../config.js';
import { registerTool, unregisterTool } from '../tools/registry.js';

const MCP_TIMEOUT_MS = 60000;
const activeSessions = new Map(); // serverName -> McpSession

/**
 * Environment yang aman diwariskan ke server MCP stdio.
 *
 * Sebelumnya seluruh `process.env` diteruskan, sehingga API key/OAuth token
 * pengguna ikut terbaca oleh server MCP pihak ketiga. Hanya variabel sistem
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
 * Kelas penanganan koneksi MCP Session (HTTP / Stdio)
 */
export class McpSession {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.type = config.type || (config.command ? 'stdio' : 'remote');
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

    const toolsData = await toolsRes.json();
    this.tools = Array.isArray(toolsData.result?.tools) ? toolsData.result.tools : [];
    this.status = 'connected';
  }

  async _connectStdio() {
    const { command, args = [], env = {} } = this.config;
    if (!command) throw new Error(`Server MCP stdio '${this.name}' wajib menentukan 'command'.`);

    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: buildSafeMcpEnv(env),
      // Windows membutuhkan shell hanya untuk shim .cmd/.bat (npx, uvx, dsb.);
      // perintah/argumen sudah ditampilkan saat persetujuan folder proyek.
      shell: process.platform === 'win32',
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

      const data = await res.json();
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

  // Daftarkan setiap tool dari MCP server ke Tool Registry bAIwor Code
  for (const tool of session.tools) {
    const safeToolName = `${name}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    registerTool({
      name: safeToolName,
      toolset: 'mcp',
      emoji: '🔌',
      schema: {
        description: `[MCP: ${name}] ${tool.description || tool.name}`,
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
