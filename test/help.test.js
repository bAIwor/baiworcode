import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO_ROOT, 'bin', 'baiwor.js');

const ANSI = /\x1b\[[0-9;]*m/;

function run(args, { color } = {}) {
  const env = { ...process.env };
  delete env.NO_COLOR;
  if (color === undefined) delete env.FORCE_COLOR;
  else env.FORCE_COLOR = color ? '1' : '0';

  return execFileSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env,
    timeout: 30_000,
  });
}

describe('CLI --help berwarna', () => {
  it('menampilkan header, judul bagian, dan daftar perintah', () => {
    const out = run(['--help'], { color: false });
    assert.match(out, /bAIwor Code/);
    assert.match(out, /USAGE/);
    assert.match(out, /ARGUMENTS/);
    assert.match(out, /OPTIONS/);
    assert.match(out, /COMMANDS/);
    assert.match(out, /status/);
    assert.match(out, /login/);
    assert.match(out, /CONTOH CEPAT/);
  });

  it('berwarna saat warna didukung (FORCE_COLOR=1)', () => {
    const out = run(['--help'], { color: true });
    assert.ok(ANSI.test(out), 'help harus memuat escape ANSI saat warna aktif');
  });

  it('tetap polos saat warna dimatikan (FORCE_COLOR=0)', () => {
    const out = run(['--help'], { color: false });
    assert.equal(ANSI.test(out), false, 'help tidak boleh memuat escape ANSI saat warna mati');
  });

  it('help subcommand bergaya tetapi tanpa header/footer utama', () => {
    const out = run(['status', '--help'], { color: false });
    assert.match(out, /USAGE/);
    assert.match(out, /status/);
    assert.equal(out.includes('CONTOH CEPAT'), false, 'footer brand tidak boleh muncul di help subcommand');
  });

  it('--version tetap mencetak nomor versi', () => {
    const out = run(['--version'], { color: false }).trim();
    assert.match(out, /^\d+\.\d+\.\d+/);
  });
});
