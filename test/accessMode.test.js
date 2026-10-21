import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPermissionMode,
  setPermissionMode,
  getAccessMode,
  getAgentMode,
} from '../src/config.js';
import { handleRunCommand } from '../src/tools/handlers.js';
import { setApprovalHandler, resetApprovalHandler } from '../src/tools/approval.js';
import { renderStatusLine } from '../src/statusLine.js';

describe('PermissionMode: safe <-> auto <-> plan <-> yolo', () => {
  const originalMode = getPermissionMode();

  after(() => {
    // Kembalikan config pengguna seperti semula, apa pun yang terjadi saat uji.
    setPermissionMode(originalMode);
    resetApprovalHandler();
  });

  describe('config: getPermissionMode / setPermissionMode', () => {
    it('selalu mengembalikan salah satu dari empat mode', () => {
      assert.ok(['safe', 'auto', 'plan', 'yolo'].includes(getPermissionMode()));
    });

    it('menyimpan mode "auto" dan bertahan saat dibaca ulang', () => {
      setPermissionMode('auto');
      assert.equal(getPermissionMode(), 'auto');
      assert.equal(setPermissionMode('auto'), 'auto'); // idempotent
    });

    it('nilai tidak valid selalu jatuh ke "safe" (fail-safe)', () => {
      setPermissionMode('yolo');
      setPermissionMode('ngawur');
      assert.equal(getPermissionMode(), 'safe');
      setPermissionMode(undefined);
      assert.equal(getPermissionMode(), 'safe');
    });

    it('getter lama memetakan dari permissionMode (compat)', () => {
      setPermissionMode('yolo');
      assert.equal(getAccessMode(), 'full');
      assert.equal(getAgentMode(), 'build');
      setPermissionMode('plan');
      assert.equal(getAccessMode(), 'normal');
      assert.equal(getAgentMode(), 'plan');
      setPermissionMode('safe');
      assert.equal(getAccessMode(), 'normal');
      assert.equal(getAgentMode(), 'build');
    });
  });

  describe('statusLine: satu label mode izin', () => {
    it('menampilkan label yang benar untuk tiap mode', () => {
      setPermissionMode('yolo');
      assert.match(renderStatusLine({ maxWidth: 120 }), /YOLO/);
      setPermissionMode('auto');
      assert.match(renderStatusLine({ maxWidth: 120 }), /Auto/);
      setPermissionMode('plan');
      assert.match(renderStatusLine({ maxWidth: 120 }), /Plan/);
      setPermissionMode('safe');
      const safe = renderStatusLine({ maxWidth: 120 });
      assert.match(safe, /Safe/);
      assert.doesNotMatch(safe, /Full access|YOLO|Build/);
    });

    it('tidak lagi menampilkan dua label terpisah (Build + akses)', () => {
      setPermissionMode('safe');
      const line = renderStatusLine({ maxWidth: 140 });
      assert.doesNotMatch(line, /Build\s+│/);
    });
  });

  describe('handlers: gerbang approval menghormati mode izin', () => {
    // 'git push --flag-palsu' digunakan agar command masuk kelas confirm
    // (menyentuh aturan /git push/) TETAPI selalu gagal cepat secara lokal
    // (flag tidak dikenal, exit 128) — tidak pernah menyentuh remote/network.
    const harmlessConfirmCommand = 'git push --flag-palsu';

    it('mode yolo + TTY: kelas confirm langsung dieksekusi tanpa handler', async () => {
      setPermissionMode('yolo');

      let handlerCalled = false;
      setApprovalHandler(async () => {
        handlerCalled = true;
        return { approved: true };
      });

      const res = await handleRunCommand(
        { command: harmlessConfirmCommand },
        { tty: true } // injeksi TTY untuk pengujian
      );
      assert.equal(handlerCalled, false, 'approval handler tidak boleh dipanggil di mode yolo');
      // Command benar-benar dieksekusi (bukan dibatalkan gerbang).
      assert.doesNotMatch(res.output, /dibatalkan oleh pengguna/i);
    });

    it('mode yolo tetap lewat gerbang approval bila bukan TTY', async () => {
      setPermissionMode('yolo');
      setApprovalHandler(async () => ({ approved: false, message: 'Diblokir oleh gerbang.' }));

      const res = await handleRunCommand(
        { command: harmlessConfirmCommand },
        { tty: false }
      );
      assert.equal(res.success, false);
      assert.match(res.output, /Diblokir oleh gerbang/);
      // Handler benar-benar dipanggil — non-TTY tidak boleh skip gerbang HITL.
    });

    it('mode safe tetap lewat gerbang approval meski di TTY', async () => {
      setPermissionMode('safe');

      let handlerCalled = false;
      setApprovalHandler(async () => {
        handlerCalled = true;
        return { approved: false, message: 'Perintah dibatalkan oleh pengguna (butuh konfirmasi).' };
      });

      const res = await handleRunCommand({ command: harmlessConfirmCommand }, { tty: true });
      assert.equal(handlerCalled, true);
      assert.equal(res.success, false);
      assert.match(res.output, /dibatalkan oleh pengguna/i);
    });

    it('mode auto: perintah berisiko TETAP bertanya (hanya berkas yang lancar)', async () => {
      setPermissionMode('auto');

      let handlerCalled = false;
      setApprovalHandler(async () => {
        handlerCalled = true;
        return { approved: false, message: 'Perintah dibatalkan oleh pengguna (butuh konfirmasi).' };
      });

      const res = await handleRunCommand({ command: harmlessConfirmCommand }, { tty: true });
      assert.equal(handlerCalled, true, 'mode auto tidak boleh melewati tanya perintah berisiko');
      assert.match(res.output, /dibatalkan oleh pengguna/i);
    });

    it('deny (perintah destruktif) tidak pernah lolos apa pun mode-nya', async () => {
      setApprovalHandler(async () => ({ approved: true }));

      for (const mode of ['yolo', 'auto', 'plan', 'safe']) {
        setPermissionMode(mode);
        const denied = await handleRunCommand({ command: 'format c:' }, { tty: true });
        assert.equal(denied.success, false, `${mode} tidak boleh meloloskan deny`);
        assert.match(denied.output, /Ditolak oleh sandbox/i);
      }
    });
  });
});
