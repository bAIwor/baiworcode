import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { CONFIG_DIR } from '../config.js';
import { estimateMessagesTokens } from './context.js';

export const SESSIONS_DIR_NAME = 'sessions';

/**
 * Menghasilkan slug dan hash unik untuk suatu direktori proyek.
 * Path dinormalisasi (lowercase di Windows) agar perbedaan case tidak membuat hash ganda.
 * Jika dijalankan di root user / home directory, nama personal disamarkan menjadi 'bcode'.
 *
 * @param {string} [projectPath=process.cwd()]
 * @returns {string} Contoh: 'bcode-73acde24' atau 'myproject-a1b2c3d4'
 */
export function getProjectKey(projectPath = process.cwd()) {
  const resolved = path.resolve(projectPath);
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;

  // Samarkan home directory pengguna atau folder yang dinamai sesuai username OS menjadi 'bcode'
  const homeResolved = path.resolve(os.homedir());
  const isHomeDir = process.platform === 'win32'
    ? normalized === homeResolved.toLowerCase()
    : resolved === homeResolved;

  let baseName = path.basename(resolved);
  if (isHomeDir || !baseName || baseName === '/' || baseName === '\\') {
    baseName = 'bcode';
  } else {
    try {
      const username = os.userInfo().username;
      if (username && baseName.toLowerCase() === username.toLowerCase()) {
        baseName = 'bcode';
      }
    } catch {}
  }

  const safeSlug = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'bcode';
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  return `${safeSlug}-${hash}`;
}

/**
 * Mengambil direktori penyimpanan sesi untuk proyek aktif, dan memastikannya ada.
 *
 * @param {string} [projectPath=process.cwd()]
 * @param {string} [baseConfigDir=CONFIG_DIR]
 * @returns {string}
 */
export function getProjectSessionDir(projectPath = process.cwd(), baseConfigDir = CONFIG_DIR) {
  const projectKey = getProjectKey(projectPath);
  const dir = path.join(baseConfigDir, SESSIONS_DIR_NAME, projectKey);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Best effort di Windows
    }
  }
  return dir;
}

/**
 * Menghasilkan ID sesi unik berkarakter khas bAIwor berbasis tanggal dan hex acak.
 * Format: baiwor_DD-MM-YYYY_<hex> (menggunakan tanda hubung agar valid sebagai nama berkas di semua OS).
 *
 * @returns {string} Contoh: baiwor_16-10-2026_a1b2c3
 */
export function generateSessionId() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const rand = crypto.randomBytes(3).toString('hex');
  return `baiwor_${dd}-${mm}-${yyyy}_${rand}`;
}

/**
 * Menghasilkan judul ringkas dari pesan user pertama dalam percakapan.
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {string} [fallback='Percakapan Baru']
 * @returns {string}
 */
export function deriveSessionTitle(messages = [], fallback = 'Percakapan Baru') {
  if (!Array.isArray(messages)) return fallback;
  const firstUser = messages.find((m) => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim());
  if (!firstUser) return fallback;

  // Bersihkan baris baru dan karakter berulang
  const clean = firstUser.content
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return fallback;
  return clean.length > 50 ? `${clean.slice(0, 47)}...` : clean;
}

/**
 * Menyimpan data sesi ke disk secara atomik dalam format JSONL append-only.
 * Baris pertama berisi header metadata sesi, baris selanjutnya berisi entri pesan.
 *
 * @param {object} sessionData
 * @param {string} sessionData.id
 * @param {Array} sessionData.messages
 * @param {string} [sessionData.title]
 * @param {string} [sessionData.projectPath]
 * @param {string} [sessionData.model]
 * @param {string} [sessionData.provider]
 * @param {object} [options]
 * @param {string} [options.projectPath]
 * @param {string} [options.baseConfigDir]
 * @returns {object} Session data yang berhasil disimpan
 */
export function saveSession(sessionData, { projectPath = process.cwd(), baseConfigDir = CONFIG_DIR } = {}) {
  if (!sessionData || !sessionData.id) {
    throw new Error('saveSession: data sesi tidak valid atau tidak memiliki id');
  }

  const dir = getProjectSessionDir(projectPath, baseConfigDir);
  const filePath = path.join(dir, `${sessionData.id}.jsonl`);
  const tmpPath = path.join(dir, `${sessionData.id}.jsonl.tmp`);

  const messages = Array.isArray(sessionData.messages) ? sessionData.messages : [];
  const now = new Date().toISOString();

  const payload = {
    id: sessionData.id,
    title: sessionData.title || deriveSessionTitle(messages),
    projectPath: path.resolve(projectPath),
    createdAt: sessionData.createdAt || now,
    updatedAt: now,
    model: sessionData.model || null,
    provider: sessionData.provider || null,
    stats: {
      turnCount: messages.filter((m) => m?.role === 'user').length,
      tokensEstimate: estimateMessagesTokens(messages),
    },
    messages,
  };

  const header = JSON.stringify({
    type: 'session',
    id: payload.id,
    title: payload.title,
    projectPath: payload.projectPath,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    model: payload.model,
    provider: payload.provider,
    stats: payload.stats,
  });

  const lines = [header];
  for (const msg of messages) {
    lines.push(JSON.stringify({ type: 'message', message: msg }));
  }
  const fileContent = lines.join('\n') + '\n';

  fs.writeFileSync(tmpPath, fileContent, 'utf8');

  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (process.platform === 'win32' && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        fs.renameSync(tmpPath, filePath);
      } catch {
        fs.writeFileSync(filePath, fileContent, 'utf8');
        try { fs.unlinkSync(tmpPath); } catch {}
      }
    } else {
      throw err;
    }
  }

  return payload;
}

/**
 * Menambahkan (append) pesan baru secara efisien ke akhir berkas sesi JSONL tanpa menulis ulang keseluruhan berkas.
 *
 * @param {string} sessionId
 * @param {object} message
 * @param {object} [options]
 * @param {string} [options.projectPath]
 * @param {string} [options.baseConfigDir]
 * @returns {boolean} true jika append berhasil
 */
export function appendSessionMessage(sessionId, message, { projectPath = process.cwd(), baseConfigDir = CONFIG_DIR } = {}) {
  if (!sessionId || !message) return false;

  const safeId = path.basename(sessionId.replace(/\.(jsonl?)$/i, ''));
  const dir = getProjectSessionDir(projectPath, baseConfigDir);
  const filePath = path.join(dir, `${safeId}.jsonl`);

  if (!fs.existsSync(filePath)) {
    // Jika belum ada berkas JSONL, inisialisasi sesi terlebih dahulu
    saveSession({ id: safeId, messages: [message] }, { projectPath, baseConfigDir });
    return true;
  }

  const record = JSON.stringify({
    type: 'message',
    message,
    timestamp: new Date().toISOString(),
  }) + '\n';

  fs.appendFileSync(filePath, record, 'utf8');
  return true;
}

/**
 * Membaca berkas JSONL atau berkas JSON legacy dan mengonversinya menjadi objek sesi.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function parseSessionFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;

    if (filePath.endsWith('.jsonl')) {
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) return null;

      const firstObj = JSON.parse(lines[0]);
      if (!firstObj || typeof firstObj !== 'object' || !firstObj.id) return null;
      const session = {
        id: firstObj.id,
        title: firstObj.title || 'Percakapan Tanpa Judul',
        projectPath: firstObj.projectPath || process.cwd(),
        createdAt: firstObj.createdAt || null,
        updatedAt: firstObj.updatedAt || null,
        model: firstObj.model || null,
        provider: firstObj.provider || null,
        stats: firstObj.stats || { turnCount: 0, tokensEstimate: 0 },
        messages: [],
      };

      for (let i = 1; i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === 'message' && entry.message) {
            session.messages.push(entry.message);
          } else if (entry.role && entry.content !== undefined) {
            session.messages.push(entry);
          }
        } catch {}
      }

      session.stats.turnCount = session.messages.filter((m) => m?.role === 'user').length;
      return session;
    }

    // Berkas .json legacy
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Memuat sesi berdasarkan ID dari disk.
 * Mendukung format .jsonl terbaru maupun .json legacy.
 *
 * @param {string} sessionId
 * @param {object} [options]
 * @param {string} [options.projectPath]
 * @param {string} [options.baseConfigDir]
 * @returns {object|null}
 */
export function loadSession(sessionId, { projectPath = process.cwd(), baseConfigDir = CONFIG_DIR } = {}) {
  if (!sessionId || typeof sessionId !== 'string') return null;

  // Cegah directory traversal
  const safeId = path.basename(sessionId.replace(/\.(jsonl?)$/i, ''));
  const dir = getProjectSessionDir(projectPath, baseConfigDir);

  const jsonlPath = path.join(dir, `${safeId}.jsonl`);
  if (fs.existsSync(jsonlPath)) {
    return parseSessionFile(jsonlPath);
  }

  const jsonPath = path.join(dir, `${safeId}.json`);
  if (fs.existsSync(jsonPath)) {
    return parseSessionFile(jsonPath);
  }

  // Fallback pencarian lintas proyek bila sesi dibuka dari folder lain (misalnya direktori HOME)
  const rootSessionsDir = path.join(baseConfigDir, SESSIONS_DIR_NAME);
  if (fs.existsSync(rootSessionsDir)) {
    try {
      const subdirs = fs.readdirSync(rootSessionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const sub of subdirs) {
        const candidateDir = path.join(rootSessionsDir, sub);
        for (const ext of ['.jsonl', '.json']) {
          const candidatePath = path.join(candidateDir, `${safeId}${ext}`);
          if (fs.existsSync(candidatePath)) {
            return parseSessionFile(candidatePath);
          }
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Menghapus sesi dari disk berdasarkan ID.
 *
 * @param {string} sessionId
 * @param {object} [options]
 * @param {string} [options.projectPath]
 * @param {string} [options.baseConfigDir]
 * @returns {boolean} true jika berhasil dihapus
 */
export function deleteSession(sessionId, { projectPath = process.cwd(), baseConfigDir = CONFIG_DIR } = {}) {
  if (!sessionId || typeof sessionId !== 'string') return false;
  const safeId = path.basename(sessionId.replace(/\.(jsonl?)$/i, ''));
  const dir = getProjectSessionDir(projectPath, baseConfigDir);

  let deleted = false;
  for (const ext of ['.jsonl', '.json']) {
    const filePath = path.join(dir, `${safeId}${ext}`);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        deleted = true;
      } catch {}
    }
  }

  return deleted;
}

/**
 * Menghapus SELURUH sesi percakapan pada proyek aktif.
 *
 * @param {object} [options]
 * @param {string} [options.projectPath]
 * @param {string} [options.baseConfigDir]
 * @returns {number} Jumlah sesi yang berhasil dihapus
 */
export function deleteAllSessions({ projectPath = process.cwd(), baseConfigDir = CONFIG_DIR } = {}) {
  const dir = getProjectSessionDir(projectPath, baseConfigDir);
  if (!fs.existsSync(dir)) return 0;

  const files = fs.readdirSync(dir).filter((f) => (f.endsWith('.json') || f.endsWith('.jsonl')) && !f.endsWith('.tmp'));
  let count = 0;
  for (const file of files) {
    try {
      fs.unlinkSync(path.join(dir, file));
      count += 1;
    } catch {}
  }
  return count;
}

/**
 * Mengambil daftar seluruh sesi pada proyek aktif, diurutkan dari yang terbaru (updatedAt descending).
 * Hanya memuat metadata ringan (tanpa mengembalikan seluruh array pesan jika tidak perlu).
 *
 * @param {object} [options]
 * @param {string} [options.projectPath]
 * @param {string} [options.baseConfigDir]
 * @param {boolean} [options.includeMessages=false]
 * @returns {Array<object>}
 */
export function listSessions({ projectPath = process.cwd(), baseConfigDir = CONFIG_DIR, includeMessages = false } = {}) {
  const dir = getProjectSessionDir(projectPath, baseConfigDir);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => (f.endsWith('.json') || f.endsWith('.jsonl')) && !f.endsWith('.tmp'));
  const sessionMap = new Map();

  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      if (file.endsWith('.jsonl')) {
        // Optimasi: baca baris pertama saja untuk metadata
        const fd = fs.openSync(fullPath, 'r');
        const buf = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);

        const content = buf.toString('utf8', 0, bytesRead);
        const firstLine = content.split(/\r?\n/)[0];
        if (!firstLine) continue;

        const data = JSON.parse(firstLine);
        if (!data || !data.id) continue;

        const meta = {
          id: data.id,
          title: data.title || 'Percakapan Tanpa Judul',
          projectPath: data.projectPath || projectPath,
          createdAt: data.createdAt || null,
          updatedAt: data.updatedAt || null,
          model: data.model || null,
          provider: data.provider || null,
          stats: data.stats || { turnCount: 0, tokensEstimate: 0 },
        };

        if (includeMessages) {
          const fullSession = parseSessionFile(fullPath);
          meta.messages = fullSession?.messages || [];
        }

        sessionMap.set(data.id, meta);
      } else {
        // Berkas .json legacy
        const raw = fs.readFileSync(fullPath, 'utf8');
        const data = JSON.parse(raw);
        if (!data || !data.id) continue;

        const meta = {
          id: data.id,
          title: data.title || 'Percakapan Tanpa Judul',
          projectPath: data.projectPath || projectPath,
          createdAt: data.createdAt || null,
          updatedAt: data.updatedAt || null,
          model: data.model || null,
          provider: data.provider || null,
          stats: data.stats || {
            turnCount: Array.isArray(data.messages) ? data.messages.filter((m) => m?.role === 'user').length : 0,
            tokensEstimate: 0,
          },
        };

        if (includeMessages) {
          meta.messages = data.messages || [];
        }

        // Jangan timpa jika versi .jsonl sudah ada
        if (!sessionMap.has(data.id)) {
          sessionMap.set(data.id, meta);
        }
      }
    } catch {
      // Abaikan berkas korup atau rusak
    }
  }

  const sessions = Array.from(sessionMap.values());

  // Urutkan dari yang paling baru diupdate
  sessions.sort((a, b) => {
    const tA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tB - tA;
  });

  return sessions;
}

/**
  * Mengambil seluruh sesi dari seluruh folder proyek yang tersimpan.
  * Berguna saat bcode dijalankan di luar folder proyek (misalnya direktori HOME)
  * agar pengguna tetap bisa melihat dan melanjutkan sesi proyek sebelumnya.
  *
  * @param {object} [options]
  * @param {string} [options.baseConfigDir=CONFIG_DIR]
  * @param {boolean} [options.includeMessages=false]
  * @returns {Array<object>}
  */
export function listAllProjectsSessions({ baseConfigDir = CONFIG_DIR, includeMessages = false } = {}) {
  const rootSessionsDir = path.join(baseConfigDir, SESSIONS_DIR_NAME);
  if (!fs.existsSync(rootSessionsDir)) return [];

  const subdirs = fs.readdirSync(rootSessionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const all = [];
  for (const sub of subdirs) {
    const dir = path.join(rootSessionsDir, sub);
    const files = fs.readdirSync(dir).filter((f) => (f.endsWith('.json') || f.endsWith('.jsonl')) && !f.endsWith('.tmp'));
    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        if (file.endsWith('.jsonl')) {
          const fd = fs.openSync(fullPath, 'r');
          const buf = Buffer.alloc(4096);
          const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
          fs.closeSync(fd);

          const content = buf.toString('utf8', 0, bytesRead);
          const firstLine = content.split(/\r?\n/)[0];
          if (!firstLine) continue;

          const data = JSON.parse(firstLine);
          if (!data || !data.id) continue;

          all.push({
            id: data.id,
            title: data.title || 'Percakapan Tanpa Judul',
            projectPath: data.projectPath || '',
            projectKey: sub,
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null,
            model: data.model || null,
            provider: data.provider || null,
            stats: data.stats || { turnCount: 0, tokensEstimate: 0 },
          });
        }
      } catch {}
    }
  }

  all.sort((a, b) => {
    const tA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tB - tA;
  });

  return all;
}

/**
 * Mengambil sesi terakhir yang paling baru diupdate untuk proyek ini (untuk fitur resume).
 * Bila proyek aktif kosong, fallback ke sesi proyek terakhir yang tersedia.
 *
 * @param {object} [options]
 * @param {string} [options.projectPath]
 * @param {string} [options.baseConfigDir]
 * @returns {object|null}
 */
export function getLatestSession({ projectPath = process.cwd(), baseConfigDir = CONFIG_DIR } = {}) {
  const list = listSessions({ projectPath, baseConfigDir, includeMessages: true });
  if (list.length > 0) return list[0];

  // Fallback ke sesi terbaru lintas proyek bila folder saat ini belum punya riwayat
  const allProjects = listAllProjectsSessions({ baseConfigDir });
  if (allProjects.length > 0) {
    const top = allProjects[0];
    return loadSession(top.id, { baseConfigDir });
  }

  return null;
}
