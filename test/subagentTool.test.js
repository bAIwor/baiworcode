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

  it('harus menjalankan beberapa subagent secara paralel dengan konteks terisolasi', async () => {
    let active = 0;
    let maxActive = 0;
    const mockCompletionFn = async ({ messages }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 60));
      active -= 1;
      const userText = messages[1]?.content || '';
      return { content: `Laporan untuk: ${userText.includes('Eksplor A') ? 'A' : 'B'}` };
    };

    const res = await handleDelegateTask(
      {
        tasks: [
          { role: 'pAItruk', task: 'Eksplor A' },
          { role: 'gAIreng', task: 'Audit B' },
        ],
      },
      { completionFn: mockCompletionFn }
    );

    assert.equal(res.success, true);
    assert.equal(res.mode, 'parallel');
    assert.equal(res.results.length, 2);
    assert.ok(res.output.includes('Laporan untuk: A'));
    assert.ok(res.output.includes('Laporan untuk: B'));
    assert.ok(maxActive >= 2, 'dua subagent seharusnya berjalan bersamaan');
  });

  it('harus menolak lebih dari 6 tugas paralel', async () => {
    const tasks = Array.from({ length: 7 }, (_, i) => ({
      role: 'pAItruk',
      task: `Tugas ${i + 1}`,
    }));
    const res = await handleDelegateTask({ tasks }, {
      completionFn: async () => ({ content: 'x' }),
    });
    assert.equal(res.success, false);
    assert.match(res.output, /maksimum 6/i);
  });

  it('harus melaporkan kegagalan parsial pada mode paralel', async () => {
    const res = await handleDelegateTask(
      {
        tasks: [
          { role: 'pAItruk', task: 'Tugas valid' },
          { role: 'arjuna', task: 'Tugas invalid' },
        ],
      },
      { completionFn: async () => ({ content: 'selesai' }) }
    );
    assert.equal(res.success, false);
    assert.equal(res.results.length, 2);
    assert.ok(res.output.includes('Peran "arjuna" tidak dikenal'));
    assert.match(res.output, /1 sukses, 1 gagal/);
  });

  it('memanggil onProgress: started → turn → completed pada mode tunggal', async () => {
    let step = 0;
    const events = [];
    const res = await handleDelegateTask(
      { role: 'pAItruk', task: 'Jelajah src' },
      {
        onProgress: (event) => events.push({ ...event }),
        completionFn: async () => {
          step += 1;
          if (step === 1) {
            return {
              content: '',
              tool_calls: [{
                id: 'call_prog_1',
                function: { name: 'list_directory', arguments: '{"dir_path":"src"}' },
              }],
            };
          }
          return { content: 'Laporan akhir' };
        },
      }
    );

    assert.equal(res.success, true);
    assert.ok(events.every((event) => event.role === 'pAItruk' && event.task === 'Jelajah src'));
    assert.equal(events[0].status, 'started');
    assert.equal(events[0].turn, 0);
    assert.deepEqual(
      events.filter((event) => event.status === 'turn').map((event) => event.turn),
      [1, 2]
    );
    assert.equal(events[events.length - 1].status, 'completed');
  });

  it('memanggil onProgress dengan status failed saat batas putaran tercapai', async () => {
    const events = [];
    const res = await handleDelegateTask(
      { role: 'pAItruk', task: 'Tanpa laporan', max_turns: 1 },
      {
        onProgress: (event) => events.push(event),
        completionFn: async () => ({
          content: '',
          tool_calls: [{
            id: 'call_prog_fail',
            function: { name: 'list_directory', arguments: '{"dir_path":"src"}' },
          }],
        }),
      }
    );

    assert.equal(res.success, false);
    assert.equal(events[0].status, 'started');
    assert.ok(events.some((event) => event.status === 'turn'));
    assert.equal(events[events.length - 1].status, 'failed');
  });

  it('memanggil onProgress untuk setiap subagent pada mode paralel', async () => {
    const events = [];
    const res = await handleDelegateTask(
      {
        tasks: [
          { role: 'pAItruk', task: 'Tugas A' },
          { role: 'gAIreng', task: 'Tugas B' },
        ],
      },
      {
        onProgress: (event) => events.push(event),
        completionFn: async ({ messages }) => ({
          content: String(messages[1]?.content).includes('Tugas A') ? 'Laporan A' : 'Laporan B',
        }),
      }
    );

    assert.equal(res.success, true);
    for (const role of ['pAItruk', 'gAIreng']) {
      const roleEvents = events.filter((event) => event.role === role);
      assert.ok(roleEvents.length >= 3, `progress ${role} harus ada`);
      assert.equal(roleEvents[0].status, 'started');
      assert.equal(roleEvents[roleEvents.length - 1].status, 'completed');
      assert.ok(roleEvents.some((event) => event.status === 'turn'));
    }
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
