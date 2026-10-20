import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CronManager,
  parseCronExpression,
  matchesCron,
  getNextCronTime,
} from '../src/cron/cronManager.js';

describe('Cron/Scheduled Tasks', () => {
  let tempDir;
  let storagePath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-cron-test-'));
    storagePath = path.join(tempDir, 'cron-tasks.json');
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('parseCronExpression', () => {
    it('harus parse cron expression valid', () => {
      const parsed = parseCronExpression('*/5 * * * *');
      assert.deepEqual(parsed.minute, { step: 5 });
      assert.equal(parsed.hour, null);
    });

    it('harus parse cron dengan range', () => {
      const parsed = parseCronExpression('0 9-17 * * 1-5');
      assert.equal(parsed.minute, 0);
      assert.deepEqual(parsed.hour, { range: [9, 17] });
      assert.deepEqual(parsed.dayOfWeek, { range: [1, 5] });
    });

    it('harus parse cron dengan list', () => {
      const parsed = parseCronExpression('0,15,30,45 * * * *');
      assert.deepEqual(parsed.minute, [0, 15, 30, 45]);
    });

    it('harus menolak cron expression invalid', () => {
      assert.throws(() => parseCronExpression('invalid'), /Invalid cron expression/);
      assert.throws(() => parseCronExpression('* * *'), /Expected 5 fields/);
      assert.throws(() => parseCronExpression('60 * * * *'), /Invalid cron field/);
    });
  });

  describe('matchesCron', () => {
    it('harus match dengan wildcard', () => {
      const now = new Date('2024-01-15T10:30:00');
      assert.equal(matchesCron('* * * * *', now), true);
    });

    it('harus match dengan step value', () => {
      const now1 = new Date('2024-01-15T10:00:00');
      const now2 = new Date('2024-01-15T10:05:00');
      const now3 = new Date('2024-01-15T10:07:00');

      assert.equal(matchesCron('*/5 * * * *', now1), true);
      assert.equal(matchesCron('*/5 * * * *', now2), true);
      assert.equal(matchesCron('*/5 * * * *', now3), false);
    });

    it('harus match dengan specific time', () => {
      const now = new Date('2024-01-15T09:00:00');
      assert.equal(matchesCron('0 9 * * *', now), true);
      assert.equal(matchesCron('0 10 * * *', now), false);
    });
  });

  describe('getNextCronTime', () => {
    it('harus hitung next run time', () => {
      const from = new Date('2024-01-15T10:00:00');
      const next = getNextCronTime('*/5 * * * *', from);

      assert.ok(next);
      assert.ok(next > from);
      assert.equal(next.getMinutes() % 5, 0);
    });
  });

  describe('CronManager', () => {
    it('harus membuat instance dengan storage path', () => {
      const manager = new CronManager({ storagePath });
      assert.ok(manager);
      assert.equal(manager.storagePath, storagePath);
    });

    it('harus create task baru', () => {
      const manager = new CronManager({ storagePath });
      const task = manager.create('*/5 * * * *', 'Check status');

      assert.equal(task.id, '1');
      assert.equal(task.cron, '*/5 * * * *');
      assert.equal(task.prompt, 'Check status');
      assert.equal(task.recurring, true);
      assert.ok(task.nextRun);
    });

    it('harus schedule wakeup (one-shot)', () => {
      const manager = new CronManager({ storagePath });
      const task = manager.scheduleWakeup(300, 'Run this once');

      assert.equal(task.recurring, false);
      assert.ok(task.nextRun);
    });

    it('harus get task by ID', () => {
      const manager = new CronManager({ storagePath });
      const task = manager.create('0 * * * *', 'Hourly check');
      const retrieved = manager.get(task.id);

      assert.deepEqual(retrieved, task);
    });

    it('harus delete task', () => {
      const manager = new CronManager({ storagePath });
      const task = manager.create('0 * * * *', 'Test');
      manager.delete(task.id);

      assert.equal(manager.get(task.id), null);
    });

    it('harus list semua tasks', () => {
      const manager = new CronManager({ storagePath });
      manager.create('*/5 * * * *', 'Task 1');
      manager.create('0 * * * *', 'Task 2');

      const tasks = manager.list();
      assert.equal(tasks.length, 2);
    });

    it('harus get ready tasks', () => {
      const manager = new CronManager({ storagePath });
      const task = manager.create('* * * * *', 'Every minute');
      // Set nextRun ke masa lalu
      task.nextRun = new Date(Date.now() - 60000).toISOString();
      manager.tasks.set(task.id, task);

      const ready = manager.getReadyTasks();
      assert.equal(ready.length, 1);
    });

    it('harus mark task as run', () => {
      const manager = new CronManager({ storagePath });
      const task = manager.create('0 * * * *', 'Test'); // hourly, not */5

      manager.markAsRun(task.id);
      const updated = manager.get(task.id);

      assert.ok(updated.lastRun);
      // For recurring tasks, nextRun should be updated
      assert.ok(updated.nextRun);
    });

    it('harus hapus one-shot task setelah run', () => {
      const manager = new CronManager({ storagePath });
      const task = manager.scheduleWakeup(60, 'One-shot');

      manager.markAsRun(task.id);
      assert.equal(manager.get(task.id), null);
    });

    it('harus persist tasks ke disk', () => {
      const manager = new CronManager({ storagePath });
      manager.create('0 * * * *', 'Persistent task');

      const content = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
      assert.equal(content.tasks.length, 1);
    });

    it('harus load tasks dari disk', () => {
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
      fs.writeFileSync(
        storagePath,
        JSON.stringify({
          tasks: [
            {
              id: '1',
              cron: '0 * * * *',
              prompt: 'Loaded task',
              recurring: true,
              createdAt: new Date().toISOString(),
            },
          ],
          nextTaskId: 2,
        })
      );

      const manager = new CronManager({ storagePath });
      const tasks = manager.list();
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].prompt, 'Loaded task');
    });

    it('harus reset semua tasks', () => {
      const manager = new CronManager({ storagePath });
      manager.create('0 * * * *', 'Task 1');
      manager.create('0 * * * *', 'Task 2');

      manager.reset();
      assert.equal(manager.list().length, 0);
    });
  });
});
