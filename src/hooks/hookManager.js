import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as p from '@clack/prompts';
import {
  isHooksProjectTrusted,
  trustHooksProject,
} from '../config.js';
import { sanitizeTerminalText } from '../chat/wrapText.js';

/**
 * Hooks System untuk bAIwor Code.
 *
 * Event-driven automation yang memungkinkan pengguna menjalankan shell command
 * secara otomatis saat event tertentu terjadi (pre/post tool execution, session
 * lifecycle). Hook bisa memblokir eksekusi (pre-hook) atau hanya logging (post-hook).
 *
 * Arsitektur:
 *   1. Hook config disimpan di .baiwor/hooks.json (per-project) atau ~/.baiwor/hooks.json (global)
 *   2. HookManager mendaftarkan hook dan mengeksekusi saat event terjadi
 *   3. Pre-hook bisa return { allowed: false, reason: '...' } untuk memblokir eksekusi
 *   4. Post-hook menerima hasil eksekusi tool dan bisa log/modify
 */

/** Event types yang didukung oleh hooks system. */
export const HOOK_EVENTS = [
  'pre-tool-execute',
  'post-tool-execute',
  'session-start',
  'session-end',
];

/**
 * @typedef {Object} HookDefinition
 * @property {string} event - Event type (pre-tool-execute, post-tool-execute, dll)
 * @property {string} command - Shell command yang akan dijalankan
 * @property {string} [condition] - Kondisi opsional (misal: "toolName === 'run_command'")
 * @property {number} [timeout=30000] - Timeout dalam milidetik (default 30s)
 */

/**
 * @typedef {Object} HookContext
 * @property {string} event - Event yang trigger hook
 * @property {string} [toolName] - Nama tool (untuk pre/post-tool-execute)
 * @property {Object} [toolArgs] - Argumen tool (untuk pre/post-tool-execute)
 * @property {Object} [toolResult] - Hasil tool (untuk post-tool-execute)
 * @property {string} cwd - Working directory saat ini
 * @property {string} projectRoot - Root direktori proyek
 */

/**
 * @typedef {Object} HookResult
 * @property {boolean} allowed - Apakah eksekusi tool diizinkan (untuk pre-hook)
 * @property {string} [reason] - Alasan jika diblokir
 * @property {string} output - Output dari command hook
 * @property {number} exitCode - Exit code dari command
 */

function killHookProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32' && child.pid) {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        try {
          child.kill('SIGKILL');
        } catch {}
      });
      return;
    } catch {
      // jatuh ke child.kill di bawah
    }
  }

  try {
    child.kill('SIGTERM');
  } catch {}
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {}
  }, 200);
}

export class HookManager {
  /**
   * @param {{
   *   cwd?: string,
   *   configPath?: string,
   *   interactive?: boolean,
   *   trustCheck?: (configPath: string, hash: string) => boolean|Promise<boolean>,
   *   allowUntrustedProjectHooks?: boolean,
   * }} [options]
   *
   * `configPath` eksplisit dianggap sebagai override administratif (dipakai
   * test dan pemanggil yang mengelola file sendiri), jadi tidak melewati gate
   * trust proyek. Hooks proyek hanya berjalan setelah disetujui pengguna dan
   * hash file-nya masih cocok.
   */
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    this.projectRoot = this.cwd;
    this.configPath = options.configPath || this.#resolveConfigPath();

    this.globalConfigPath = path.join(os.homedir(), '.baiwor', 'hooks.json');
    const normalizeForCompare = (value) => {
      const resolved = path.resolve(value);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    this.isProjectConfig =
      normalizeForCompare(this.configPath) !== normalizeForCompare(this.globalConfigPath);
    this.interactive =
      options.interactive !== false &&
      Boolean(process.stdin.isTTY && process.stdout.isTTY);
    this.trustCheck =
      typeof options.trustCheck === 'function' ? options.trustCheck : null;
    this.allowUntrustedProjectHooks = Boolean(
      options.allowUntrustedProjectHooks || options.configPath
    );
    this.trustDecision = null;
    this.trustPromise = null;
    this.changeWarned = false;

    this.hooks = this.#loadHooks();
    // Hash dari isi yang benar-benar dimuat. Bila file berubah di tengah sesi,
    // hooks dihentikan: menjalankan definisi lama di bawah approval hash baru
    // akan menyesatkan.
    this.loadedHash = this.#hashConfig();
    this.listeners = new Map(); // event -> [hook, hook, ...]
    this.#registerListeners();
  }

  #resolveConfigPath() {
    // Prioritas: .baiwor/hooks.json (project) > ~/.baiwor/hooks.json (global)
    const projectConfig = path.join(this.cwd, '.baiwor', 'hooks.json');
    if (fs.existsSync(projectConfig)) {
      return projectConfig;
    }

    const globalConfig = path.join(os.homedir(), '.baiwor', 'hooks.json');
    if (fs.existsSync(globalConfig)) {
      return globalConfig;
    }

    // Default: buat di project
    return projectConfig;
  }

  #hashConfig() {
    try {
      return crypto
        .createHash('sha256')
        .update(fs.readFileSync(this.configPath))
        .digest('hex');
    } catch {
      return null;
    }
  }

  #describeHooks() {
    const preview = this.hooks.slice(0, 5).map((hook, index) => {
      const command = sanitizeTerminalText(String(hook.command || ''), {
        preserveNewlines: false,
      });
      const short = command.length > 160 ? `${command.slice(0, 157)}...` : command;
      return `  ${index + 1}. [${hook.event}] ${short}`;
    });
    const rest =
      this.hooks.length > 5 ? `\n  ... dan ${this.hooks.length - 5} hook lainnya` : '';
    return preview.join('\n') + rest;
  }

  /**
   * Gate trust untuk hooks proyek. Global hooks (~/.baiwor/hooks.json) adalah
   * milik pengguna sendiri sehingga tidak perlu persetujuan.
   *
   * @returns {Promise<boolean>}
   */
  async #ensureTrust() {
    // Override administratif (configPath eksplisit) dikelola pemanggil sendiri.
    if (this.allowUntrustedProjectHooks) return true;

    const currentHash = this.#hashConfig();
    if (currentHash !== this.loadedHash) {
      if (!this.changeWarned) {
        this.changeWarned = true;
        console.warn(
          '[Hooks] File hooks berubah setelah dimuat; hooks dihentikan sampai bAIwor dijalankan ulang.'
        );
      }
      return false;
    }

    if (!this.isProjectConfig) return true;
    if (this.trustDecision !== null) return this.trustDecision;
    if (this.trustPromise) return this.trustPromise;

    this.trustPromise = this.#decideTrust();
    try {
      return await this.trustPromise;
    } finally {
      this.trustPromise = null;
    }
  }

  async #decideTrust() {
    if (this.hooks.length === 0) {
      this.trustDecision = true;
      return true;
    }

    const hash = this.#hashConfig();
    if (!hash) {
      this.trustDecision = true;
      return true;
    }

    let trusted = false;
    try {
      trusted = this.trustCheck
        ? Boolean(await this.trustCheck(this.configPath, hash))
        : isHooksProjectTrusted(this.projectRoot, hash);
    } catch {
      trusted = false;
    }

    if (!trusted && this.interactive) {
      try {
        const safePath = sanitizeTerminalText(this.configPath, {
          preserveNewlines: false,
        });
        const answer = await p.confirm({
          message:
            'Folder ini mendefinisikan hooks yang akan menjalankan perintah shell:\n\n' +
            `${this.#describeHooks()}\n\n` +
            `File: ${safePath}\n\n` +
            'Percayai dan jalankan hooks proyek ini?',
          initialValue: false,
        });
        trusted = !p.isCancel(answer) && answer === true;
        if (trusted) {
          try {
            trustHooksProject(this.projectRoot, hash);
          } catch (err) {
            console.warn(`[Hooks] Gagal menyimpan persetujuan: ${err.message}`);
          }
        }
      } catch {
        trusted = false;
      }
    }

    this.trustDecision = trusted;
    if (!trusted) {
      const safePath = sanitizeTerminalText(this.configPath, {
        preserveNewlines: false,
      });
      const safeGlobal = sanitizeTerminalText(this.globalConfigPath, {
        preserveNewlines: false,
      });
      console.warn(
        `[Hooks] Hooks proyek tidak dijalankan: ${safePath} belum dipercaya. ` +
          `Jalankan bAIwor di terminal interaktif untuk menyetujui, atau pindahkan hook ke ${safeGlobal}.`
      );
    }
    return trusted;
  }

  #loadHooks() {
    if (!fs.existsSync(this.configPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf8');
      const config = JSON.parse(content);
      return Array.isArray(config.hooks) ? config.hooks : [];
    } catch (err) {
      console.warn(`[Hooks] Gagal memuat config dari ${this.configPath}: ${err.message}`);
      return [];
    }
  }

  #registerListeners() {
    for (const hook of this.hooks) {
      if (!HOOK_EVENTS.includes(hook.event)) {
        console.warn(`[Hooks] Event tidak valid: ${hook.event}`);
        continue;
      }

      if (!this.listeners.has(hook.event)) {
        this.listeners.set(hook.event, []);
      }
      this.listeners.get(hook.event).push(hook);
    }
  }

  /**
   * Menambahkan hook baru ke config.
   *
   * @param {HookDefinition} hook
   */
  addHook(hook) {
    if (!HOOK_EVENTS.includes(hook.event)) {
      throw new Error(`Event tidak valid: ${hook.event}. Gunakan salah satu dari: ${HOOK_EVENTS.join(', ')}`);
    }

    this.hooks.push(hook);
    this.#saveHooks();
    this.#registerListeners();
    // File berubah karena aksi eksplisit pengguna/pemanggil. Muat ulang hash
    // agar tidak dianggap perubahan liar, tetapi konten baru tetap harus
    // melewati trust gate sekali lagi.
    this.loadedHash = this.#hashConfig();
    this.trustDecision = null;
    this.changeWarned = false;
  }

  /**
   * Menghapus hook berdasarkan index.
   *
   * @param {number} index
   */
  removeHook(index) {
    if (index < 0 || index >= this.hooks.length) {
      throw new Error(`Index hook tidak valid: ${index}`);
    }

    this.hooks.splice(index, 1);
    this.#saveHooks();
    this.listeners.clear();
    this.#registerListeners();
    this.loadedHash = this.#hashConfig();
    this.trustDecision = null;
    this.changeWarned = false;
  }

  /**
   * Menampilkan daftar hook yang terdaftar.
   *
   * @returns {HookDefinition[]}
   */
  listHooks() {
    return [...this.hooks];
  }

  #saveHooks() {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const config = { hooks: this.hooks };
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  }

  /**
   * Mengevaluasi kondisi hook (jika ada) menggunakan safe expression parser.
   *
   * Mendukung syntax sederhana:
   *   - toolName === 'value'
   *   - toolName !== 'value'
   *   - toolArgs.key === 'value'
   *   - exitCode === 0
   *
   * @param {string} condition - Expression sederhana (bukan arbitrary JavaScript)
   * @param {HookContext} context - Konteks eksekusi
   * @returns {boolean}
   */
  #evaluateCondition(condition, context) {
    if (!condition) return true;

    try {
      // Parse expression sederhana: left operator right
      const match = condition.match(/^(\w+(?:\.\w+)*)\s*(===|!==|==|!=)\s*(.+)$/);
      if (!match) {
        console.warn(`[Hooks] Format kondisi tidak valid: ${condition}`);
        return true;
      }

      const [, leftPath, operator, rightRaw] = match;

      // Resolve left side dari context
      const leftValue = this.#resolveContextPath(leftPath, context);

      // Parse right side (string literal atau number)
      let rightValue;
      if (rightRaw.startsWith("'") && rightRaw.endsWith("'")) {
        rightValue = rightRaw.slice(1, -1);
      } else if (rightRaw.startsWith('"') && rightRaw.endsWith('"')) {
        rightValue = rightRaw.slice(1, -1);
      } else if (!isNaN(rightRaw)) {
        rightValue = Number(rightRaw);
      } else {
        console.warn(`[Hooks] Nilai kanan tidak valid: ${rightRaw}`);
        return true;
      }

      // Evaluasi operator
      switch (operator) {
        case '===':
          return leftValue === rightValue;
        case '!==':
          return leftValue !== rightValue;
        case '==':
          return leftValue == rightValue;
        case '!=':
          return leftValue != rightValue;
        default:
          return true;
      }
    } catch (err) {
      console.warn(`[Hooks] Gagal evaluasi kondisi "${condition}": ${err.message}`);
      return true;
    }
  }

  /**
   * Resolve path dari context (misal: "toolName", "toolArgs.path", "exitCode").
   *
   * @param {string} pathPath - Dot-separated path
   * @param {HookContext} context
   * @returns {any}
   */
  #resolveContextPath(pathPath, context) {
    const parts = pathPath.split('.');
    let value = context;

    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = value[part];
    }

    return value;
  }

  /**
   * Menjalankan hook dengan context tertentu.
   *
   * @param {HookDefinition} hook
   * @param {HookContext} context
   * @returns {Promise<HookResult>}
   */
  async #executeHook(hook, context) {
    const timeout = hook.timeout || 30000;
    const isPreTool = context.event === 'pre-tool-execute';

    // Inject context sebagai environment variables
    const env = {
      ...process.env,
      HOOK_EVENT: context.event,
      HOOK_TOOL_NAME: context.toolName || '',
      HOOK_TOOL_ARGS: JSON.stringify(context.toolArgs || {}),
      HOOK_TOOL_RESULT: JSON.stringify(context.toolResult || {}),
      HOOK_CWD: context.cwd,
    };

    return new Promise((resolve) => {
      const child = spawn(hook.command, {
        shell: true,
        cwd: context.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killHookProcess(child);
        // Pre-hook adalah lapisan kebijakan: bila tidak bisa diselesaikan,
        // jangan diam-diam meloloskan tool (fail-closed). Post-hook tetap
        // tidak memblokir hasil tool.
        const timeoutResult = {
          allowed: !isPreTool,
          reason: isPreTool
            ? `[Hooks] Timeout setelah ${timeout}ms — tool diblokir (fail-closed).`
            : undefined,
          output: `[Hooks] Timeout setelah ${timeout}ms`,
          exitCode: 124,
        };

        // Tunggu proses benar-benar berhenti (terutama di Windows, tempat
        // cwd proses bisa menahan penghapusan folder test) dengan batas 500ms.
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve(timeoutResult);
        };
        const fallback = setTimeout(finish, 500);
        child.once('close', () => {
          clearTimeout(fallback);
          finish();
        });
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return;
        const output = stdout + (stderr ? `\n${stderr}` : '');

        // Untuk pre-hook, parse output untuk menentukan apakah diizinkan
        if (isPreTool) {
          const blocked = output.toLowerCase().includes('block:') || code !== 0;
          resolve({
            allowed: !blocked,
            reason: blocked ? output.trim() : undefined,
            output: output.trim(),
            exitCode: code,
          });
        } else {
          // Post-hook hanya log
          resolve({
            allowed: true,
            output: output.trim(),
            exitCode: code,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (timedOut) return;
        resolve({
          allowed: !isPreTool,
          reason: isPreTool
            ? `[Hooks] Gagal menjalankan hook: ${err.message}`
            : undefined,
          output: `[Hooks] Error: ${err.message}`,
          exitCode: 1,
        });
      });
    });
  }

  /**
   * Trigger event dan jalankan semua hook yang terdaftar.
   *
   * @param {string} event - Event type
   * @param {HookContext} context - Konteks eksekusi
   * @returns {Promise<{allowed: boolean, results: HookResult[]}>}
   */
  async trigger(event, context) {
    const hooks = this.listeners.get(event) || [];
    if (hooks.length === 0) {
      return { allowed: true, results: [] };
    }

    // Hooks proyek adalah kode dari repo yang mungkin tidak dipercaya.
    // Jangan jalankan apa pun sebelum pengguna menyetujui hash file ini.
    const trusted = await this.#ensureTrust();
    if (!trusted) {
      return { allowed: true, results: [] };
    }

    const results = [];
    let allAllowed = true;

    for (const hook of hooks) {
      // Evaluasi kondisi (jika ada)
      if (!this.#evaluateCondition(hook.condition, context)) {
        continue;
      }

      const result = await this.#executeHook(hook, { ...context, event });
      results.push(result);

      // Untuk pre-hook, jika ada yang block, hentikan eksekusi
      if (event === 'pre-tool-execute' && !result.allowed) {
        allAllowed = false;
        break;
      }
    }

    return { allowed: allAllowed, results };
  }

  /**
   * Helper: Trigger pre-tool-execute hook.
   *
   * @param {string} toolName
   * @param {Object} toolArgs
   * @returns {Promise<{allowed: boolean, reason?: string}>}
   */
  async triggerPreToolExecute(toolName, toolArgs) {
    const context = {
      event: 'pre-tool-execute',
      toolName,
      toolArgs,
      cwd: this.cwd,
      projectRoot: this.cwd,
    };

    const { allowed, results } = await this.trigger('pre-tool-execute', context);
    const reason = !allowed ? results.find((r) => !r.allowed)?.reason : undefined;

    return { allowed, reason };
  }

  /**
   * Helper: Trigger post-tool-execute hook.
   *
   * @param {string} toolName
   * @param {Object} toolArgs
   * @param {Object} toolResult
   * @returns {Promise<void>}
   */
  async triggerPostToolExecute(toolName, toolArgs, toolResult) {
    const context = {
      event: 'post-tool-execute',
      toolName,
      toolArgs,
      toolResult,
      cwd: this.cwd,
      projectRoot: this.cwd,
    };

    await this.trigger('post-tool-execute', context);
  }

  /**
   * Helper: Trigger session-start hook.
   *
   * @returns {Promise<void>}
   */
  async triggerSessionStart() {
    const context = {
      event: 'session-start',
      cwd: this.cwd,
      projectRoot: this.cwd,
    };

    await this.trigger('session-start', context);
  }

  /**
   * Helper: Trigger session-end hook.
   *
   * @returns {Promise<void>}
   */
  async triggerSessionEnd() {
    const context = {
      event: 'session-end',
      cwd: this.cwd,
      projectRoot: this.cwd,
    };

    await this.trigger('session-end', context);
  }
}

/**
 * Singleton instance untuk digunakan di seluruh aplikasi.
 * Diinisialisasi saat pertama kali diimpor.
 */
export const hookManager = new HookManager();
