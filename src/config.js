import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const CONFIG_DIR = path.join(os.homedir(), '.baiwor');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CONFIG_TMP = path.join(CONFIG_DIR, 'config.json.tmp');

export const DEFAULT_CONFIG = {
  activeProvider: 'Agentik',
  activeModel: 'gemini-3.8-flash-high',
  activeType: 'custom',
  customProviders: [
    {
      name: 'Agentik',
      baseUrl: 'https://api.agentik.my.id/v1',
      apiKey: '',
      model: 'gemini-3.8-flash-high',
    },
  ],
  oauth: {},
};

export function maskSecret(str) {
  if (!str || typeof str !== 'string') return '••••';
  const s = str.trim();
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    try {
      fs.chmodSync(CONFIG_DIR, 0o700);
    } catch {
      // Best effort, abaikan di Windows
    }
  }
}

let cachedConfig = null;
let lastCheckTime = 0;
let lastMtime = 0;

export function clearConfigCache() {
  cachedConfig = null;
  lastCheckTime = 0;
  lastMtime = 0;
}

function writeAtomicConfig(data) {
  ensureConfigDir();
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(CONFIG_TMP, content, 'utf8');
  try {
    fs.chmodSync(CONFIG_TMP, 0o600);
  } catch {}
  fs.renameSync(CONFIG_TMP, CONFIG_FILE);
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {}
  clearConfigCache();
}

export function getConfig() {
  const now = Date.now();
  // Dalam rentang 500ms, gunakan cache in-memory tanpa disk I/O untuk mencegah lag saat mengetik
  if (cachedConfig && now - lastCheckTime < 500) {
    return cachedConfig;
  }

  ensureConfigDir();

  if (!fs.existsSync(CONFIG_FILE)) {
    writeAtomicConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }

  try {
    const stat = fs.statSync(CONFIG_FILE);
    if (cachedConfig && stat.mtimeMs === lastMtime) {
      lastCheckTime = now;
      return cachedConfig;
    }

    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const config = { ...DEFAULT_CONFIG, ...parsed };

    // Pastikan Agentik selalu tersedia di daftar customProviders secara bawaan
    if (!Array.isArray(config.customProviders) || config.customProviders.length === 0) {
      config.customProviders = [...DEFAULT_CONFIG.customProviders];
    } else {
      const hasAgentik = config.customProviders.some(
        (c) => c && c.name && c.name.toLowerCase() === 'agentik'
      );
      if (!hasAgentik) {
        config.customProviders.unshift(DEFAULT_CONFIG.customProviders[0]);
      }
    }

    cachedConfig = config;
    lastMtime = stat.mtimeMs;
    lastCheckTime = now;
    return config;
  } catch (err) {
    clearConfigCache();
    // File rusak: JANGAN timpa! Cadangkan dulu
    const timestamp = Date.now();
    const backupFile = path.join(CONFIG_DIR, `config.json.bak-${timestamp}`);
    try {
      fs.renameSync(CONFIG_FILE, backupFile);
      console.warn(`\n⚠️  File config.json rusak. File lama dicadangkan ke: ${backupFile}`);
    } catch {}
    writeAtomicConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(partialConfig) {
  try {
    const current = getConfig();
    const merged = { ...current, ...partialConfig };

    // Merge khusus key oauth: digabung PER provider id, bukan diganti utuh.
    // Patch parsial (mis. hanya { clientId }) tidak boleh menghapus accessToken
    // atau apiKey yang sudah tersimpan. Patch yang membawa `method` dianggap
    // sesi baru (login ulang / refresh token) sehingga diganti utuh, supaya
    // kredensial lama tidak tercampur — mis. apiKey lama tertinggal saat
    // pengguna beralih ke login OAuth.
    if (partialConfig && typeof partialConfig.oauth === 'object' && partialConfig.oauth !== null) {
      merged.oauth = { ...(current.oauth || {}) };
      for (const [id, patch] of Object.entries(partialConfig.oauth)) {
        if (patch === null || patch === undefined) {
          delete merged.oauth[id];
          continue;
        }
        if (typeof patch !== 'object') {
          continue;
        }
        merged.oauth[id] = 'method' in patch
          ? { ...patch }
          : { ...(merged.oauth[id] || {}), ...patch };
      }
    }

    writeAtomicConfig(merged);
    return merged;
  } catch (err) {
    console.error('Gagal menyimpan konfigurasi:', err.message);
    return getConfig();
  }
}
