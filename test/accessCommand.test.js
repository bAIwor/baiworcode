import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getAccessMode, setAccessMode, clearConfigCache } from '../src/config.js';
import { COMMANDS, SUBCOMMANDS } from '../src/prompt.js';
import {
  accessModeLabel,
  accessModeOptions,
  describeAccessMode,
  parseAccessModeArg,
} from '../src/chat/accessMode.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO_ROOT, 'bin', 'baiwor.js');

const ANSI = /\x1b\[[0-9;]*m/g;
const polos = (s) => s.replace(ANSI, '');

describe('Perintah /access: ganti mode izin tanpa hafal Shift+Tab', () => {
  const originalMode = getAccessMode();

  after(() => {
    // Berapa pun yang dilakukan pengujian, config pengguna harus kembali seperti semula.
    setAccessMode(originalMode);
  });

  describe('terdaftar di menu "/" dan panduan', () => {
    it('/access ada di COMMANDS dengan deskripsi', () => {
      const entry = COMMANDS.find((c) => c.name === '/access');
      assert.ok(entry, 'perintah /access harus muncul di menu "/"');
      assert.ok(entry.desc && entry.desc.length > 0);
      assert.match(entry.desc, /Safe/);
      assert.match(entry.desc, /Full access/);
    });

    it('punya subperintah safe & full supaya bisa dipilih dari menu', () => {
      const subs = SUBCOMMANDS['/access'];
      assert.ok(Array.isArray(subs) && subs.length >= 2);
      const names = subs.map((s) => s.name);
      assert.ok(names.includes('safe'));
      assert.ok(names.includes('full'));
      for (const s of subs) assert.ok(s.desc && s.desc.length > 0);
    });
  });

  describe('parseAccessModeArg menerima sinonim dan menolak yang ngawur', () => {
    it('sinonim mode aman -> normal', () => {
      for (const v of ['safe', 'normal', 'aman', 'biasa', 'SAFE', ' safe ']) {
        assert.equal(parseAccessModeArg(v), 'normal', `"${v}" harus jadi normal`);
      }
    });

    it('sinonim mode penuh -> full', () => {
      for (const v of ['full', 'penuh', 'full-access', 'fullaccess', 'FULL']) {
        assert.equal(parseAccessModeArg(v), 'full', `"${v}" harus jadi full`);
      }
    });

    it('argumen kosong atau tidak dikenal -> null (bukan tebakan diam-diam)', () => {
      for (const v of ['', '   ', null, undefined, 'yolo', 'full2', 'alwais']) {
        assert.equal(parseAccessModeArg(v), null);
      }
    });
  });

  describe('label & pilihan menu', () => {
    it('label mengikuti gaya status line', () => {
      assert.equal(accessModeLabel('full'), 'Full access');
      assert.equal(accessModeLabel('normal'), 'Safe');
      assert.equal(accessModeLabel('apa saja'), 'Safe');
    });

    it('setiap mode punya penjelasan singkat', () => {
      assert.match(describeAccessMode('full'), /confirm/);
      assert.match(describeAccessMode('normal'), /persetujuan/);
    });

    it('menu menandai mode yang sedang aktif', () => {
      const opts = accessModeOptions('full');
      assert.equal(opts.length, 2);
      assert.match(opts.find((o) => o.value === 'full').label, /aktif/);
      assert.doesNotMatch(opts.find((o) => o.value === 'normal').label, /aktif/);
      for (const o of opts) assert.ok(o.hint && o.hint.length > 0);
    });
  });

  describe('integrasi CLI: /access, /akses, dan /mode', () => {
    // Satu perintah per pemanggilan: stdin yang dipipe hanya terkirim ke prompt
    // pertama, jadi beberapa perintah dalam satu proses tidak dapat diuji.
    const jalankan = (perintah) =>
      polos(
        execFileSync(process.execPath, [BIN], {
          input: `${perintah}\n`,
          encoding: 'utf8',
          timeout: 30_000,
          env: { ...process.env, FORCE_COLOR: '0' },
        })
      );

    it('/access full benar-benar menyetel mode ke full', () => {
      const out = jalankan('/access full');
      assert.match(out, /Mode izin perintah: Full access/);
      assert.match(out, /Shift\+Tab/);
      clearConfigCache();
      assert.equal(getAccessMode(), 'full');
    });

    it('alias /akses dan /mode menuju peralihan yang sama', () => {
      const viaAlias = jalankan('/akses penuh');
      assert.match(viaAlias, /Mode izin perintah: Full access/);

      const viaMode = jalankan('/mode aman');
      assert.match(viaMode, /Mode izin perintah: Safe/);
      clearConfigCache();
      assert.equal(getAccessMode(), 'normal');
    });

    it('mode tak dikenal ditolak tanpa mengubah apa pun', () => {
      clearConfigCache();
      const sebelum = getAccessMode();
      const out = jalankan('/access ngawur');
      assert.match(out, /Mode "ngawur" tidak dikenal/);
      clearConfigCache();
      assert.equal(getAccessMode(), sebelum);
    });
  });
});
