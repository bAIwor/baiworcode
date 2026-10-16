/**
 * Tool `diagnostics` untuk bAIwor Code.
 *
 * Memberi agen umpan balik mutu sebelum mengklaim pekerjaan selesai: menjalankan
 * pemeriksaan yang memang sudah dimiliki proyek (script npm atau tsc/eslint),
 * lalu mengembalikan hasilnya. Ini mencegah "sudah beres" padahal masih ada
 * galat tipe atau pelanggaran lint.
 *
 * Command yang dijalankan tetap melewati `handleRunCommand`, sehingga sandbox
 * dan approval gate yang sama tetap berlaku.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveSafePath, handleRunCommand } from './handlers.js';

/** Berkas konfigurasi ESLint yang dikenali. */
const ESLINT_CONFIGS = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
];

/**
 * Mendeteksi perintah pemeriksaan mutu yang relevan untuk sebuah proyek.
 *
 * Urutan prioritas:
 *   1. Script agregat `check` pada package.json (bila ada).
 *   2. Script `typecheck`/`type-check`/`types` lalu `lint`.
 *   3. Cadangan: `tsc --noEmit` bila ada tsconfig.json, `eslint .` bila ada konfigurasi ESLint.
 *
 * @param {string} dir Direktori proyek.
 * @param {typeof fs} [fsImpl] Dipakai pengujian untuk menyuntik fs tiruan.
 * @returns {Array<{label:string, command:string}>}
 */
export function detectDiagnosticCommands(dir, fsImpl = fs) {
  const cmds = [];
  const pkgPath = path.join(dir, 'package.json');
  let scripts = {};
  if (fsImpl.existsSync(pkgPath)) {
    try {
      scripts = JSON.parse(fsImpl.readFileSync(pkgPath, 'utf8')).scripts || {};
    } catch {
      scripts = {};
    }
  }
  const hasScript = (n) => typeof scripts[n] === 'string';

  const checkScript = ['check'].find(hasScript);

  if (checkScript) {
    cmds.push({ label: `npm run ${checkScript}`, command: `npm run ${checkScript}` });
    return cmds;
  }

  const typecheckScript = ['typecheck', 'type-check', 'types'].find(hasScript);
  const lintScript = ['lint'].find(hasScript);

  if (typecheckScript) {
    cmds.push({ label: `npm run ${typecheckScript}`, command: `npm run ${typecheckScript}` });
  }
  if (lintScript) {
    cmds.push({ label: `npm run ${lintScript}`, command: `npm run ${lintScript}` });
  }

  if (!typecheckScript && fsImpl.existsSync(path.join(dir, 'tsconfig.json'))) {
    cmds.push({ label: 'tsc --noEmit', command: 'npx --no-install tsc --noEmit' });
  }
  if (!lintScript && ESLINT_CONFIGS.some((c) => fsImpl.existsSync(path.join(dir, c)))) {
    cmds.push({ label: 'eslint .', command: 'npx --no-install eslint .' });
  }

  return cmds;
}

/**
 * Menjalankan pemeriksaan mutu proyek.
 *
 * @param {{path?:string, commands?:string[]}} args
 * @param {{signal?:AbortSignal}} [options]
 * @returns {Promise<{success:boolean, output:string}>}
 */
export async function handleDiagnostics({ path: targetPath = '.', commands } = {}, options = {}) {
  let dir;
  try {
    dir = resolveSafePath(targetPath || '.');
  } catch (err) {
    return { success: false, output: err.message };
  }

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { success: false, output: `Error: Direktori tidak ditemukan: ${targetPath}` };
  }

  let checks;
  if (Array.isArray(commands) && commands.length) {
    checks = commands
      .filter((c) => typeof c === 'string' && c.trim())
      .map((c) => ({ label: c, command: c }));
  } else {
    checks = detectDiagnosticCommands(dir);
  }

  if (!checks.length) {
    return {
      success: true,
      output:
        'Tidak ada pemeriksaan mutu yang terdeteksi (tak ada script lint/typecheck/check di package.json, ' +
        'tsconfig.json, maupun konfigurasi ESLint). Jalankan pengujian lewat run_command bila perlu.',
    };
  }

  const sections = [];
  let allPassed = true;

  for (const { label, command } of checks) {
    const res = await handleRunCommand({ command, cwd: dir }, options);
    if (!res.success) allPassed = false;
    sections.push(`── ${label} ──\n${res.output}`);
  }

  const summary = allPassed
    ? `✓ Semua pemeriksaan lulus (${checks.length}).`
    : `✗ Ada pemeriksaan yang gagal (${checks.length} dijalankan).`;

  return { success: allPassed, output: `${summary}\n\n${sections.join('\n\n')}` };
}
