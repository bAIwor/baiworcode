import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { COMMANDS, SUBCOMMANDS } from '../src/prompt.js';
import {
  PERMISSION_MODES,
  permissionModeLabel,
  permissionModeOptions,
  describePermissionMode,
  parsePermissionModeArg,
  nextPermissionMode,
} from '../src/chat/permissionMode.js';
import {
  bacaConfig,
  buatHomeSementara,
  envHome,
  hapusHome,
} from './tempHomeHelper.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO_ROOT, 'bin', 'baiwor.js');

const ANSI = /\x1b\[[0-9;]*m/g;
const polos = (s) => s.replace(ANSI, '');

describe('Perintah /permission: satu konsep untuk empat mode izin', () => {

  describe('terdaftar di menu "/" dan panduan', () => {
    it('/permission ada di COMMANDS dengan deskripsi', () => {
      const entry = COMMANDS.find((c) => c.name === '/permission');
      assert.ok(entry, 'perintah /permission harus muncul di menu "/"');
      assert.ok(entry.desc && entry.desc.length > 0);
      assert.match(entry.desc, /safe/i);
      assert.match(entry.desc, /auto/i);
      assert.match(entry.desc, /plan/i);
      assert.match(entry.desc, /yolo/i);
    });

    it('punya empat subperintah supaya bisa dipilih dari menu', () => {
      const subs = SUBCOMMANDS['/permission'];
      assert.ok(Array.isArray(subs) && subs.length === 4);
      const names = subs.map((s) => s.name);
      for (const m of ['safe', 'auto', 'plan', 'yolo']) assert.ok(names.includes(m));
      for (const s of subs) assert.ok(s.desc && s.desc.length > 0);
    });
  });

  describe('parsePermissionModeArg menerima sinonim dan menolak yang ngawur', () => {
    it('sinonim mode aman -> safe', () => {
      for (const v of ['safe', 'aman', 'normal', 'biasa', 'SAFE', ' safe ']) {
        assert.equal(parsePermissionModeArg(v), 'safe', `"${v}" harus jadi safe`);
      }
    });

    it('sinonim mode otomatis -> auto', () => {
      for (const v of ['auto', 'otomatis', 'AUTO', 'semi']) {
        assert.equal(parsePermissionModeArg(v), 'auto', `"${v}" harus jadi auto`);
      }
    });

    it('sinonim mode arsitek -> plan', () => {
      for (const v of ['plan', 'rencana', 'arsitek', 'read-only', 'PLAN']) {
        assert.equal(parsePermissionModeArg(v), 'plan', `"${v}" harus jadi plan`);
      }
    });

    it('sinonim mode penuh -> yolo', () => {
      for (const v of ['yolo', 'full', 'penuh', 'full-access', 'YOLO']) {
        assert.equal(parsePermissionModeArg(v), 'yolo', `"${v}" harus jadi yolo`);
      }
    });

    it('argumen kosong atau tidak dikenal -> null (bukan tebakan diam-diam)', () => {
      for (const v of ['', '   ', null, undefined, 'ngawur', 'alwais']) {
        assert.equal(parsePermissionModeArg(v), null);
      }
    });
  });

  describe('label, penjelasan, dan siklus', () => {
    it('label mengikuti gaya status line', () => {
      assert.equal(permissionModeLabel('safe'), 'Safe');
      assert.equal(permissionModeLabel('auto'), 'Auto');
      assert.equal(permissionModeLabel('plan'), 'Plan');
      assert.equal(permissionModeLabel('yolo'), 'YOLO');
      assert.equal(permissionModeLabel('apa saja'), 'Safe');
    });

    it('setiap mode punya penjelasan singkat', () => {
      assert.match(describePermissionMode('safe'), /persetujuan/);
      assert.match(describePermissionMode('auto'), /berkas/);
      assert.match(describePermissionMode('plan'), /read-only/);
      assert.match(describePermissionMode('yolo'), /deny/);
    });

    it('Shift+Tab siklus: safe -> auto -> plan -> yolo -> safe', () => {
      assert.equal(nextPermissionMode('safe'), 'auto');
      assert.equal(nextPermissionMode('auto'), 'plan');
      assert.equal(nextPermissionMode('plan'), 'yolo');
      assert.equal(nextPermissionMode('yolo'), 'safe');
      assert.equal(nextPermissionMode('tidak-valid'), 'safe');
    });

    it('menu menandai mode yang sedang aktif', () => {
      const opts = permissionModeOptions('yolo');
      assert.equal(opts.length, 4);
      assert.match(opts.find((o) => o.value === 'yolo').label, /aktif/);
      assert.doesNotMatch(opts.find((o) => o.value === 'safe').label, /aktif/);
      for (const o of opts) assert.ok(o.hint && o.hint.length > 0);
    });
  });

  describe('integrasi CLI: /permission + alias lama', () => {
    // Satu perintah per pemanggilan: stdin yang dipipe hanya terkirim ke prompt
    // pertama, jadi beberapa perintah dalam satu proses tidak dapat diuji.
    // Setiap proses anak memakai home sementara supaya config pengguna asli
    // tidak pernah tersentuh, bahkan saat berkas tes lain berjalan paralel.
    const jalankan = (perintah) => {
      const home = buatHomeSementara();
      try {
        const out = polos(
          execFileSync(process.execPath, [BIN], {
            input: `${perintah}\n`,
            encoding: 'utf8',
            timeout: 90_000,
            env: envHome(home),
          })
        );
        return { out, config: bacaConfig(home) };
      } finally {
        hapusHome(home);
      }
    };

    it('/permission yolo benar-benar menyetel mode ke yolo', () => {
      const { out, config } = jalankan('/permission yolo');
      assert.match(out, /Mode izin aktif: YOLO/);
      assert.equal(config?.permissionMode, 'yolo', 'config harus menyimpan permissionMode: "yolo"');
    });

    it('/permission auto menyetel mode auto', () => {
      const { out, config } = jalankan('/permission auto');
      assert.match(out, /Mode izin aktif: Auto/);
      assert.equal(config?.permissionMode, 'auto');
    });

    it('alias /access full & sinonim lama tetap berfungsi', () => {
      const viaAlias = jalankan('/access penuh');
      assert.match(viaAlias.out, /Mode izin aktif: YOLO/);
      assert.equal(viaAlias.config?.permissionMode, 'yolo');

      const viaMode = jalankan('/mode aman');
      assert.match(viaMode.out, /Mode izin aktif: Safe/);
      assert.equal(viaMode.config?.permissionMode, 'safe');
    });

    it('/permission plan dan /permission safe via satu pintu handler', () => {
      const nyala = jalankan('/permission plan');
      assert.match(nyala.out, /Mode izin aktif: Plan/);
      assert.equal(nyala.config?.permissionMode, 'plan');

      const mati = jalankan('/permission safe');
      assert.match(mati.out, /Mode izin aktif: Safe/);
      assert.equal(mati.config?.permissionMode, 'safe');
    });

    it('mode tak dikenal ditolak tanpa mengubah apa pun', () => {
      const { out, config } = jalankan('/permission ngawur');
      assert.match(out, /Mode "ngawur" tidak dikenal/);
      // Config awal home sementara memakai default 'safe' — harus tetap begitu.
      assert.equal(config?.permissionMode ?? 'safe', 'safe');
    });
  });
});
