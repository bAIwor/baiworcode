import * as p from '@clack/prompts';
import { sanitizeTerminalText } from '../chat/wrapText.js';

let customApprovalHandler = null;

/**
 * Menyimpan custom handler konfirmasi untuk keperluan pengujian otomatis (mock).
 *
 * @param {Function|null} handler - (command, reason) => Promise<{ approved: boolean, message?: string }>
 */
export function setApprovalHandler(handler) {
  customApprovalHandler = handler;
}

/**
 * Mengembalikan handler konfirmasi ke perilaku standar.
 */
export function resetApprovalHandler() {
  customApprovalHandler = null;
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
