import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectPresenter,
  resetPresenterRotation,
  resetPresenterStats,
  formatPresenterBadge,
  pickDailyGreeter,
  PRESENTER_INFO,
  getLastPresenter,
  formatHandoffLine,
  getPresenterStats,
  formatPresenterStats,
  getWorkPhaseLabel,
} from '../src/chat/presenter.js';
import {
  formatPunakawanLabel,
  TOOL_ACTORS,
  PUNAKAWAN_ROLES,
} from '../src/agents/punakawan.js';
import { setActivePresenter, getActivePresenter, renderStatusLine } from '../src/statusLine.js';

describe('Rotasi Penyampai Jawaban Punakawan', () => {
  beforeEach(() => {
    resetPresenterRotation();
    resetPresenterStats();
    setActivePresenter(null);
  });

  describe('selectPresenter — giliran dengan tool (deterministik per jenis kerja)', () => {
    it('giliran mengubah berkas → bAIwor (Master Builder)', () => {
      assert.equal(
        selectPresenter({ toolNames: ['read_file', 'search_files', 'edit_file'] }),
        'bAIwor'
      );
    });

    it('giliran murni eksplorasi → pAItruk (Scout)', () => {
      assert.equal(
        selectPresenter({ toolNames: ['read_file', 'list_directory', 'websearch'] }),
        'pAItruk'
      );
    });

    it('giliran verifikasi/test → gAIreng (Auditor)', () => {
      assert.equal(selectPresenter({ toolNames: ['run_command'] }), 'gAIreng');
      assert.equal(
        selectPresenter({ toolNames: ['read_file', 'run_command', 'diagnostics'] }),
        'gAIreng'
      );
    });

    it('giliran perencanaan → semAIr (Arsitek)', () => {
      assert.equal(selectPresenter({ toolNames: ['todo_list'] }), 'semAIr');
      assert.equal(
        selectPresenter({ toolNames: ['read_file', 'search_files', 'todo_list'] }),
        'semAIr'
      );
    });

    it('perubahan berkas menang atas verifikasi dan eksplorasi', () => {
      assert.equal(
        selectPresenter({ toolNames: ['read_file', 'edit_file', 'run_command'] }),
        'bAIwor'
      );
    });

    it('tool tak dikenal diabaikan; daftar kosong jatuh ke rotasi obrolan', () => {
      resetPresenterRotation();
      assert.equal(selectPresenter({ toolNames: ['tool_masa_depan'] }), 'semAIr');
    });
  });

  describe('selectPresenter — giliran obrolan murni (round-robin keempat anggota)', () => {
    it('keempat anggota muncul bergantian lalu kembali ke awal', () => {
      const seen = [
        selectPresenter({ toolNames: [] }),
        selectPresenter({ toolNames: [] }),
        selectPresenter({ toolNames: [] }),
        selectPresenter({ toolNames: [] }),
        selectPresenter({ toolNames: [] }),
      ];
      assert.deepEqual(seen, ['semAIr', 'pAItruk', 'bAIwor', 'gAIreng', 'semAIr']);
    });

    it('giliran ber-tool tidak menggeser rotasi obrolan murni', () => {
      resetPresenterRotation();
      selectPresenter({ toolNames: ['edit_file'] }); // bAIwor — tidak mengonsumsi rotasi
      assert.equal(selectPresenter({ toolNames: [] }), 'semAIr');
    });
  });

  describe('formatPresenterBadge & formatPunakawanLabel', () => {
    it('badge memuat ikon di kiri nama dan tagline', () => {
      const badge = formatPresenterBadge('semAIr', { useColor: false });
      assert.ok(badge.includes('👑 semAIr'));
      assert.ok(badge.includes(PRESENTER_INFO.semAIr.tagline));
    });

    it('badge karakter tak dikenal dikembalikan kosong', () => {
      assert.equal(formatPresenterBadge('arjuna'), '');
    });

    it('label aktor selalu berikon di kiri nama untuk keempat anggota', () => {
      assert.equal(formatPunakawanLabel('bAIwor'), '🔨 bAIwor');
      assert.equal(formatPunakawanLabel('semAIr'), '👑 semAIr');
      assert.equal(formatPunakawanLabel('pAItruk'), '🔭 pAItruk');
      assert.equal(formatPunakawanLabel('gAIreng'), '⚖️ gAIreng');
      assert.equal(formatPunakawanLabel('nakula'), '');
    });
  });

  describe('pickDailyGreeter — piket harian deterministik', () => {
    it('tanggal sama menghasilkan piket sama', () => {
      const a = pickDailyGreeter(new Date('2026-10-25T00:00:00Z'));
      const b = pickDailyGreeter(new Date('2026-10-25T18:30:00Z'));
      assert.equal(a.name, b.name);
    });

    it('empat hari berturut-turut menampilkan keempat anggota', () => {
      const names = [0, 1, 2, 3].map((i) =>
        pickDailyGreeter(new Date(Date.UTC(2026, 9, 20 + i))).name
      );
      assert.equal(new Set(names).size, 4);
      for (const n of names) assert.ok(PUNAKAWAN_ROLES[n]);
    });

    it('piket selalu punya ikon dan sapaan', () => {
      const g = pickDailyGreeter(new Date());
      assert.ok(g.emoji.length > 0);
      assert.ok(g.greeting.length > 0);
    });
  });

  describe('TOOL_ACTORS — peta tool → aktor (sumber tunggal)', () => {
    it('seluruh tool bawaan terpetakan ke salah satu anggota', () => {
      const validActors = new Set(['bAIwor', 'semAIr', 'pAItruk', 'gAIreng']);
      for (const actor of Object.values(TOOL_ACTORS)) {
        assert.ok(validActors.has(actor), `Aktor tak dikenal: ${actor}`);
      }
      assert.ok(TOOL_ACTORS.write_file === 'bAIwor');
      assert.ok(TOOL_ACTORS.read_file === 'pAItruk');
      assert.ok(TOOL_ACTORS.run_command === 'gAIreng');
      assert.ok(TOOL_ACTORS.todo_list === 'semAIr');
    });
  });

  describe('Baris serah terima antar giliran', () => {
    it('mencatat penyampai giliran terakhir', () => {
      assert.equal(getLastPresenter(), null);
      selectPresenter({ toolNames: ['read_file'] });
      assert.equal(getLastPresenter(), 'pAItruk');
      selectPresenter({ toolNames: ['edit_file'] });
      assert.equal(getLastPresenter(), 'bAIwor');
    });

    it('baris serah terima memuat ikon kedua karakter', () => {
      const line = formatHandoffLine('pAItruk', 'bAIwor', { useColor: false });
      assert.ok(line.includes('🔄'));
      assert.ok(line.includes('🔭 pAItruk'));
      assert.ok(line.includes('🔨 bAIwor'));
      assert.ok(line.includes('→'));
    });

    it('peran tak dikenal menghasilkan baris kosong', () => {
      assert.equal(formatHandoffLine('pAItruk', 'arjuna'), '');
      assert.equal(formatHandoffLine(null, 'bAIwor'), '');
    });

    it('reset menghapus jejak penyampai terakhir', () => {
      selectPresenter({ toolNames: ['todo_list'] });
      resetPresenterRotation();
      assert.equal(getLastPresenter(), null);
    });
  });

  describe('Statistik rotasi sesi', () => {
    it('menghitung jawaban per anggota lintas giliran', () => {
      resetPresenterRotation();
      selectPresenter({ toolNames: ['edit_file'] }); // bAIwor
      selectPresenter({ toolNames: ['edit_file'] }); // bAIwor
      selectPresenter({ toolNames: ['read_file'] }); // pAItruk
      const stats = getPresenterStats();
      assert.equal(stats.bAIwor, 2);
      assert.equal(stats.pAItruk, 1);
      assert.equal(stats.semAIr, 0);
    });

    it('format satu baris hanya memuat anggota yang sudah bicara', () => {
      resetPresenterRotation();
      selectPresenter({ toolNames: ['run_command'] }); // gAIreng
      selectPresenter({ toolNames: [] }); // semAIr (round-robin pertama)
      const line = formatPresenterStats({ useColor: false });
      assert.ok(line.includes('⚖️ gAIreng 1'));
      assert.ok(line.includes('👑 semAIr 1'));
      assert.ok(!line.includes('bAIwor'));
    });

    it('sesi kosong menampilkan keterangan ramah', () => {
      resetPresenterRotation();
      assert.ok(formatPresenterStats({ useColor: false }).includes('belum ada jawaban'));
    });

    it('reset statistik meng-nol-kan seluruh hitungan', () => {
      selectPresenter({ toolNames: [] });
      resetPresenterStats();
      assert.deepEqual(getPresenterStats(), { semAIr: 0, pAItruk: 0, bAIwor: 0, gAIreng: 0 });
    });

    it('reset rotasi tidak menghapus statistik — kuitansi tetap utuh setelah /clear', () => {
      selectPresenter({ toolNames: ['edit_file'] });
      resetPresenterRotation();
      assert.equal(getPresenterStats().bAIwor, 1);
      assert.equal(getLastPresenter(), null);
    });
  });

  describe('Spinner fase kerja', () => {
    it('giliran pertama (belum ada tool) = semAIr merancang', () => {
      assert.ok(getWorkPhaseLabel([]).includes('👑 semAIr merancang'));
    });

    it('fase mengikuti tool TERAKHIR yang dipakai pada giliran', () => {
      assert.ok(
        getWorkPhaseLabel(['read_file', 'search_files', 'edit_file']).includes('🔨 bAIwor'),
        'setelah edit, fase membangun bAIwor'
      );
      assert.ok(
        getWorkPhaseLabel(['edit_file', 'run_command']).includes('⚖️ gAIreng'),
        'setelah run_command, fase menguji gAIreng'
      );
      assert.ok(
        getWorkPhaseLabel(['edit_file', 'run_command', 'read_file']).includes('🔭 pAItruk'),
        'fase berpindah lagi mengikuti tool terakhir'
      );
    });

    it('tool tak dikenal tidak mengubah fase', () => {
      assert.ok(getWorkPhaseLabel(['tool_masa_depan', 'tool_lain']).includes('👑 semAIr merancang'));
    });
  });

  describe('Status line — chip penyampai', () => {
    it('chip aktif tampil bila presenter sudah ditetapkan', () => {
      setActivePresenter('gAIreng');
      assert.equal(getActivePresenter(), 'gAIreng');
      const line = renderStatusLine({ maxWidth: 200 });
      assert.ok(line.includes('⚖️ gAIreng'));
    });

    it('kunci tak dikenal tidak menyalakan chip', () => {
      setActivePresenter('arjuna');
      assert.equal(getActivePresenter(), null);
      assert.ok(!renderStatusLine({ maxWidth: 200 }).includes('arjuna'));
    });

    it('tanpa presenter, baris status tetap terbentuk', () => {
      setActivePresenter(null);
      assert.ok(renderStatusLine({ maxWidth: 200 }).includes('~'));
    });
  });
});
