import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const CONFIG_DIR = path.join(os.homedir(), '.baiwor');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CONFIG_TMP = path.join(CONFIG_DIR, 'config.json.tmp');

export const DEFAULT_CONFIG = {
  activeProvider: 'Not configured',
  activeModel: 'Not configured',
  activeType: 'none',
  customProviders: [],
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
}

export function getConfig() {
  ensureConfigDir();

  if (!fs.existsSync(CONFIG_FILE)) {
    writeAtomicConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
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

    // Deep merge khusus untuk key oauth (per provider id)
    if (partialConfig && typeof partialConfig.oauth === 'object' && partialConfig.oauth !== null) {
      merged.oauth = {
        ...(current.oauth || {}),
        ...partialConfig.oauth,
      };
      for (const k of Object.keys(merged.oauth)) {
        if (merged.oauth[k] === null || merged.oauth[k] === undefined) {
          delete merged.oauth[k];
        }
      }
    }

    writeAtomicConfig(merged);
    return merged;
  } catch (err) {
    console.error('Gagal menyimpan konfigurasi:', err.message);
    return getConfig();
  }
}
