import fs from 'node:fs';
import path from 'node:path';

/**
 * Modul Snapshot & Rollback untuk bAIwor Code.
 *
 * Mencatat kondisi berkas sebelum dimodifikasi oleh tool pengubah berkas
 * (`write_file`, `edit_file`, `patch_file`), dan menyediakan fungsi rollback
 * instan untuk membatalkan seluruh perubahan berkas pada satu putaran (/undo).
 */

const MAX_UNDO_STACK = 50;

/** @type {Array<{turnId: string|number, timestamp: number, files: Map<string, {exists: boolean, content?: string}>}>} */
const undoStack = [];

/** @type {Array<{turnId: string|number, timestamp: number, files: Map<string, {exists: boolean, content?: string}>}>} */
const redoStack = [];

let activeTurn = null;

/**
 * Memulai pelacakan putaran percakapan baru.
 *
 * @param {string|number} [turnId]
 */
export function beginTurnSnapshot(turnId = Date.now()) {
  if (activeTurn && activeTurn.files.size > 0) {
    commitTurnSnapshot();
  }
  activeTurn = {
    turnId,
    timestamp: Date.now(),
    files: new Map(),
  };
}

/**
 * Mencatat kondisi awal sebuah berkas sebelum diubah atau dibuat.
 * Jika berkas yang sama diubah beberapa kali dalam satu putaran,
 * kondisi yang disimpan adalah kondisi PALING AWAL sebelum putaran dimulai.
 *
 * @param {string} filePath - Path berkas (relatif atau absolut)
 */
export function recordFileBeforeChange(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);

  if (!activeTurn) {
    activeTurn = {
      turnId: Date.now(),
      timestamp: Date.now(),
      files: new Map(),
    };
  }

  // Jika berkas sudah dicatat pada putaran ini, jangan timpa snapshot awalnya
  if (activeTurn.files.has(resolved)) {
    return;
  }

  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const content = fs.readFileSync(resolved, 'utf8');
      activeTurn.files.set(resolved, {
        exists: true,
        content,
      });
    } else {
      // Berkas belum ada (akan dibuat oleh write_file)
      activeTurn.files.set(resolved, {
        exists: false,
      });
    }
  } catch (err) {
    // Abaikan jika tidak dapat dibaca, jangan gagalkan proses utama
  }
}

/**
 * Mengunci snapshot putaran saat ini dan memasukkannya ke riwayat undo.
 */
export function commitTurnSnapshot() {
  if (!activeTurn) return;

  if (activeTurn.files.size > 0) {
    undoStack.push(activeTurn);
    if (undoStack.length > MAX_UNDO_STACK) {
      undoStack.shift();
    }
    // Kosongkan redo saat ada aksi baru
    redoStack.length = 0;
  }

  activeTurn = null;
}

/**
 * Membatalkan perubahan berkas pada putaran terakhir (/undo).
 *
 * @returns {{
 *   success: boolean,
 *   restoredCount: number,
 *   files: Array<string>,
 *   message: string
 * }}
 */
export function undoLastTurn() {
  // Jika masih ada activeTurn yang belum dicommit dan memiliki berkas
  if (activeTurn && activeTurn.files.size > 0) {
    commitTurnSnapshot();
  }

  if (undoStack.length === 0) {
    return {
      success: false,
      restoredCount: 0,
      files: [],
      message: 'Belum ada perubahan berkas pada sesi ini untuk dibatalkan (/undo).',
    };
  }

  const turn = undoStack.pop();
  const restoredFiles = [];
  const redoFiles = new Map();

  for (const [filePath, snapshot] of turn.files.entries()) {
    try {
      // Catat kondisi saat ini untuk keperluan redo (jika diperlukan)
      const currentExists = fs.existsSync(filePath);
      const currentContent = currentExists ? fs.readFileSync(filePath, 'utf8') : null;
      redoFiles.set(filePath, { exists: currentExists, content: currentContent });

      if (snapshot.exists) {
        // Kembalikan isi berkas sebelumnya
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, snapshot.content, 'utf8');
        restoredFiles.push(filePath);
      } else {
        // Berkas tadinya belum ada, hapus kembali
        if (currentExists) {
          fs.unlinkSync(filePath);
          restoredFiles.push(filePath);
        }
      }
    } catch (err) {
      // Catat kegagalan spesifik jika ada berkas yang terkunci
    }
  }

  redoStack.push({
    turnId: turn.turnId,
    timestamp: Date.now(),
    files: redoFiles,
  });

  return {
    success: true,
    restoredCount: restoredFiles.length,
    files: restoredFiles,
    message: `Berhasil mengembalikan ${restoredFiles.length} berkas ke kondisi sebelum putaran terakhir.`,
  };
}

/**
 * Mengulang kembali pembatalan perubahan (/redo).
 *
 * @returns {{
 *   success: boolean,
 *   restoredCount: number,
 *   files: Array<string>,
 *   message: string
 * }}
 */
export function redoLastTurn() {
  if (redoStack.length === 0) {
    return {
      success: false,
      restoredCount: 0,
      files: [],
      message: 'Tidak ada perubahan berkas yang dapat diulang (/redo).',
    };
  }

  const turn = redoStack.pop();
  const reappliedFiles = [];
  const undoFiles = new Map();

  for (const [filePath, snapshot] of turn.files.entries()) {
    try {
      const currentExists = fs.existsSync(filePath);
      const currentContent = currentExists ? fs.readFileSync(filePath, 'utf8') : null;
      undoFiles.set(filePath, { exists: currentExists, content: currentContent });

      if (snapshot.exists) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, snapshot.content, 'utf8');
        reappliedFiles.push(filePath);
      } else {
        if (currentExists) {
          fs.unlinkSync(filePath);
          reappliedFiles.push(filePath);
        }
      }
    } catch (err) {}
  }

  undoStack.push({
    turnId: turn.turnId,
    timestamp: Date.now(),
    files: undoFiles,
  });

  return {
    success: true,
    restoredCount: reappliedFiles.length,
    files: reappliedFiles,
    message: `Berhasil menerapkan kembali ${reappliedFiles.length} berkas.`,
  };
}

/**
 * Apakah ada putaran yang dapat di-undo.
 *
 * @returns {boolean}
 */
export function canUndo() {
  return undoStack.length > 0 || (activeTurn !== null && activeTurn.files.size > 0);
}

/**
 * Apakah ada putaran yang dapat di-redo.
 *
 * @returns {boolean}
 */
export function canRedo() {
  return redoStack.length > 0;
}

/**
 * Mengosongkan riwayat snapshot (misal saat /reset atau pengujian).
 */
export function clearSnapshots() {
  undoStack.length = 0;
  redoStack.length = 0;
  activeTurn = null;
}

/**
 * Mengembalikan ringkasan riwayat undo aktif.
 */
export function getSnapshotHistory() {
  return undoStack.map((turn) => ({
    turnId: turn.turnId,
    timestamp: turn.timestamp,
    fileCount: turn.files.size,
    files: Array.from(turn.files.keys()),
  }));
}
