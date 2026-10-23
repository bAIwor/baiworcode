import * as p from '@clack/prompts';
import chalk from 'chalk';
import { sanitizeTerminalText } from '../chat/wrapText.js';

let customApprovalHandler = null;
let customFileApprovalHandler = null;

/**
 * Menyimpan custom handler konfirmasi untuk keperluan pengujian otomatis (mock).
 *
 * @param {Function|null} handler - (command, reason) => Promise<{ approved: boolean, message?: string }>
 */
export function setApprovalHandler(handler) {
  customApprovalHandler = handler;
}

/**
 * Menyimpan custom handler konfirmasi modifikasi berkas untuk pengujian otomatis (mock).
 *
 * @param {Function|null} handler - (details) => Promise<{ approved: boolean, message?: string }>
 */
export function setFileApprovalHandler(handler) {
  customFileApprovalHandler = handler;
}

/**
 * Mengembalikan handler konfirmasi ke perilaku standar.
 */
export function resetApprovalHandler() {
  customApprovalHandler = null;
  customFileApprovalHandler = null;
}

export function resetFileApprovalHandler() {
  customFileApprovalHandler = null;
}

export function hasFileApprovalHandler() {
  return Boolean(customFileApprovalHandler);
}

/**
 * Meminta persetujuan pengguna (Human-in-the-Loop) sebelum mengeksekusi perintah berisiko.
 *
 * @param {string} command - Perintah shell yang akan dijalankan
 * @param {string} [reason] - Alasan mengapa perintah membutuhkan konfirmasi
 * @returns {Promise<{ approved: boolean, message?: string }>}
 */
export async function requestCommandApproval(command, reason = '') {
  // Gunakan custom handler jika disetel (misal dalam unit test)
  if (customApprovalHandler) {
    return await customApprovalHandler(command, reason);
  }

  // Jika terminal tidak interaktif (non-TTY seperti `baiworcode "prompt"` atau pipe CI),
  // JANGAN menunggu input untuk mencegah proses menggantung selamanya.
  if (!process.stdin.isTTY) {
    return {
      approved: false,
      message: `Perintah '${command}' dibatalkan otomatis (memerlukan konfirmasi interaktif, namun sesi berjalan dalam mode non-TTY).`,
    };
  }

  try {
    console.log();
    const safeCommand = sanitizeTerminalText(command, { preserveNewlines: false });
    const safeReason = sanitizeTerminalText(
      reason || 'Perintah berpotensi mengubah status sistem atau repositori.',
      { preserveNewlines: false }
    );
    const answer = await p.confirm({
      message: `Perintah berisiko terdeteksi: "${safeCommand}"\n  Alasan: ${safeReason}\n  Izinkan bAIwor menjalankan perintah ini?`,
      initialValue: false, // Default: Tidak (aman secara bawaan)
    });

    if (p.isCancel(answer) || !answer) {
      return {
        approved: false,
        message: `Perintah '${command}' dibatalkan oleh pengguna (butuh konfirmasi).`,
      };
    }

    return {
      approved: true,
    };
  } catch {
    return {
      approved: false,
      message: `Perintah '${command}' dibatalkan (tidak dapat menampilkan prompt persetujuan).`,
    };
  }
}

/**
 * Meminta persetujuan pengguna (Human-in-the-Loop) sebelum memodifikasi berkas di disk
 * pada mode akses Safe ('normal').
 *
 * @param {Object} details
 * @param {string} details.filePath - Path berkas yang akan diubah
 * @param {string} [details.action='edit'] - 'write' | 'edit' | 'patch'
 * @param {string} [details.diff=''] - Colored unified diff
 * @param {string} [details.diffStats=''] - '+X -Y' statistik
 * @returns {Promise<{ approved: boolean, message?: string }>}
 */
export async function requestFileChangeApproval({
  filePath,
  action = 'edit',
  diff = '',
  diffStats = '',
} = {}) {
  if (customFileApprovalHandler) {
    return await customFileApprovalHandler({ filePath, action, diff, diffStats });
  }

  // Terminal non-interaktif (pipe, CI, `baiworcode "prompt"`): tidak ada
  // manusia yang bisa meninjau dan menyetujui perubahan. Mode Safe
  // Interactive BERJALAN TANPA TINJAUAN, jadi perubahan harus DITOLAK —
  // persis seperti requestCommandApproval() yang sudah fail-closed.
  // Untuk jalan unattended, pakai mode 'auto' (`--permission auto`).
  if (!process.stdin.isTTY) {
    return {
      approved: false,
      message:
        `Modifikasi berkas '${filePath}' ditolak otomatis: mode Safe Interactive memerlukan ` +
        `tinjauan manusia, namun sesi berjalan dalam mode non-TTY. ` +
        `Gunakan '--permission auto' (atau mode 'auto') untuk menjalankan tanpa prompt.`,
    };
  }

  try {
    console.log();
    const actionLabel =
      action === 'write'
        ? 'Menulis berkas'
        : action === 'patch'
          ? 'Menerapkan patch pada'
          : 'Mengedit berkas';
    const statText = diffStats ? ` (${diffStats})` : '';

    if (diff) {
      console.log(chalk.bold(`  📄 Tinjauan Perubahan: ${chalk.cyan(filePath)}${statText}`));
      console.log(diff);
      console.log();
    }

    const answer = await p.confirm({
      message: `${actionLabel} "${filePath}"? Izinkan perubahan ini?`,
      initialValue: true,
    });

    if (p.isCancel(answer) || !answer) {
      return {
        approved: false,
        message: `Modifikasi berkas '${filePath}' dibatalkan oleh pengguna (Safe Mode).`,
      };
    }

    return { approved: true };
  } catch {
    return {
      approved: false,
      message: `Modifikasi berkas '${filePath}' dibatalkan (gagal menampilkan prompt konfirmasi).`,
    };
  }
}
