import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleDelegateTask,
  SUBAGENT_ROLES,
} from '../src/tools/subagentTool.js';
import '../src/tools/index.js';

describe('Child Subagent Delegation Engine (delegate_task)', () => {
  it('harus mendefinisikan 3 peran Punakawan utama dengan konfigurasi tool yang tepat', () => {
    assert.ok(SUBAGENT_ROLES.pAItruk);
    assert.ok(SUBAGENT_ROLES.gAIreng);
    assert.ok(SUBAGENT_ROLES.bAIwor);

    // pAItruk harus read-only murni
    assert.ok(SUBAGENT_ROLES.pAItruk.allowedTools.includes('read_file'));
    assert.ok(SUBAGENT_ROLES.pAItruk.allowedTools.includes('search_files'));
    assert.ok(SUBAGENT_ROLES.pAItruk.allowedTools.includes('list_directory'));
    assert.ok(!SUBAGENT_ROLES.pAItruk.allowedTools.includes('write_file'));
    assert.ok(!SUBAGENT_ROLES.pAItruk.allowedTools.includes('run_command'));

    // gAIreng harus memiliki tool verifikasi
    assert.ok(SUBAGENT_ROLES.gAIreng.allowedTools.includes('run_command'));
    assert.ok(SUBAGENT_ROLES.gAIreng.allowedTools.includes('diagnostics'));
    assert.ok(SUBAGENT_ROLES.gAIreng.allowedTools.includes('read_file'));
  });

  it('harus menolak peran yang tidak dikenal', async () => {
    const res = await handleDelegateTask({
      role: 'arjuna',
      task: 'Cari berkas penting',
    });
    assert.equal(res.success, false);
    assert.ok(res.output.includes('Peran "arjuna" tidak dikenal'));
    assert.ok(res.output.includes('pAItruk'));
  });

  it('harus menolak tugas kosong', async () => {
    const res = await handleDelegateTask({
      role: 'pAItruk',
      task: '   ',
    });
    assert.equal(res.success, false);
    assert.ok(res.output.includes('Parameter "task" wajib diisi'));
  });

  it('harus berhasil menjalankan subagent pAItruk dan mengembalikan laporan sintesis', async () => {
    let calledWithTools = null;
    const mockCompletionFn = async ({ messages, tools }) => {
      calledWithTools = tools.map((t) => t.function.name);
      return {
        content: 'Berkas autentikasi ditemukan di src/auth/resolve.js baris 10.',
      };
    };

    const res = await handleDelegateTask(
      {
        role: 'pAItruk',
        task: 'Cari letak penanganan autentikasi token',
        context: 'Proyek bAIwor Code',
      },
      { completionFn: mockCompletionFn }
    );

    assert.equal(res.success, true);
    assert.ok(res.output.includes('🔭 [Laporan Subagent pAItruk - Scout & Penjelajah]'));
    assert.ok(res.output.includes('Berkas autentikasi ditemukan'));
    // Pastikan pAItruk hanya menerima tool yang diizinkan
    assert.ok(calledWithTools.includes('read_file'));
    assert.ok(!calledWithTools.includes('write_file'));
    assert.ok(!calledWithTools.includes('run_command'));
  });

  it('harus mengeksekusi panggilan tool di dalam loop subagent terisolasi', async () => {
    let step = 0;
    const mockCompletionFn = async ({ messages }) => {
      step += 1;
      if (step === 1) {
        // Putaran 1: Minta eksekusi list_directory
        return {
          content: 'Saya akan memeriksa isi folder src terlebih dahulu.',
          tool_calls: [
            {
              id: 'call_1',
              function: {
                name: 'list_directory',
                arguments: JSON.stringify({ dir_path: 'src' }),
              },
            },
          ],
        };
      }
      // Putaran 2: Kembalikan laporan akhir setelah membaca hasil tool
      const lastMsg = messages[messages.length - 1];
      assert.equal(lastMsg.role, 'tool');
      return {
        content: 'Folder src memuat modul chat, tools, dan config.',
      };
    };

    const res = await handleDelegateTask(
      {
        role: 'pAItruk',
        task: 'Jelajahi struktur folder src',
      },
      { completionFn: mockCompletionFn }
    );

    assert.equal(res.success, true);
    assert.ok(res.output.includes('Folder src memuat modul chat'));
    assert.equal(res.turns, 2);
  });

  it('harus menolak jika subagent mencoba memanggil tool di luar wewenangnya', async () => {
    let step = 0;
    const mockCompletionFn = async ({ messages }) => {
      step += 1;
      if (step === 1) {
        // pAItruk mencoba memanggil write_file (dilarang!)
        return {
          content: 'Saya akan mencoba menulis file.',
          tool_calls: [
            {
              id: 'call_rogue',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({ file_path: 'test.txt', content: 'hack' }),
              },
            },
          ],
        };
      }
      // Putaran 2: Cek apakah error penolakan peran masuk ke histori
      const lastMsg = messages[messages.length - 1];
      assert.equal(lastMsg.role, 'tool');
      assert.ok(lastMsg.content.includes('dilarang untuk peran pAItruk'));
      return {
        content: 'Baik, saya batalkan penulisan dan melaporkan struktur saja.',
      };
    };

    const res = await handleDelegateTask(
      {
        role: 'pAItruk',
        task: 'Uji batas keamanan wewenang subagent',
      },
      { completionFn: mockCompletionFn }
    );

    assert.equal(res.success, true);
    assert.ok(res.output.includes('melaporkan struktur saja'));
  });

  it('harus mengembalikan gagal bila batas putaran tercapai tanpa laporan akhir', async () => {
    const mockCompletionFn = async () => ({
      content: '',
      tool_calls: [{
        id: `call_${Math.random().toString(16).slice(2)}`,
        function: { name: 'list_directory', arguments: '{"dir_path":"src"}' },
      }],
    });

    const res = await handleDelegateTask(
      { role: 'pAItruk', task: 'Jelajahi terus', max_turns: 2 },
      { completionFn: mockCompletionFn }
    );

    assert.equal(res.success, false);
    assert.match(res.output, /batas 2 putaran tanpa laporan akhir/i);
  });

  it('harus menangani pembatalan AbortSignal dengan elegan', async () => {
    const controller = new AbortController();
    controller.abort();

    const res = await handleDelegateTask(
      {
        role: 'gAIreng',
        task: 'Jalankan pengujian menyeluruh',
      },
      { signal: controller.signal }
    );

    assert.equal(res.success, false);
    assert.ok(res.output.includes('dibatalkan oleh sinyal pengguna'));
  });
});
