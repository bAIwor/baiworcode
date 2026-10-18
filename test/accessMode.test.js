import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { getAccessMode, setAccessMode } from '../src/config.js';
import { handleRunCommand } from '../src/tools/handlers.js';
import { setApprovalHandler, resetApprovalHandler } from '../src/tools/approval.js';
import { renderStatusLine } from '../src/statusLine.js';

describe('AccessMode: mode akses normal <-> full', () => {
  const originalMode = getAccessMode();

  after(() => {
    // Kembalikan config pengguna seperti semula, apa pun yang terjadi saat uji.
    setAccessMode(originalMode);
    resetApprovalHandler();
  });

  describe('config: getAccessMode / setAccessMode', () => {
    it('default adalah "normal" bila config belum punya accessMode', () => {
      // Nilai awal config pengguna bisa 'normal' atau 'full'; kedua-duanya valid.
      assert.ok(getAccessMode() === 'normal' || getAccessMode() === 'full');
    });

    it('menyimpan mode "full" dan bertahan saat dibaca ulang', () => {
      setAccessMode('full');
      assert.equal(getAccessMode(), 'full');
      assert.equal(setAccessMode('full'), 'full'); // idempotent
    });

    it('nilai tidak valid selalu jatuh ke "normal" (fail-safe)', () => {
      setAccessMode('yolo');
      assert.equal(getAccessMode(), 'normal');
      setAccessMode(undefined);
      assert.equal(getAccessMode(), 'normal');
      setAccessMode('');
      assert.equal(getAccessMode(), 'normal');
    });
  });

  describe('statusLine: label akses dinamis', () => {
    it('menampilkan "Full access" saat mode full dan "Safe" saat normal', () => {
      setAccessMode('full');
      const full = renderStatusLine({ maxWidth: 120 });
      assert.match(full, /Full access/);

      setAccessMode('normal');
      const safe = renderStatusLine({ maxWidth: 120 });
      assert.match(safe, /Safe/);
      assert.doesNotMatch(safe, /Full access/);
    });
  });

  describe('handlers: gerbang approval menghormati mode akses', () => {
    // 'git push --flag-palsu' digunakan agar command masuk kelas confirm
    // (menyentuh aturan /git push/) TETAPI selalu gagal cepat secara lokal
    // (flag tidak dikenal, exit 128) — tidak pernah menyentuh remote/network.
    const harmlessConfirmCommand = 'git push --flag-palsu';

    it('mode full + TTY: kelas confirm langsung dieksekusi tanpa handler', async () => {
      setAccessMode('full');

      let handlerCalled = false;
      setApprovalHandler(async () => {
        handlerCalled = true;
        return { approved: true };
      });

      const res = await handleRunCommand(
        { command: harmlessConfirmCommand },
        { tty: true } // injeksi TTY untuk pengujian
      );
      assert.equal(handlerCalled, false, 'approval handler tidak boleh dipanggil di mode full');
      // Command benar-benar dieksekusi (bukan dibatalkan gerbang).
      assert.doesNotMatch(res.output, /dibatalkan oleh pengguna/i);
    });

    it('mode full tetap lewat gerbang approval bila bukan TTY', async () => {
      setAccessMode('full');
      setApprovalHandler(async () => ({ approved: false, message: 'Diblokir oleh gerbang.' }));

      const res = await handleRunCommand(
        { command: harmlessConfirmCommand },
        { tty: false }
      );
      assert.equal(res.success, false);
      assert.match(res.output, /Diblokir oleh gerbang/);
      // Handler benar-benar dipanggil — non-TTY tidak boleh skip gerbang HITL.
    });

    it('mode normal tetap lewat gerbang approval meski di TTY', async () => {
      setAccessMode('normal');

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

    it('deny (perintah destruktif) tidak pernah lolos apa pun mode-nya', async () => {
      setApprovalHandler(async () => ({ approved: true }));

      setAccessMode('full');
      const deniedFull = await handleRunCommand({ command: 'format c:' }, { tty: true });
      assert.equal(deniedFull.success, false);
      assert.match(deniedFull.output, /Ditolak oleh sandbox/i);

      setAccessMode('normal');
      const deniedNormal = await handleRunCommand({ command: 'format c:' }, { tty: true });
      assert.equal(deniedNormal.success, false);
      assert.match(deniedNormal.output, /Ditolak oleh sandbox/i);
    });
  });
});
