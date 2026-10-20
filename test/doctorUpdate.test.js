import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { COMMANDS, SUBCOMMANDS } from '../src/prompt.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO_ROOT, 'bin', 'baiwor.js');

function run(args, { color = false, timeout = 30_000 } = {}) {
  const env = { ...process.env };
  delete env.NO_COLOR;
  env.FORCE_COLOR = color ? '1' : '0';

  return execFileSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env,
    timeout,
  });
}

describe('Doctor & Update Commands', () => {
  it('COMMANDS dan SUBCOMMANDS harus memuat /doctor dan /update', () => {
    const doctorCmd = COMMANDS.find((c) => c.name === '/doctor');
    const updateCmd = COMMANDS.find((c) => c.name === '/update');
    assert.ok(doctorCmd, '/doctor harus terdaftar di COMMANDS');
    assert.ok(updateCmd, '/update harus terdaftar di COMMANDS');
    assert.ok(SUBCOMMANDS['/update'], '/update harus memiliki entri di SUBCOMMANDS');
    assert.ok(
      SUBCOMMANDS['/update'].some((s) => s.name === 'sandbox'),
      '/update harus memiliki opsi subperintah sandbox'
    );
  });

  it('baiwor --help harus memuat perintah doctor dan update', () => {
    const out = run(['--help'], { color: false });
    assert.match(out, /doctor/);
    assert.match(out, /update/);
  });

  it('baiwor doctor harus berjalan dan menampilkan status kesehatan sistem', () => {
    const out = run(['doctor'], { color: false });
    assert.match(out, /Doctor/);
    assert.match(out, /Lingkungan Runtime & Sistem/);
    assert.match(out, /Node\.js Version/);
    assert.match(out, /Folder Kerja & Workspace/);
    assert.match(out, /Konfigurasi AI & Kredensial/);
    assert.match(out, /Integrasi Cloud & Sandbox/);
    assert.match(out, /Status Sehat|Ditemukan/);
  });

  it('baiwor update harus memeriksa status git lokal', () => {
    let out = '';
    try {
      out = run(['update'], { color: false });
    } catch (err) {
      // Paket tanpa .git (mis. hasil tarball) memang keluar non-zero.
      out = String(err.stdout || '') + String(err.stderr || '');
    }
    assert.match(out, /Pembaruan bAIwor Code/);
    assert.match(
      out,
      /Menghubungi GitHub|sudah pada versi terbaru|Ditemukan pembaruan|tidak dijalankan dari repositori Git/
    );
  });
});
