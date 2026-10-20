#!/usr/bin/env node

/**
 * Runner test lintas platform.
 *
 * `node --test test/*.test.js` bergantung pada shell yang meng-expand glob
 * (cmd.exe tidak melakukannya), sedangkan `node --test test` tidak konsisten
 * antar versi Node. Runner ini menemukan berkas test secara eksplisit lalu
 * memanggil `node --test <files...>` dengan argv array.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDir = fileURLToPath(new URL('../test', import.meta.url));
const files = fs
  .readdirSync(testDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
  .map((entry) => path.join(testDir, entry.name))
  .sort();

if (files.length === 0) {
  console.error('Tidak ada berkas test/*.test.js yang ditemukan.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: path.resolve(testDir, '..'),
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
