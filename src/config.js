import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { resolveTimelineMode } from './chat/timeline.js';

export const CONFIG_DIR = path.join(os.homedir(), '.baiwor');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

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
  // Model aliases bAIwor Code: nama pendek → "provider/model" atau objek
  // { model, provider, baseUrl?, apiKey? }. Dikelola via /model alias ...
  modelAliases: {},
  // Tampilan blok aktivitas tool: 'detail' (pohon dua baris) atau
  // 'compact' (satu baris per langkah, gaya CLI modern). Diubah via /timeline.
  timelineMode: 'detail',
  // Mode izin terpadu (satu-satunya sumber kebenaran): 'safe' (semua perubahan
  // & perintah berisiko bertanya), 'auto' (berkas langsung, perintah bertanya),
  // 'plan' (read-only), 'yolo' (tanpa bertanya; deny tetap ditolak).
  // Diubah via /permission atau Shift+Tab.
  permissionMode: 'safe',
  // [deprecated] accessMode & agentMode lama dipetakan otomatis ke
  // permissionMode saat dibaca; jangan ditulis lagi dari kode baru.
  accessMode: 'normal',
  agentMode: 'build',
  // Override destruktif SADAR (default: tertutup). Berisi daftar id aturan
  // merusak yang boleh dijalankan (mis. ['power'] untuk shutdown/reboot), atau
  // true untuk membuka semua. Env BAIWOR_ALLOW_DESTRUCTIVE menang atas ini.
  destructiveAllow: [],
  // TinyFish Web Intelligence: API Key untuk Search, Fetch (anti-bot & JS), dan Web Automate
  tinyfishApiKey: '',
  // Tavily (riset & pencarian web untuk agen): API Key tvly-... untuk MCP server resminya.
  tavilyApiKey: '',
  // Firecrawl (scrape/crawl/map situs jadi konten bersih): API Key fc-... untuk MCP server resminya.
  firecrawlApiKey: '',
  // InstaBox Cloud Sandbox: API Key dan default machine ID/name
  instaboxApiKey: '',
  instaboxMachineId: 'baiwor',
  // Model Context Protocol (MCP): daftar server terdaftar { <name>: { type, url?, command?, args?, headers? } }
  mcpServers: {},
  // Folder proyek yang MCP-nya sudah disetujui pengguna. Entri baru berbentuk
  // { path, hash } agar perubahan .mcp.json memicu persetujuan ulang.
  mcpTrustedProjects: [],
  // Folder proyek yang hooks-nya (.baiwor/hooks.json) sudah disetujui.
  // Hook menjalankan shell command, jadi file proyek tidak boleh dieksekusi
  // hanya karena repo di-clone. Entri { path, hash } memaksa persetujuan ulang
  // setiap kali isi file berubah.
  hooksTrustedProjects: [],
};

export function maskSecret(str) {
  if (!str || typeof str !== 'string') return '••••';
  const s = str.trim();
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(CONFIG_DIR, 0o700);
  } catch {
    // Best effort, abaikan di Windows
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
  // Nama tmp unik: dua proses CLI yang menyimpan bersamaan tidak saling
  // menimpa file sementara satu sama lain.
  const tmpPath = path.join(
    CONFIG_DIR,
    `config.json.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
    try {
      const fd = fs.openSync(tmpPath, 'r+');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch {}
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {}
    fs.renameSync(tmpPath, CONFIG_FILE);
    try {
      fs.chmodSync(CONFIG_FILE, 0o600);
    } catch {}
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  } finally {
    clearConfigCache();
  }
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

    // Bedakan dua jenis kegagalan:
    //  - JSON rusak (SyntaxError): file bisa dicadangkan lalu ditulis ulang
    //    dengan default.
    //  - Error I/O (EACCES/EPERM/EBUSY): file TIDAK boleh disentuh sama
    //    sekali. Menimpanya dengan default akan menghapus seluruh token
    //    OAuth, API key, dan MCP server milik pengguna.
    const isParseError = err instanceof SyntaxError;

    if (!isParseError) {
      console.error(
        `\n⚠️  Gagal membaca config.json (${err.message}).\n` +
          `    File asli TIDAK ditimpa. Periksa izin akses atau perbaiki manual: ${CONFIG_FILE}`
      );
      return { ...DEFAULT_CONFIG };
    }

    // File rusak: JANGAN timpa! Cadangkan dulu — dan HANYA tulis default
    // bila pencadangan benar-benar berhasil. Kalau rename gagal, file asli
    // masih utuh dan tidak boleh dihapus.
    const timestamp = Date.now();
    const backupFile = path.join(CONFIG_DIR, `config.json.bak-${timestamp}`);
    let backedUp = false;
    try {
      fs.renameSync(CONFIG_FILE, backupFile);
      backedUp = true;
    } catch (backupErr) {
      console.error(
        `\n⚠️  File config.json rusak dan pencadangan GAGAL (${backupErr.message}).\n` +
          `    File asli TIDAK ditimpa. Perbaiki manual: ${CONFIG_FILE}`
      );
    }
    if (backedUp) {
      console.warn(`\n⚠️  File config.json rusak. File lama dicadangkan ke: ${backupFile}`);
      writeAtomicConfig(DEFAULT_CONFIG);
    }
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

/**
 * Mengembalikan mode izin terpadu yang aktif. Nilai tak dikenal jatuh ke
 * 'safe' sehingga konfigurasi rusak/salah ketik tidak pernah membuka akses penuh.
 *
 * @returns {'safe'|'auto'|'plan'|'yolo'}
 */
export function getPermissionMode() {
  const cfg = getConfig();
  const raw = cfg.permissionMode;
  if (raw === 'safe' || raw === 'auto' || raw === 'plan' || raw === 'yolo') return raw;
  // Migrasi sekali dari field lama: plan → 'plan', full → 'yolo', selain itu 'safe'.
  if (cfg.agentMode === 'plan') return 'plan';
  if (cfg.accessMode === 'full') return 'yolo';
  return 'safe';
}

/**
 * Menyetel mode izin terpadu dan menyimpannya ke config agar bertahan antar-sesi.
 *
 * @param {'safe'|'auto'|'plan'|'yolo'} mode
 * @returns {'safe'|'auto'|'plan'|'yolo'} mode yang benar-benar aktif
 */
export function setPermissionMode(mode) {
  const next = mode === 'auto' || mode === 'plan' || mode === 'yolo' ? mode : 'safe';
  if (getConfig().permissionMode !== next) {
    saveConfig({ permissionMode: next });
  }
  return getPermissionMode();
}

/**
 * [deprecated] Label akses lama untuk konsumen yang belum bermigrasi.
 * 'yolo' dipetakan ke 'full', sisanya ke 'normal'.
 *
 * @returns {'normal'|'full'}
 */
export function getAccessMode() {
  return getPermissionMode() === 'yolo' ? 'full' : 'normal';
}

/**
 * [deprecated] Mode agen lama; 'plan' kini adalah salah satu permissionMode.
 *
 * @returns {'build'|'plan'}
 */
export function getAgentMode() {
  return getPermissionMode() === 'plan' ? 'plan' : 'build';
}

/**
 * Menormalkan path proyek untuk perbandingan trust MCP.
 * Memakai realpath bila tersedia agar symlink/junction tidak memicu prompt
 * berbeda untuk folder yang sama.
 *
 * @param {string} projectPath
 * @returns {string}
 */
export function normalizeMcpProjectPath(projectPath) {
  let resolved;
  try {
    resolved = fs.realpathSync.native(projectPath);
  } catch {
    try {
      resolved = fs.realpathSync(projectPath);
    } catch {
      resolved = path.resolve(projectPath);
    }
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Mencocokkan path proyek (dan hash opsional) pada daftar trust.
 *
 * @param {Array} list
 * @param {string} projectPath
 * @param {string|null} [configHash]
 * @returns {boolean}
 */
function isTrustedInList(list, projectPath, configHash = null) {
  if (!Array.isArray(list) || list.length === 0) return false;
  const normalized = normalizeMcpProjectPath(projectPath);
  return list.some((entry) => {
    if (typeof entry === 'string') {
      return normalizeMcpProjectPath(entry) === normalized;
    }
    if (!entry || typeof entry !== 'object' || !entry.path) return false;
    if (normalizeMcpProjectPath(entry.path) !== normalized) return false;
    return !configHash || entry.hash === configHash;
  });
}

function addTrustedToList(list, projectPath, configHash) {
  const current = Array.isArray(list) ? list : [];
  const normalized = normalizeMcpProjectPath(projectPath);
  const others = current.filter((entry) => {
    const entryPath = typeof entry === 'string' ? entry : entry?.path;
    return !entryPath || normalizeMcpProjectPath(entryPath) !== normalized;
  });
  return [...others, { path: path.resolve(projectPath), hash: configHash }];
}

/**
 * Apakah konfigurasi MCP proyek ini sudah dipercaya.
 * Entri hash hanya cocok bila isi file konfigurasi tidak berubah.
 *
 * @param {string} projectPath
 * @param {string|null} [configHash]
 * @returns {boolean}
 */
export function isMcpProjectTrusted(projectPath, configHash = null) {
  return isTrustedInList(getConfig().mcpTrustedProjects, projectPath, configHash);
}

/**
 * Menyimpan persetujuan MCP untuk satu folder proyek beserta hash konfigurasi.
 *
 * @param {string} projectPath
 * @param {string} configHash
 */
export function trustMcpProject(projectPath, configHash) {
  saveConfig({
    mcpTrustedProjects: addTrustedToList(
      getConfig().mcpTrustedProjects,
      projectPath,
      configHash
    ),
  });
}

/**
 * Apakah hooks proyek sudah dipercaya. Hash harus cocok agar perubahan isi
 * `.baiwor/hooks.json` memicu persetujuan ulang.
 */
export function isHooksProjectTrusted(projectPath, configHash = null) {
  return isTrustedInList(getConfig().hooksTrustedProjects, projectPath, configHash);
}

/**
 * Menyimpan persetujuan hooks proyek beserta hash file.
 *
 * @param {string} projectPath
 * @param {string} configHash
 */
export function trustHooksProject(projectPath, configHash) {
  saveConfig({
    hooksTrustedProjects: addTrustedToList(
      getConfig().hooksTrustedProjects,
      projectPath,
      configHash
    ),
  });
}

export function saveConfig(partialConfig) {
  try {
    return saveConfigStrict(partialConfig);
  } catch (err) {
    console.error('Gagal menyimpan konfigurasi:', err.message);
    return getConfig();
  }
}

/**
 * Menyimpan konfigurasi dan MEMUNCINGKAN kegagalan.
 *
 * Pakai varian ini di jalur yang menampilkan pesan "tersimpan" ke pengguna:
 * bila penulisan gagal, pemanggil harus tahu dan tidak boleh mengira
 * kunci/API key baru sudah aktif.
 *
 * @param {Object} partialConfig
 * @returns {Object} konfigurasi tersimpan
 * @throws {Error} bila file config tidak bisa ditulis
 */
export function saveConfigStrict(partialConfig) {
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
  saveConfigStrict({ tinyfishApiKey: clean });
  return clean;
}

/**
 * Mendapatkan API Key Tavily: env TAVILY_API_KEY menang atas konfigurasi.
 * @returns {string}
 */
export function getTavilyApiKey() {
  if (process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.trim()) {
    return process.env.TAVILY_API_KEY.trim();
  }
  const config = getConfig();
  if (typeof config.tavilyApiKey === 'string' && config.tavilyApiKey.trim()) {
    return config.tavilyApiKey.trim();
  }
  return '';
}

/**
 * Menyimpan API Key Tavily ke ~/.baiwor/config.json.
 * @param {string} key
 * @returns {string}
 */
export function saveTavilyApiKey(key) {
  const clean = String(key || '').trim();
  saveConfigStrict({ tavilyApiKey: clean });
  return clean;
}

/**
 * Mendapatkan API Key Firecrawl: env FIRECRAWL_API_KEY menang atas konfigurasi.
 * @returns {string}
 */
export function getFirecrawlApiKey() {
  if (process.env.FIRECRAWL_API_KEY && process.env.FIRECRAWL_API_KEY.trim()) {
    return process.env.FIRECRAWL_API_KEY.trim();
  }
  const config = getConfig();
  if (typeof config.firecrawlApiKey === 'string' && config.firecrawlApiKey.trim()) {
    return config.firecrawlApiKey.trim();
  }
  return '';
}

/**
 * Menyimpan API Key Firecrawl ke ~/.baiwor/config.json.
 * @param {string} key
 * @returns {string}
 */
export function saveFirecrawlApiKey(key) {
  const clean = String(key || '').trim();
  saveConfigStrict({ firecrawlApiKey: clean });
  return clean;
}

/**
 * Mendapatkan API Key InstaBox dengan urutan prioritas:
 * 1. Environment variable INSTABOX_API_KEY
 * 2. Konfigurasi bAIwor Code (~/.baiwor/config.json -> instaboxApiKey)
 *
 * @returns {string}
 */
export function getInstaboxApiKey() {
  if (process.env.INSTABOX_API_KEY && process.env.INSTABOX_API_KEY.trim()) {
    return process.env.INSTABOX_API_KEY.trim();
  }
  const config = getConfig();
  if (config.instaboxApiKey && typeof config.instaboxApiKey === 'string' && config.instaboxApiKey.trim()) {
    return config.instaboxApiKey.trim();
  }
  return '';
}

/**
 * Menyimpan API Key InstaBox ke dalam konfigurasi ~/.baiwor/config.json.
 * @param {string} key
 * @returns {string}
 */
export function saveInstaboxApiKey(key) {
  const clean = String(key || '').trim();
  saveConfig({ instaboxApiKey: clean });
  return clean;
}

/**
 * Mendapatkan ID / Nama mesin InstaBox aktif.
 * @returns {string}
 */
export function getInstaboxMachineId() {
  if (process.env.INSTABOX_MACHINE_ID && process.env.INSTABOX_MACHINE_ID.trim()) {
    return process.env.INSTABOX_MACHINE_ID.trim();
  }
  const config = getConfig();
  return config.instaboxMachineId || 'baiwor';
}

/**
 * Menyimpan default machine ID InstaBox.
 * @param {string} id
 * @returns {string}
 */
export function saveInstaboxMachineId(id) {
  const clean = String(id || '').trim();
  saveConfig({ instaboxMachineId: clean });
  return clean;
}

export const setInstaboxApiKey = saveInstaboxApiKey;
export const setInstaboxMachineId = saveInstaboxMachineId;

