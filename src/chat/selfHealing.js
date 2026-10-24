import path from 'node:path';
import fs from 'node:fs';
import { handleDiagnostics, detectDiagnosticCommands } from '../tools/diagnosticsTool.js';

/**
 * Self-Healing Diagnostics Loop untuk bAIwor Code.
 *
 * Setelah model selesai memanggil tool modifikasi berkas (write_file, edit_file,
 * patch_file), modul ini menjalankan pemeriksaan diagnostik otomatis pada
 * proyek yang tersentuh. Jika ada error, model diberi kesempatan untuk
 * auto-repair (maksimal 2x retry) sebelum memperingatkan pengguna.
 *
 * Arsitektur:
 *   1. Kumpulkan berkas yang dimodifikasi dalam turn ini.
 *   2. Tentukan direktori proyek (common ancestor).
 *   3. Jalankan diagnostik (lint/typecheck) via handleDiagnostics.
 *   4. Jika lulus: lanjut ke final answer.
 *   5. Jika gagal dan retry < 2: inject error context, minta model memperbaiki.
 *   6. Jika gagal dan retry >= 2: fallback ke final answer dengan peringatan.
 */

/**
 * Menentukan direktori proyek dari daftar berkas yang dimodifikasi.
 * Berjalan ke atas dari common ancestor hingga menemukan package.json atau mencapai cwd.
 *
 * @param {string[]} filePaths - Daftar path berkas yang dimodifikasi.
 * @param {string} [cwd=process.cwd()] - Working directory saat ini.
 * @returns {string} Path direktori proyek.
 */
export function findProjectRoot(filePaths, cwd = process.cwd()) {
  if (!filePaths || filePaths.length === 0) return cwd;

  const absolutePaths = filePaths.map((p) => path.resolve(cwd, p));
  let startDir;

  if (absolutePaths.length === 1) {
    startDir = path.dirname(absolutePaths[0]);
  } else {
    // Cari common ancestor directory
    const splitPaths = absolutePaths.map((p) => p.split(path.sep));
    const minLength = Math.min(...splitPaths.map((parts) => parts.length));

    let commonIndex = 0;
    for (let i = 0; i < minLength; i++) {
      const segment = splitPaths[0][i];
      if (splitPaths.every((parts) => parts[i] === segment)) {
        commonIndex = i;
      } else {
        break;
      }
    }

    const commonRoot = splitPaths[0].slice(0, commonIndex + 1).join(path.sep) || path.sep;
    startDir = fs.existsSync(commonRoot) && fs.statSync(commonRoot).isDirectory()
      ? commonRoot
      : path.dirname(absolutePaths[0]);
  }

  // Berjalan ke atas hingga menemukan package.json atau mencapai cwd
  let current = startDir;
  const resolvedCwd = path.resolve(cwd);

  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    // Berhenti jika sudah mencapai atau melampaui cwd
    if (current === resolvedCwd || !current.startsWith(resolvedCwd)) {
      break;
    }
    const parent = path.dirname(current);
    // Berhenti jika sudah mencapai root filesystem
    if (parent === current) break;
    current = parent;
  }

  // Jika tidak menemukan package.json, kembalikan startDir
  return startDir;
}

/**
 * Menjalankan diagnostik otomatis pada proyek yang tersentuh.
 *
 * @param {string[]} modifiedFiles - Daftar berkas yang dimodifikasi dalam turn ini.
 * @param {{cwd?: string, signal?: AbortSignal}} [options]
 * @returns {Promise<{passed: boolean, output: string, errors: string[], projectRoot: string}>}
 */
export async function runSelfHealingDiagnostics(modifiedFiles, options = {}) {
  const cwd = options.cwd || process.cwd();
  const projectRoot = findProjectRoot(modifiedFiles, cwd);

  // Cek apakah ada perintah diagnostik cepat yang tersedia (lint/typecheck).
  // Jangan jalankan script agregat berat (npm run check / npm test) secara otomatis.
  const commands = detectDiagnosticCommands(projectRoot, fs, { fastOnly: true });
  if (commands.length === 0) {
    return {
      passed: true,
      output: 'Tidak ada pemeriksaan diagnostik cepat yang terdeteksi (tidak ada script lint/typecheck).',
      errors: [],
      projectRoot,
    };
  }

  // Jalankan diagnostik
  const result = await handleDiagnostics(
    { path: projectRoot, commands: commands.map((c) => c.command) },
    { signal: options.signal }
  );

  // Parse output untuk mengekstrak error
  const errors = [];
  if (!result.success) {
    // Ekstrak baris error dari output
    const lines = result.output.split('\n');
    for (const line of lines) {
      // Deteksi pola error umum (eslint, tsc, npm run check)
      if (
        line.includes('error') ||
        line.includes('Error') ||
        line.includes('✖') ||
        line.includes('failed') ||
        line.includes('FAILED')
      ) {
        errors.push(line.trim());
      }
    }
  }

  return {
    passed: result.success,
    output: result.output,
    errors,
    projectRoot,
  };
}

/**
 * Membangun pesan injeksi untuk meminta model melakukan auto-repair.
 *
 * @param {number} retryCount - Jumlah retry yang sudah dilakukan (0-based).
 * @param {string} diagnosticOutput - Output dari diagnostik yang gagal.
 * @param {string[]} errors - Daftar error yang diekstrak.
 * @returns {string} Pesan untuk model.
 */
export function buildAutoRepairPrompt(retryCount, diagnosticOutput, errors) {
  const retryNum = retryCount + 1;
  const errorList = errors.length > 0 ? errors.slice(0, 10).join('\n  - ') : '(tidak ada error spesifik yang terdeteksi)';

  return `<self-healing-diagnostic-failure>
Pemeriksaan diagnostik otomatis gagal (retry ${retryNum}/2).

Error yang ditemukan:
  - ${errorList}

Output diagnostik lengkap:
${diagnosticOutput}

Tugas Anda:
1. Analisis error di atas dan identifikasi berkas mana yang menyebabkan kegagalan.
2. Perbaiki error tersebut menggunakan tool edit_file atau patch_file.
3. Setelah perbaikan, sistem akan menjalankan diagnostik ulang secara otomatis.

Jelaskan secara singkat apa error yang terjadi dan berkas apa yang Anda perbaiki kepada pengguna.
</self-healing-diagnostic-failure>`;
}

/**
 * Membangun pesan peringatan untuk fallback ketika auto-repair gagal setelah 2x retry.
 *
 * @param {string} diagnosticOutput - Output dari diagnostik yang gagal.
 * @param {string[]} errors - Daftar error yang diekstrak.
 * @returns {string} Pesan peringatan untuk pengguna.
 */
export function buildDiagnosticWarningMessage(diagnosticOutput, errors) {
  const errorList = errors.length > 0 ? errors.slice(0, 5).join('\n  • ') : '(tidak ada error spesifik yang terdeteksi)';

  return `⚠️  **Peringatan Diagnostik**

Pemeriksaan otomatis menemukan error yang tidak bisa diperbaiki secara otomatis setelah 2x retry:

  • ${errorList}

Output diagnostik:
${diagnosticOutput}

Silakan periksa dan perbaiki manual, atau jalankan perintah diagnostik secara eksplisit.`;
}
