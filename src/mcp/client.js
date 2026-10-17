import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { getConfig, saveConfig, getTinyFishApiKey } from '../config.js';
import { registerTool, unregisterTool } from '../tools/registry.js';

const MCP_TIMEOUT_MS = 60000;
const activeSessions = new Map(); // serverName -> McpSession

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
    if (this.type === 'stdio') {
      await this._connectStdio();
    } else {
      await this._connectRemote();
    }
  }

  async _connectRemote() {
    const url = this.config.url;
    if (!url) throw new Error(`Server MCP '${this.name}' tidak memiliki parameter 'url'.`);

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.config.headers || {}),
    };

    // 1. Initialize
    const initRes = await fetch(url, {
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
      await fetch(url, {
        method: 'POST',
        headers: notifyHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });
    } catch {}

    // 3. Tools: list
    const toolsRes = await fetch(url, {
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
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
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
      const url = this.config.url;
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.config.headers || {}),
      };
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

      const res = await fetch(url, {
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
 * Membaca konfigurasi server MCP dari file konfigurasi global dan proyek
 *
 * @param {string} [cwd]
 * @returns {Record<string, Object>}
 */
export function loadMcpConfig(cwd = process.cwd()) {
  const merged = {};

  // 1. Konfigurasi bawaan config.json (~/.baiwor/config.json -> mcpServers)
  try {
    const mainConfig = getConfig();
    if (mainConfig.mcpServers && typeof mainConfig.mcpServers === 'object') {
      Object.assign(merged, mainConfig.mcpServers);
    }
  } catch {}

  // 2. Jika TinyFish key tersedia dan belum ada entri 'tinyfish', daftarkan otomatis
  const tinyfishKey = getTinyFishApiKey();
  if (tinyfishKey && !merged.tinyfish) {
    merged.tinyfish = {
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
      const parsed = JSON.parse(fs.readFileSync(globalMcpFile, 'utf8'));
      const servers = parsed.mcpServers || parsed;
      if (servers && typeof servers === 'object') {
        Object.assign(merged, servers);
      }
    }
  } catch {}

  // 4. Konfigurasi proyek lokal .baiwor/mcp.json atau .mcp.json
  try {
    const projectMcpFile = path.join(cwd, '.baiwor', 'mcp.json');
    const rootMcpFile = path.join(cwd, '.mcp.json');
    const targetFile = fs.existsSync(projectMcpFile)
      ? projectMcpFile
      : fs.existsSync(rootMcpFile)
        ? rootMcpFile
        : null;

    if (targetFile) {
      const parsed = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      const servers = parsed.mcpServers || parsed;
      if (servers && typeof servers === 'object') {
        Object.assign(merged, servers);
      }
    }
  } catch {}

  return merged;
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
 * Menginisialisasi dan menghubungkan seluruh MCP server yang terkonfigurasi
 *
 * @param {Object} [options]
 * @param {string} [options.cwd]
 * @returns {Promise<Array<{ name: string, status: string, toolCount: number, error?: string }>>}
 */
export async function initAllMcpServers({ cwd = process.cwd() } = {}) {
  const configs = loadMcpConfig(cwd);
  const results = [];

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
