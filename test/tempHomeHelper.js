/**
 * Bantuan pengujian: "home" sementara.
 *
 * bAIwor Code menyimpan config di `<home>/.baiwor/config.json` dan tidak punya
 * override lewat environment. Agar pengujian CLI tidak pernah menulis ke config
 * pengguna asli (apalagi saat tes berjalan paralel), setiap proses anak diberi
 * USERPROFILE/HOME sementara dan hasilnya dibaca dari folder itu.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Membuat direktori home sementara yang masih kosong. */
export function buatHomeSementara() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-home-'));
  fs.mkdirSync(path.join(dir, '.baiwor'), { recursive: true });
  return dir;
}

/** Environment untuk proses anak yang memakai `home` sebagai direktori pengguna. */
export function envHome(home, extra = {}) {
  return { ...process.env, USERPROFILE: home, HOME: home, FORCE_COLOR: '0', ...extra };
}

/** Membaca config dari home sementara (null bila belum ada). */
export function bacaConfig(home) {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, '.baiwor', 'config.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Menulis config awal ke home sementara (dipakai untuk menguji kondisi tertentu). */
export function tulisConfig(home, config) {
  fs.mkdirSync(path.join(home, '.baiwor'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.baiwor', 'config.json'),
    JSON.stringify(config, null, 2),
    'utf8'
  );
}

/** Menghapus home sementara beserta isinya. */
export function hapusHome(home) {
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    // best effort
  }
}
