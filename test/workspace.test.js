import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  resolveWorkspace,
  switchWorkspace,
  extractTargetAndPrompt,
  getWorkspaceInfo,
} from '../src/workspace.js';
import { COMMANDS } from '../src/prompt.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO_ROOT, 'bin', 'baiwor.js');
const ANSI = /\x1b\[[0-9;]*m/g;
const polos = (s) => s.replace(ANSI, '');

describe('Workspace: Pengelolaan Ruang Kerja', () => {
  describe('resolveWorkspace', () => {
    it('harus memvalidasi direktori yang sah dan mengembalikan path absolut', () => {
      const res = resolveWorkspace('src', REPO_ROOT);
      assert.equal(res.ok, true);
      assert.equal(res.path, path.join(REPO_ROOT, 'src'));
    });

    it('harus menolak direktori yang tidak ada', () => {
      const res = resolveWorkspace('folder_fiktif_12345', REPO_ROOT);
      assert.equal(res.ok, false);
      assert.match(res.error, /Direktori tidak ditemukan/);
    });

    it('harus menolak berkas biasa (bukan direktori)', () => {
      const res = resolveWorkspace('package.json', REPO_ROOT);
      assert.equal(res.ok, false);
      assert.match(res.error, /bukan sebuah direktori/);
    });

    it('harus menolak input kosong atau null', () => {
      assert.equal(resolveWorkspace('').ok, false);
      assert.equal(resolveWorkspace('   ').ok, false);
      assert.equal(resolveWorkspace(null).ok, false);
      assert.equal(resolveWorkspace(undefined).ok, false);
    });

    it('harus mendukung ekspansi tilde (~)', () => {
      const res = resolveWorkspace('~');
      assert.equal(res.ok, true);
      assert.equal(res.path.toLowerCase(), os.homedir().toLowerCase());
    });
  });

  describe('switchWorkspace', () => {
    it('harus berpindah ke direktori yang valid dan dapat kembali', () => {
      const awal = process.cwd();
      const target = path.join(REPO_ROOT, 'src');

      const res = switchWorkspace(target);
      assert.equal(res.ok, true);
      assert.equal(process.cwd().toLowerCase(), target.toLowerCase());

      // Kembalikan ke awal
      const pulih = switchWorkspace(awal);
      assert.equal(pulih.ok, true);
      assert.equal(process.cwd().toLowerCase(), awal.toLowerCase());
    });

    it('harus gagal dan tidak mengubah cwd jika direktori tujuan invalid', () => {
      const awal = process.cwd();
      const res = switchWorkspace('folder_fiktif_tidak_ada_xyz');
      assert.equal(res.ok, false);
      assert.equal(process.cwd(), awal);
    });
  });

  describe('extractTargetAndPrompt', () => {
    it('harus memprioritaskan opsi eksplisit options.cwd atau options.dir', () => {
      const res = extractTargetAndPrompt(['jelaskan', 'kode'], { cwd: './src' }, REPO_ROOT);
      assert.equal(res.targetDir, './src');
      assert.equal(res.prompt, 'jelaskan kode');
    });

    it('harus mengenali argumen posisi pertama jika berupa direktori sah di disk', () => {
      const res = extractTargetAndPrompt(['src', 'analisis', 'arsitektur'], {}, REPO_ROOT);
      assert.equal(res.targetDir, 'src');
      assert.equal(res.prompt, 'analisis arsitektur');
    });

    it('harus menangani argumen posisi direktori tunggal tanpa prompt', () => {
      const res = extractTargetAndPrompt(['src'], {}, REPO_ROOT);
      assert.equal(res.targetDir, 'src');
      assert.equal(res.prompt, '');
    });

    it('harus menganggap prompt biasa jika argumen pertama bukan direktori', () => {
      const res = extractTargetAndPrompt(['buatkan', 'fungsi', 'auth'], {}, REPO_ROOT);
      assert.equal(res.targetDir, null);
      assert.equal(res.prompt, 'buatkan fungsi auth');
    });
  });

  describe('getWorkspaceInfo', () => {
    it('harus mengembalikan info cwd, isHome, dan sessionCount', () => {
      const info = getWorkspaceInfo(REPO_ROOT);
      assert.equal(info.cwd.toLowerCase(), REPO_ROOT.toLowerCase());
      assert.equal(typeof info.isHome, 'boolean');
      assert.equal(typeof info.sessionCount, 'number');
    });
  });

  describe('Integrasi Perintah & CLI', () => {
    it('/cd dan /workspace harus terdaftar di COMMANDS', () => {
      const cdCmd = COMMANDS.find((c) => c.name === '/cd');
      const wsCmd = COMMANDS.find((c) => c.name === '/workspace');
      assert.ok(cdCmd, 'perintah /cd harus ada');
      assert.ok(wsCmd, 'perintah /workspace harus ada');
      assert.ok(cdCmd.desc.includes('workspace') || cdCmd.desc.includes('folder'));
      assert.ok(wsCmd.desc.includes('workspace') || wsCmd.desc.includes('folder'));
    });

    it('CLI harus menolak opsi -C dengan direktori tidak ada dan keluar dengan code 1', () => {
      assert.throws(
        () => {
          execFileSync(process.execPath, [BIN, '-C', 'folder_ngawur_palsu_999'], {
            encoding: 'utf8',
            stdio: 'pipe',
          });
        },
        (err) => {
          assert.equal(err.status, 1);
          assert.match(polos(err.stderr || err.stdout || ''), /Direktori tidak ditemukan/);
          return true;
        }
      );
    });

    it('CLI --help harus memuat opsi -C dan --cwd', () => {
      const out = polos(
        execFileSync(process.execPath, [BIN, '--help'], {
          encoding: 'utf8',
        })
      );
      assert.match(out, /-C,\s+--cwd/);
      assert.match(out, /-d,\s+--dir/);
    });

    it('CLI bcode <folder> harus membuka workspace di folder tersebut', () => {
      const out = polos(
        execFileSync(process.execPath, [BIN, 'src'], {
          input: '/q\n',
          encoding: 'utf8',
          timeout: 90_000,
        })
      );
      assert.match(out, /Folder Aktif\s+:\s+.*src/i);
    });

    it('perintah /workspace di dalam sesi harus mencetak workspace aktif', () => {
      const out = polos(
        execFileSync(process.execPath, [BIN], {
          input: '/workspace\n/q\n',
          encoding: 'utf8',
          timeout: 90_000,
        })
      );
      assert.match(out, /Workspace Aktif:/);
    });

    it('perintah /cd <path> di dalam sesi harus memindahkan workspace', () => {
      const out = polos(
        execFileSync(process.execPath, [BIN], {
          input: '/cd src\n/q\n',
          encoding: 'utf8',
          timeout: 90_000,
        })
      );
      assert.match(out, /Workspace aktif berpindah ke:.*src/i);
    });
  });
});

