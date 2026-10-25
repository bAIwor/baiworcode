import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordUserTurn,
  recordToolCall,
  getSessionSummary,
  resetSessionStats,
  formatDuration,
  formatRelativeTime,
} from '../src/chat/sessionStats.js';
import { presenterForToolNames, resetPresenterRotation, resetPresenterStats } from '../src/chat/presenter.js';

describe('Statistik Sesi (kuitansi /exit)', () => {
  beforeEach(() => {
    resetSessionStats();
    resetPresenterRotation();
    resetPresenterStats();
  });

  it('menghitung giliran pengguna dan panggilan tool', () => {
    recordUserTurn();
    recordUserTurn();
    recordToolCall('read_file', { file_path: 'a.js' });
    recordToolCall('run_command', { command: 'npm test' });
    const s = getSessionSummary();
    assert.equal(s.userTurns, 2);
    assert.equal(s.toolCalls, 2);
  });

  it('memilah berkas diedit vs ditulis dari tool tulis', () => {
    recordToolCall('write_file', { file_path: 'baru.js' });
    recordToolCall('write_file', { file_path: 'baru.js' }); // duplikat dihitung satu
    recordToolCall('edit_file', { file_path: 'lama.js' });
    recordToolCall('patch_file', { file_path: 'lama.js' });
    recordToolCall('read_file', { file_path: 'tak-dihitung.js' });
    const s = getSessionSummary();
    assert.equal(s.writtenCount, 1);
    assert.equal(s.editedCount, 1);
  });

  it('tool tanpa file_path tidak menggelembungkan himpunan berkas', () => {
    recordToolCall('websearch', { query: 'node js' });
    recordToolCall('write_file', {});
    const s = getSessionSummary();
    assert.equal(s.writtenCount, 0);
    assert.equal(s.editedCount, 0);
    assert.equal(s.toolCalls, 2);
  });

  it('durasi tidak pernah negatif dan bertambah', async () => {
    const awal = getSessionSummary().durationMs;
    await new Promise((r) => setTimeout(r, 15));
    const akhir = getSessionSummary().durationMs;
    assert.ok(akhir >= awal);
  });
});

describe('Format durasi & waktu relatif', () => {
  it('formatDuration: detik, menit, jam+menit', () => {
    assert.match(formatDuration(45_000), /detik/);
    assert.equal(formatDuration(47 * 60_000), '47 menit');
    assert.equal(formatDuration(125 * 60_000), '2 jam 5 mnt');
    assert.equal(formatDuration(120 * 60_000), '2 jam');
  });

  it('formatRelativeTime: baru saja, menit, jam, hari, invalid', () => {
    assert.equal(formatRelativeTime(Date.now() - 5_000), 'baru saja');
    assert.match(formatRelativeTime(Date.now() - 10 * 60_000), /menit lalu/);
    assert.match(formatRelativeTime(Date.now() - 3 * 3_600_000), /jam lalu/);
    assert.match(formatRelativeTime(Date.now() - 2 * 86_400_000), /hari lalu/);
    assert.equal(formatRelativeTime('bukan-angka'), '-');
  });
});

describe('presenterForToolNames (murni, tanpa memutasi rotasi)', () => {
  it('mengikuti prioritas yang sama dengan selectPresenter', () => {
    assert.equal(presenterForToolNames(['edit_file', 'run_command']), 'bAIwor');
    assert.equal(presenterForToolNames(['run_command']), 'gAIreng');
    assert.equal(presenterForToolNames(['todo_list', 'read_file']), 'semAIr');
    assert.equal(presenterForToolNames(['read_file', 'websearch']), 'pAItruk');
  });

  it('null bila tidak ada tool dikenal — sinyal giliran obrolan murni', () => {
    assert.equal(presenterForToolNames([]), null);
    assert.equal(presenterForToolNames(['tool_masa_depan']), null);
  });

  it('tidak menggeser rotasi round-robin maupun statistik', () => {
    resetPresenterRotation();
    presenterForToolNames(['edit_file']);
    presenterForToolNames([]);
    const s = getSessionSummary();
    assert.equal(s.presenters.bAIwor, 0);
  });
});
