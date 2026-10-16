import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleRunCommand,
  getBackgroundTask,
  stopBackgroundTask,
  listBackgroundTasks,
  clearBackgroundTasks,
} from '../src/tools/handlers.js';

describe('Background Task Runner: Asynchronous Command Execution', () => {
  afterEach(() => {
    clearBackgroundTasks();
  });

  it('harus menjalankan perintah di latar belakang dan mengembalikan task_id', async () => {
    const res = await handleRunCommand({
      command: 'node -e "setTimeout(() => console.log(\'selesai background\'), 100)"',
      run_in_background: true,
    });

    assert.equal(res.success, true);
    assert.ok(res.task_id);
    assert.match(res.task_id, /^task_[a-z0-9]+_[a-f0-9]{4}$/);
    assert.equal(res.status, 'running');
    assert.ok(res.output.includes(res.task_id));

    // Verifikasi task tercatat di registry
    const record = getBackgroundTask(res.task_id);
    assert.ok(record);
    assert.equal(record.id, res.task_id);
  });

  it('harus dapat memeriksa status dan output task latar belakang (action: status)', async () => {
    const startRes = await handleRunCommand({
      command: 'node -e "console.log(\'BARIS_SATU\'); setTimeout(() => console.log(\'BARIS_DUA\'), 50)"',
      run_in_background: true,
    });

    // Tunggu sedikit agar proses berjalan
    await new Promise((r) => setTimeout(r, 120));

    const statusRes = await handleRunCommand({
      action: 'status',
      task_id: startRes.task_id,
    });

    assert.equal(statusRes.success, true);
    assert.equal(statusRes.task_id, startRes.task_id);
    assert.ok(statusRes.output.includes('BARIS_SATU'));
    assert.ok(statusRes.output.includes('BARIS_DUA'));
  });

  it('harus dapat menghentikan background task (action: stop)', async () => {
    const startRes = await handleRunCommand({
      command: 'node -e "setInterval(() => {}, 1000)"',
      run_in_background: true,
    });

    const task = getBackgroundTask(startRes.task_id);
    assert.ok(task);
    assert.equal(task.status, 'running');

    const stopRes = await handleRunCommand({
      action: 'stop',
      task_id: startRes.task_id,
    });

    assert.equal(stopRes.success, true);
    assert.equal(stopRes.status, 'stopped');

    const updated = getBackgroundTask(startRes.task_id);
    assert.equal(updated.status, 'stopped');
  });

  it('harus dapat melihat daftar background task (action: list)', async () => {
    await handleRunCommand({
      command: 'node -e "console.log(1)"',
      run_in_background: true,
    });

    const listRes = await handleRunCommand({
      action: 'list',
    });

    assert.equal(listRes.success, true);
    assert.ok(listRes.output.includes('Daftar Background Task'));
  });
});
