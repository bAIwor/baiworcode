import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleInstaboxExec,
  getInstaboxStatus,
  controlInstabox,
  openInstaboxDesktop,
  captureInstaboxScreenshot,
  INSTABOX_API_ENDPOINT,
} from '../src/tools/instaboxTool.js';
import {
  getInstaboxApiKey,
  setInstaboxApiKey,
  getInstaboxMachineId,
  setInstaboxMachineId,
} from '../src/config.js';
import { Sandbox } from '@insforge/instabox-sdk';

describe('InstaBox Cloud Sandbox Tool', () => {
  let originalKey;
  let originalMachine;

  before(() => {
    originalKey = getInstaboxApiKey();
    originalMachine = getInstaboxMachineId();
  });

  after(() => {
    setInstaboxApiKey(originalKey);
    setInstaboxMachineId(originalMachine);
  });

  describe('handleInstaboxExec: Validasi Argumen & Konfigurasi', () => {
    it('harus gagal bila API key belum disetel', async () => {
      setInstaboxApiKey('');
      const res = await handleInstaboxExec({ command: 'uptime' });
      assert.equal(res.success, false);
      assert.match(res.output, /API Key InstaBox belum dikonfigurasi/);
    });

    it('harus gagal bila command kosong atau hanya spasi', async () => {
      setInstaboxApiKey('ibk_test_dummy_key');
      const res1 = await handleInstaboxExec({ command: '' });
      assert.equal(res1.success, false);
      assert.match(res1.output, /Parameter command tidak boleh kosong/);

      const res2 = await handleInstaboxExec({ command: '   ' });
      assert.equal(res2.success, false);
      assert.match(res2.output, /Parameter command tidak boleh kosong/);
    });
  });

  describe('handleInstaboxExec: Mock Eksekusi', () => {
    it('harus mengeksekusi perintah shell dan memformat output berhasil', async () => {
      setInstaboxApiKey('ibk_mock_key');
      setInstaboxMachineId('m_mock_machine');

      const origConnect = Sandbox.connect;
      Sandbox.connect = async (machine, opts) => {
        assert.equal(machine, 'm_mock_machine');
        assert.equal(opts.apiKey, 'ibk_mock_key');
        assert.equal(opts.apiUrl, INSTABOX_API_ENDPOINT);

        return {
          commands: {
            run: async (cmd, runOpts) => {
              assert.equal(cmd, 'uname -a');
              return {
                stdout: 'Linux instabox-mock 6.6.137 x86_64\n',
                stderr: '',
                exitCode: 0,
              };
            },
          },
        };
      };

      try {
        const res = await handleInstaboxExec({ command: 'uname -a' });
        assert.equal(res.success, true);
        assert.match(res.output, /\[InstaBox: m_mock_machine\] \(Exit Code: 0\)/);
        assert.match(res.output, /Linux instabox-mock/);
      } finally {
        Sandbox.connect = origConnect;
      }
    });

    it('harus menangani perintah yang mengembalikan exit code bukan 0 dan stderr', async () => {
      setInstaboxApiKey('ibk_mock_key');

      const origConnect = Sandbox.connect;
      Sandbox.connect = async () => ({
        commands: {
          run: async () => ({
            stdout: '',
            stderr: 'cat: file_tidak_ada: No such file or directory\n',
            exitCode: 1,
          }),
        },
      });

      try {
        const res = await handleInstaboxExec({ command: 'cat file_tidak_ada' });
        assert.equal(res.success, false);
        assert.match(res.output, /Exit Code: 1/);
        assert.match(res.output, /No such file or directory/);
      } finally {
        Sandbox.connect = origConnect;
      }
    });

    it('harus menangkap error koneksi ke InstaBox', async () => {
      setInstaboxApiKey('ibk_mock_key');

      const origConnect = Sandbox.connect;
      Sandbox.connect = async () => {
        throw new Error('Machine paused or unreachable');
      };

      try {
        const res = await handleInstaboxExec({ command: 'ls' });
        assert.equal(res.success, false);
        assert.match(res.output, /Gagal mengeksekusi di InstaBox/);
        assert.match(res.output, /Machine paused or unreachable/);
      } finally {
        Sandbox.connect = origConnect;
      }
    });
  });

  describe('getInstaboxStatus & controlInstabox', () => {
    it('getInstaboxStatus harus mengembalikan configured: false jika belum ada key', async () => {
      setInstaboxApiKey('');
      const status = await getInstaboxStatus();
      assert.equal(status.configured, false);
    });

    it('controlInstabox harus mengembalikan error jika belum ada key', async () => {
      setInstaboxApiKey('');
      const res = await controlInstabox('pause');
      assert.equal(res.success, false);
    });

    it('controlInstabox harus berhasil memanggil pause dan resume pada SDK', async () => {
      setInstaboxApiKey('ibk_mock_key');
      let pauseCalled = false;
      let resumeCalled = false;

      const origConnect = Sandbox.connect;
      Sandbox.connect = async () => ({
        pause: async () => { pauseCalled = true; },
        resume: async () => { resumeCalled = true; },
      });

      try {
        const rPause = await controlInstabox('pause', 'baiwor');
        assert.equal(rPause.success, true);
        assert.equal(pauseCalled, true);
        assert.match(rPause.message, /berhasil dibekukan/);

        const rResume = await controlInstabox('resume', 'baiwor');
        assert.equal(rResume.success, true);
        assert.equal(resumeCalled, true);
        assert.match(rResume.message, /berhasil diaktifkan kembali/);
      } finally {
        Sandbox.connect = origConnect;
      }
    });
  });

  describe('openInstaboxDesktop & captureInstaboxScreenshot', () => {
    it('openInstaboxDesktop harus memvalidasi URL dan memanggil box.desktop.open', async () => {
      setInstaboxApiKey('ibk_mock_key');
      let openedUrl = '';

      const origConnect = Sandbox.connect;
      Sandbox.connect = async () => ({
        desktop: {
          open: async (u) => { openedUrl = u; },
        },
      });

      try {
        const res = await openInstaboxDesktop('baiwor.my.id', 'baiwor');
        assert.equal(res.success, true);
        assert.equal(openedUrl, 'https://baiwor.my.id');
        assert.match(res.message, /Berhasil membuka https:\/\/baiwor\.my\.id/);
      } finally {
        Sandbox.connect = origConnect;
      }
    });

    it('captureInstaboxScreenshot harus memanggil box.desktop.screenshot dan mengembalikan buffer', async () => {
      setInstaboxApiKey('ibk_mock_key');
      const fakePng = new Uint8Array([137, 80, 78, 71]);

      const origConnect = Sandbox.connect;
      Sandbox.connect = async () => ({
        desktop: {
          screenshot: async () => fakePng,
        },
      });

      try {
        const res = await captureInstaboxScreenshot('baiwor');
        assert.equal(res.success, true);
        assert.equal(res.buffer, fakePng);
        assert.match(res.message, /Berhasil mengambil screenshot/);
      } finally {
        Sandbox.connect = origConnect;
      }
    });
  });
});
