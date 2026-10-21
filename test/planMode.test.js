import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  getPlanAllowedTools,
  PLAN_ALLOWED_TOOLS,
  filterToolsForAgentMode,
  isToolBlockedInPlanMode,
  planModeBlockMessage,
  renderTodoWidget,
  getTodoCompactMode,
  setTodoCompactMode,
  toggleTodoCompactMode,
  PUNAKAWAN_ROLES,
  getPunakawanRole,
  formatPunakawanBadge,
} from '../src/chat/planMode.js';
import { renderStatusLine } from '../src/statusLine.js';
import { TOOL_DEFINITIONS } from '../src/tools/index.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import {
  bacaConfig,
  buatHomeSementara,
  envHome,
  hapusHome,
  tulisConfig,
} from './tempHomeHelper.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO_ROOT, 'bin', 'baiwor.js');
const ANSI = /\x1b\[[0-9;]*m/g;
const polos = (s) => s.replace(ANSI, '');

describe('PlanMode: Penegakan Dry-Readonly permissionMode "plan"', () => {
  describe('getPlanAllowedTools', () => {
    it('hanya boleh mengizinkan tool read-only dan todo_list', () => {
      const allowed = getPlanAllowedTools();
      assert.ok(allowed.includes('read_file'));
      assert.ok(allowed.includes('list_directory'));
      assert.ok(allowed.includes('search_files'));
      assert.ok(allowed.includes('todo_list'));
      assert.ok(allowed.includes('ask_user'));

      // Harus melarang keras tool pembuat & pengubah file
      assert.ok(!allowed.includes('write_file'));
      assert.ok(!allowed.includes('edit_file'));
    });
  });

  describe('Todo Widget: compact state helpers', () => {
    it('harus dapat membaca dan mengubah status compact mode', () => {
      setTodoCompactMode(false);
      assert.equal(getTodoCompactMode(), false);

      setTodoCompactMode(true);
      assert.equal(getTodoCompactMode(), true);

      const toggled = toggleTodoCompactMode();
      assert.equal(toggled, false);
      assert.equal(getTodoCompactMode(), false);
    });
  });

  describe('renderTodoWidget: format tampilan tugas', () => {
    const sampleTodos = [
      { id: '1', content: 'Desain skema DB', status: 'completed' },
      { id: '2', content: 'Implementasi endpoint', status: 'in_progress' },
      { id: '3', content: 'Tulis unit tests', status: 'pending' },
      { id: '4', content: 'Dokumentasi API', status: 'pending' },
      { id: '5', content: 'Fitur legacy dibatalkan', status: 'cancelled' },
    ];

    it('harus mengembalikan string kosong jika list kosong atau null', () => {
      assert.equal(renderTodoWidget([]), '');
      assert.equal(renderTodoWidget(null), '');
    });

    it('harus menghasilkan header format lengkap: Todo list 1/5 · 4 remaining · Ctrl+T compact', () => {
      const out = renderTodoWidget(sampleTodos, { useColor: false, isCompact: false });
      assert.ok(out.includes('Todo list 1/5 · 4 remaining · Ctrl+T compact'));
      assert.ok(out.includes('✓ Desain skema DB'));
      assert.ok(out.includes('◐ Implementasi endpoint'));
      assert.ok(out.includes('○ Tulis unit tests'));
      assert.ok(out.includes('✗ Fitur legacy dibatalkan'));
    });

    it('harus mendukung format ringkas: Todo list 3/5 saat showDetails false', () => {
      const threeOfFive = [
        { id: '1', content: 'A', status: 'completed' },
        { id: '2', content: 'B', status: 'completed' },
        { id: '3', content: 'C', status: 'completed' },
        { id: '4', content: 'D', status: 'pending' },
        { id: '5', content: 'E', status: 'pending' },
      ];
      const out = renderTodoWidget(threeOfFive, { useColor: false, showDetails: false });
      assert.ok(out.includes('Todo list 3/5'));
      assert.ok(!out.includes('remaining'));
      assert.ok(!out.includes('Ctrl+T'));
    });

    it('harus merender mode compact hanya dengan item in_progress dan prompt Ctrl+T expand', () => {
      const out = renderTodoWidget(sampleTodos, { useColor: false, isCompact: true });
      assert.ok(out.includes('Ctrl+T expand'));
      assert.ok(out.includes('◐ Implementasi endpoint'));
      assert.ok(!out.includes('✓ Desain skema DB'));
      assert.ok(!out.includes('○ Tulis unit tests'));
    });

    it('menampilkan aktor semAIr di header, bukan hanya di pohon aktivitas', () => {
      const out = renderTodoWidget(sampleTodos, { useColor: false });
      assert.ok(out.includes('semAIr'), 'header harus menyebut semAIr');
      assert.ok(out.includes('🧭 semAIr · Todo list 1/5'));
    });

    it('selalu menampilkan SEMUA item tanpa auto-collapse walau daftarnya panjang', () => {
      const banyak = Array.from({ length: 12 }, (_, i) => ({
        id: String(i + 1),
        content: `Tugas ${i + 1}`,
        status: i === 0 ? 'in_progress' : 'pending',
      }));
      const out = renderTodoWidget(banyak, { useColor: false, isCompact: false, showDetails: true });
      for (let i = 1; i <= 12; i++) {
        assert.ok(out.includes(`Tugas ${i}`), `Tugas ${i} harus ikut tampil`);
      }
      assert.ok(!out.includes('more'), 'tidak boleh ada ringkasan "+N more" (tanpa auto-collapse)');
    });
  });

  describe('Punakawan Roles: Spesialisasi Peran Tim AI', () => {
    it('harus memuat 4 peran Punakawan utama dengan boundary peran yang jelas', () => {
      assert.ok(PUNAKAWAN_ROLES.semAIr);
      assert.ok(PUNAKAWAN_ROLES.pAItruk);
      assert.ok(PUNAKAWAN_ROLES.bAIwor);
      assert.ok(PUNAKAWAN_ROLES.gAIreng);

      assert.equal(PUNAKAWAN_ROLES.semAIr.role, 'architect');
      assert.equal(PUNAKAWAN_ROLES.pAItruk.role, 'explore');
      assert.equal(PUNAKAWAN_ROLES.bAIwor.role, 'worker');
      assert.equal(PUNAKAWAN_ROLES.gAIreng.role, 'verifier');
    });

    it('pAItruk (explore) tidak boleh memiliki tool pengubah berkas (write_file/edit_file)', () => {
      const allowed = PUNAKAWAN_ROLES.pAItruk.allowedTools;
      assert.ok(!allowed.includes('write_file'));
      assert.ok(!allowed.includes('edit_file'));
      assert.ok(allowed.includes('read_file'));
      assert.ok(allowed.includes('search_files'));
    });

    it('harus dapat mengambil peran dengan getPunakawanRole baik nama Punakawan maupun nama generic', () => {
      assert.equal(getPunakawanRole('pAItruk').role, 'explore');
      assert.equal(getPunakawanRole('explore').name, 'pAItruk');
      assert.equal(getPunakawanRole('bAIwor').role, 'worker');
      assert.equal(getPunakawanRole('verifier').name, 'gAIreng');
      assert.equal(getPunakawanRole('semAIr').role, 'architect');
      assert.equal(getPunakawanRole('tidak_ada'), null);
    });

    it('harus memformat badge peran dengan formatPunakawanBadge', () => {
      const badge = formatPunakawanBadge('bAIwor');
      assert.ok(badge.includes('bAIwor'));
      assert.ok(badge.includes('🔨'));
    });
  });
});

describe('Mode Plan: read-only sebagai salah satu permission mode', () => {
  describe('kebijakan tool mode Plan', () => {
    it('hanya tool read-only yang diizinkan', () => {
      for (const nama of PLAN_ALLOWED_TOOLS) {
        assert.equal(isToolBlockedInPlanMode(nama), false, `${nama} harus diizinkan`);
      }
      for (const nama of ['write_file', 'edit_file', 'patch_file', 'run_command', 'delegate_task']) {
        assert.equal(isToolBlockedInPlanMode(nama), true, `${nama} harus diblokir`);
      }
      assert.equal(isToolBlockedInPlanMode(''), true);
      assert.equal(isToolBlockedInPlanMode(undefined), true);
    });

    it('pesan penolakan menyebut tool, daftar izin, dan cara pindah mode', () => {
      const msg = planModeBlockMessage('write_file');
      assert.match(msg, /write_file/);
      assert.match(msg, /read_file/);
      assert.match(msg, /Shift\+Tab/);
    });

    it('filterToolsForAgentMode hanya menyaring di mode Plan', () => {
      const defs = [
        { type: 'function', function: { name: 'read_file' } },
        { type: 'function', function: { name: 'write_file' } },
        { type: 'function', function: { name: 'todo_list' } },
      ];
      assert.equal(filterToolsForAgentMode(defs, 'build').length, 3);
      assert.deepEqual(
        filterToolsForAgentMode(defs, 'plan').map((d) => d.function.name),
        ['read_file', 'todo_list']
      );
      assert.deepEqual(filterToolsForAgentMode(null, 'plan'), []);
    });

    it('daftar tool nyata tetap utuh di mode non-plan dan bebas tool tulis di mode Plan', () => {
      assert.equal(
        filterToolsForAgentMode(TOOL_DEFINITIONS, 'build').length,
        TOOL_DEFINITIONS.length
      );

      const namaPlan = filterToolsForAgentMode(TOOL_DEFINITIONS, 'plan').map(
        (d) => d.function.name
      );
      assert.ok(namaPlan.length > 0, 'mode Plan tetap punya tool baca');
      for (const nama of namaPlan) {
        assert.ok(
          PLAN_ALLOWED_TOOLS.includes(nama),
          `${nama} seharusnya tidak dikirim di mode Plan`
        );
      }
      assert.ok(!namaPlan.includes('write_file'));
      assert.ok(!namaPlan.includes('run_command'));
    });
  });

  describe('integrasi CLI: /permission plan & baris status', () => {
    // Home sementara: config pengguna asli tidak boleh tersentuh, termasuk saat
    // berkas tes lain berjalan paralel.
    const jalankan = (perintah, configAwal = null) => {
      const home = buatHomeSementara();
      try {
        if (configAwal) tulisConfig(home, configAwal);
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

    it('/permission plan menyalakan mode Plan menempel, /permission safe mematikannya', () => {
      const nyala = jalankan('/permission plan');
      assert.match(nyala.out, /Mode izin aktif: Plan/);
      assert.match(nyala.out, /menyusun rencana/);
      assert.equal(nyala.config?.permissionMode, 'plan', 'config harus menyimpan permissionMode: "plan"');

      const mati = jalankan('/permission safe');
      assert.match(mati.out, /Mode izin aktif: Safe/);
      assert.equal(mati.config?.permissionMode, 'safe');
    });

    it('/plan lama tidak dikenal lagi dan diarahkan ke /permission', () => {
      const { out } = jalankan('/plan');
      assert.match(out, /mboten dipunmangertosi/);
      assert.match(out, /\/help/);
    });

    it('baris status menampilkan mode izin yang sedang aktif', () => {
      const { out } = jalankan('/exit', { ...DEFAULT_CONFIG, permissionMode: 'plan' });
      assert.match(out, /~\s+│\s+Plan\s+│/);
      assert.match(
        polos(renderStatusLine({ maxWidth: 140 })),
        /~\s+│\s+(?:Safe|Auto|Plan|YOLO)\s+│/
      );
    });
  });
});
