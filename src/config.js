import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveTimelineMode } from './chat/timeline.js';

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
  // Model aliases ala Hermes: nama pendek → "provider/model" atau objek
  // { model, provider, baseUrl?, apiKey? }. Dikelola via /model alias ...
  modelAliases: {},
  // Tampilan blok aktivitas tool: 'detail' (pohon dua baris) atau
  // 'compact' (satu baris per langkah, gaya CLI modern). Diubah via /timeline.
  timelineMode: 'detail',
  // TinyFish Web Intelligence: API Key untuk Search, Fetch (anti-bot & JS), dan Web Automate
  tinyfishApiKey: '',
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

    // Pastikan modelAliases selalu berbentuk objek (config lama/tidak valid
    // tidak boleh membuat resolver alias jatuh error).
    if (
      !config.modelAliases ||
      typeof config.modelAliases !== 'object' ||
      Array.isArray(config.modelAliases)
    ) {
      config.modelAliases = {};
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

/**
 * Membaca mode tampilan timeline yang aktif.
 * Nilai tak dikenal di config jatuh kembali ke `detail`.
 *
 * @returns {'detail'|'compact'}
 */
export function getTimelineMode() {
  try {
    return resolveTimelineMode(getConfig().timelineMode, 'detail');
  } catch {
    return 'detail';
  }
}

/**
 * Menyetel mode tampilan timeline. Nilai tak dikenal diabaikan dan mode
 * lama dikembalikan, sehingga salah ketik tidak merusak konfigurasi.
 *
 * @param {'detail'|'compact'} mode
 * @returns {'detail'|'compact'} mode yang benar-benar aktif setelah penyimpanan
 */
export function setTimelineMode(mode) {
  const next = resolveTimelineMode(mode, 'detail');
  if (next !== resolveTimelineMode(getConfig().timelineMode, 'detail')) {
    saveConfig({ timelineMode: next });
  }
  return getTimelineMode();
}

export function saveConfig(partialConfig) {  try {
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

/**
 * Mendapatkan API Key TinyFish dengan urutan prioritas:
 * 1. Environment variable TINYFISH_API_KEY
 * 2. Konfigurasi bAIwor Code (~/.baiwor/config.json -> tinyfishApiKey)
 * 3. Konfigurasi CLI TinyFish (~/.tinyfish/config.json -> api_key)
 *
 * @returns {string}
 */
export function getTinyFishApiKey() {
  if (process.env.TINYFISH_API_KEY && process.env.TINYFISH_API_KEY.trim()) {
    return process.env.TINYFISH_API_KEY.trim();
  }
  const config = getConfig();
  if (config.tinyfishApiKey && typeof config.tinyfishApiKey === 'string' && config.tinyfishApiKey.trim()) {
    return config.tinyfishApiKey.trim();
  }
  // Cek konfigurasi resmi ~/.tinyfish/config.json bila pengguna setup via CLI
  try {
    const tfFile = path.join(os.homedir(), '.tinyfish', 'config.json');
    if (fs.existsSync(tfFile)) {
      const parsed = JSON.parse(fs.readFileSync(tfFile, 'utf8'));
      if (parsed && typeof parsed.api_key === 'string' && parsed.api_key.trim()) {
        return parsed.api_key.trim();
      }
    }
  } catch {}
  return '';
}

/**
 * Menyimpan API Key TinyFish ke dalam konfigurasi ~/.baiwor/config.json.
 * @param {string} key
 * @returns {string}
 */
export function saveTinyFishApiKey(key) {
  const clean = String(key || '').trim();
  saveConfig({ tinyfishApiKey: clean });
  return clean;
}
