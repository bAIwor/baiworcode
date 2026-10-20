import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  handleWriteFile,
  handleEditFile,
} from '../src/tools/handlers.js';
import {
  setFileApprovalHandler,
  resetFileApprovalHandler,
} from '../src/tools/approval.js';
import { setAccessMode } from '../src/config.js';

describe('Safe Mode Diff Approval Gate (File Modifications)', () => {
  let tmpDir;

  beforeEach(() => {
    resetFileApprovalHandler();
    setAccessMode('normal'); // Pastikan Safe Mode aktif
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-approval-test-'));
  });

  afterEach(() => {
    resetFileApprovalHandler();
    setAccessMode('normal');
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('harus membatalkan write_file jika pengguna menolak konfirmasi Safe Mode', async () => {
    const targetFile = path.join(tmpDir, 'rejected.txt');

    let askedDetails = null;
    setFileApprovalHandler(async (details) => {
      askedDetails = details;
      return { approved: false, message: 'Dibatalkan oleh pengguna saat review diff.' };
    });

    const res = await handleWriteFile({
      file_path: targetFile,
      content: 'Isi yang ditolak',
    });

    assert.equal(res.success, false);
    assert.match(res.output, /Dibatalkan oleh pengguna saat review diff/);
    assert.equal(fs.existsSync(targetFile), false, 'berkas tidak boleh dibuat jika ditolak');
    assert.equal(askedDetails?.filePath, targetFile);
    assert.equal(askedDetails?.action, 'write');
    assert.ok(askedDetails?.diff, 'harus menyertakan diff dalam konfirmasi');
  });

  it('harus menulis berkas jika pengguna menyetujui konfirmasi Safe Mode', async () => {
    const targetFile = path.join(tmpDir, 'accepted.txt');

    setFileApprovalHandler(async () => ({ approved: true }));

    const res = await handleWriteFile({
      file_path: targetFile,
      content: 'Isi yang disetujui',
    });

    assert.equal(res.success, true);
    assert.equal(fs.existsSync(targetFile), true);
    assert.equal(fs.readFileSync(targetFile, 'utf8'), 'Isi yang disetujui');
    assert.ok(res.diff, 'harus mengembalikan visual diff');
  });

  it('harus membatalkan edit_file jika pengguna menolak, dan menjaga isi berkas asli', async () => {
    const targetFile = path.join(tmpDir, 'edit_reject.txt');
    const originalText = 'const token = "rahasia";';
    fs.writeFileSync(targetFile, originalText, 'utf8');

    setFileApprovalHandler(async (details) => {
      assert.ok(details.diff.includes('- const token = "rahasia";'));
      assert.ok(details.diff.includes('+ const token = "terbuka";'));
      return { approved: false };
    });

    const res = await handleEditFile({
      file_path: targetFile,
      old_content: 'const token = "rahasia";',
      new_content: 'const token = "terbuka";',
    });

    assert.equal(res.success, false);
    assert.match(res.output, /dibatalkan/i);
    // Isi di disk tidak boleh berubah
    assert.equal(fs.readFileSync(targetFile, 'utf8'), originalText);
  });

  it('harus melewati konfirmasi jika options.skipApproval=true', async () => {
    const targetFile = path.join(tmpDir, 'skip_approval.txt');
    let called = false;
    setFileApprovalHandler(async () => {
      called = true;
      return { approved: false };
    });

    const res = await handleWriteFile(
      { file_path: targetFile, content: 'Bypass!' },
      { skipApproval: true }
    );

    assert.equal(res.success, true);
    assert.equal(called, false, 'approval handler tidak boleh dipanggil jika skipApproval aktif');
    assert.equal(fs.readFileSync(targetFile, 'utf8'), 'Bypass!');
  });
});
