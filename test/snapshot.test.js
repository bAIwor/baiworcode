import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  beginTurnSnapshot,
  commitTurnSnapshot,
  recordFileBeforeChange,
  undoLastTurn,
  redoLastTurn,
  canUndo,
  canRedo,
  clearSnapshots,
} from '../src/tools/snapshot.js';
import { handleWriteFile, handleEditFile } from '../src/tools/handlers.js';

describe('Workspace Snapshot & /undo Rollback Engine', () => {
  let tmpDir;

  beforeEach(() => {
    clearSnapshots();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-snapshot-test-'));
  });

  afterEach(() => {
    clearSnapshots();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('harus mengembalikan false jika tidak ada riwayat undo', () => {
    assert.equal(canUndo(), false);
    const res = undoLastTurn();
    assert.equal(res.success, false);
    assert.equal(res.restoredCount, 0);
    assert.match(res.message, /belum ada perubahan/i);
  });

  it('harus dapat membatalkan pembuatan berkas baru (write_file -> undo)', async () => {
    const target = path.join(tmpDir, 'newfile.txt');
    assert.equal(fs.existsSync(target), false);

    beginTurnSnapshot(1);
    const writeRes = await handleWriteFile({
      file_path: target,
      content: 'Halo dunia baru!',
    });
    assert.equal(writeRes.success, true);
    assert.equal(fs.existsSync(target), true);
    assert.ok(writeRes.diff, 'harus menyertakan visual diff');
    commitTurnSnapshot();

    assert.equal(canUndo(), true);

    const undoRes = undoLastTurn();
    assert.equal(undoRes.success, true);
    assert.equal(undoRes.restoredCount, 1);
    assert.equal(fs.existsSync(target), false, 'berkas baru harus dihapus kembali saat rollback');
  });

  it('harus dapat mengembalikan isi berkas yang dimodifikasi (edit_file -> undo)', async () => {
    const target = path.join(tmpDir, 'existing.txt');
    const originalContent = 'Versi 1.0 Original\nTetap di sini.';
    fs.writeFileSync(target, originalContent, 'utf8');

    beginTurnSnapshot(2);
    const editRes = await handleEditFile({
      file_path: target,
      old_content: 'Versi 1.0 Original',
      new_content: 'Versi 2.0 Modified',
    });
    assert.equal(editRes.success, true);
    assert.equal(fs.readFileSync(target, 'utf8'), 'Versi 2.0 Modified\nTetap di sini.');
    commitTurnSnapshot();

    const undoRes = undoLastTurn();
    assert.equal(undoRes.success, true);
    assert.equal(fs.readFileSync(target, 'utf8'), originalContent, 'isi berkas harus kembali ke semula');
  });

  it('harus mempertahankan kondisi awal jika berkas diubah berkali-kali dalam satu putaran', async () => {
    const target = path.join(tmpDir, 'multi_edit.txt');
    const originalContent = 'Awal mula';
    fs.writeFileSync(target, originalContent, 'utf8');

    beginTurnSnapshot(3);

    // Edit 1: Awal mula -> Tengah
    await handleEditFile({
      file_path: target,
      old_content: 'Awal mula',
      new_content: 'Tengah',
    });

    // Edit 2: Tengah -> Akhir
    await handleEditFile({
      file_path: target,
      old_content: 'Tengah',
      new_content: 'Akhir',
    });

    assert.equal(fs.readFileSync(target, 'utf8'), 'Akhir');
    commitTurnSnapshot();

    const undoRes = undoLastTurn();
    assert.equal(undoRes.success, true);
    // Kondisi yang dipulihkan harus 'Awal mula', bukan 'Tengah'
    assert.equal(fs.readFileSync(target, 'utf8'), originalContent);
  });

  it('harus dapat membatalkan beberapa berkas sekaligus dalam satu putaran', async () => {
    const file1 = path.join(tmpDir, 'file1.txt');
    const file2 = path.join(tmpDir, 'file2.txt');
    fs.writeFileSync(file1, 'File 1 Lama', 'utf8');
    fs.writeFileSync(file2, 'File 2 Lama', 'utf8');

    beginTurnSnapshot(4);
    await handleEditFile({ file_path: file1, old_content: 'File 1 Lama', new_content: 'File 1 Baru' });
    await handleEditFile({ file_path: file2, old_content: 'File 2 Lama', new_content: 'File 2 Baru' });
    commitTurnSnapshot();

    assert.equal(fs.readFileSync(file1, 'utf8'), 'File 1 Baru');
    assert.equal(fs.readFileSync(file2, 'utf8'), 'File 2 Baru');

    const undoRes = undoLastTurn();
    assert.equal(undoRes.success, true);
    assert.equal(undoRes.restoredCount, 2);
    assert.equal(fs.readFileSync(file1, 'utf8'), 'File 1 Lama');
    assert.equal(fs.readFileSync(file2, 'utf8'), 'File 2 Lama');
  });

  it('harus mendukung redo setelah undo', async () => {
    const target = path.join(tmpDir, 'redo_test.txt');
    fs.writeFileSync(target, 'Konten Asli', 'utf8');

    beginTurnSnapshot(5);
    await handleEditFile({ file_path: target, old_content: 'Konten Asli', new_content: 'Konten Modif' });
    commitTurnSnapshot();

    assert.equal(fs.readFileSync(target, 'utf8'), 'Konten Modif');

    undoLastTurn();
    assert.equal(fs.readFileSync(target, 'utf8'), 'Konten Asli');
    assert.equal(canRedo(), true);

    const redoRes = redoLastTurn();
    assert.equal(redoRes.success, true);
    assert.equal(fs.readFileSync(target, 'utf8'), 'Konten Modif');
  });
});
