import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GoalManager } from '../src/goals/goalManager.js';

describe('Goal/Task Management System', () => {
  let tempDir;
  let storagePath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-goals-test-'));
    storagePath = path.join(tempDir, '.baiwor', 'goals.json');
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('GoalManager initialization', () => {
    it('harus membuat instance dengan storage path yang valid', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      assert.ok(manager);
      assert.equal(manager.storagePath, storagePath);
    });

    it('harus memuat goals dan tasks dari storage jika ada', () => {
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
      fs.writeFileSync(
        storagePath,
        JSON.stringify({
          goals: [{ id: '1', objective: 'Test', status: 'active', turnsUsed: 0, createdAt: new Date().toISOString() }],
          tasks: [{ id: '1', subject: 'Task 1', description: 'Desc', status: 'pending', createdAt: new Date().toISOString() }],
          nextGoalId: 2,
          nextTaskId: 2,
        })
      );

      const manager = new GoalManager({ cwd: tempDir, storagePath });
      assert.equal(manager.listGoals().length, 1);
      assert.equal(manager.listTasks().length, 1);
    });
  });

  describe('Goal operations', () => {
    it('harus membuat goal baru', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const goal = manager.createGoal('Test objective', { maxTurns: 10 });

      assert.equal(goal.id, '1');
      assert.equal(goal.objective, 'Test objective');
      assert.equal(goal.status, 'active');
      assert.equal(goal.maxTurns, 10);
      assert.equal(goal.turnsUsed, 0);
    });

    it('harus mendapatkan goal berdasarkan ID', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const goal = manager.createGoal('Test');
      const retrieved = manager.getGoal(goal.id);

      assert.deepEqual(retrieved, goal);
    });

    it('harus mendapatkan goal aktif', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      manager.createGoal('Goal 1');
      manager.createGoal('Goal 2');

      const active = manager.getActiveGoal();
      assert.equal(active.id, '1');
    });

    it('harus mengupdate status goal', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const goal = manager.createGoal('Test');
      manager.updateGoalStatus(goal.id, 'completed');

      const updated = manager.getGoal(goal.id);
      assert.equal(updated.status, 'completed');
    });

    it('harus increment turn usage', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const goal = manager.createGoal('Test', { maxTurns: 5 });

      assert.equal(manager.incrementGoalTurn(goal.id), true);
      assert.equal(goal.turnsUsed, 1);

      for (let i = 0; i < 4; i++) {
        manager.incrementGoalTurn(goal.id);
      }

      assert.equal(manager.incrementGoalTurn(goal.id), false);
      assert.equal(goal.turnsUsed, 6);
    });
  });

  describe('Task operations', () => {
    it('harus membuat task baru', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const task = manager.createTask('Task subject', 'Task description');

      assert.equal(task.id, '1');
      assert.equal(task.subject, 'Task subject');
      assert.equal(task.description, 'Task description');
      assert.equal(task.status, 'pending');
    });

    it('harus mendapatkan task berdasarkan ID', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const task = manager.createTask('Test', 'Desc');
      const retrieved = manager.getTask(task.id);

      assert.deepEqual(retrieved, task);
    });

    it('harus mengupdate task', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const task = manager.createTask('Test', 'Desc');
      manager.updateTask(task.id, { status: 'in_progress', owner: 'agent1' });

      const updated = manager.getTask(task.id);
      assert.equal(updated.status, 'in_progress');
      assert.equal(updated.owner, 'agent1');
    });

    it('harus menandai task sebagai completed', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const task = manager.createTask('Test', 'Desc');
      manager.completeTask(task.id);

      const updated = manager.getTask(task.id);
      assert.equal(updated.status, 'completed');
    });

    it('harus menandai task sebagai deleted', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const task = manager.createTask('Test', 'Desc');
      manager.deleteTask(task.id);

      const updated = manager.getTask(task.id);
      assert.equal(updated.status, 'deleted');
    });
  });

  describe('Dependencies', () => {
    it('harus menambahkan dependency antara tasks', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const task1 = manager.createTask('Task 1', 'Desc 1');
      const task2 = manager.createTask('Task 2', 'Desc 2');

      manager.addDependency(task1.id, task2.id);

      const updated1 = manager.getTask(task1.id);
      const updated2 = manager.getTask(task2.id);

      assert.ok(updated1.blocks.includes(task2.id));
      assert.ok(updated2.blockedBy.includes(task1.id));
    });

    it('harus mendapatkan tasks yang tersedia (tidak diblokir)', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const task1 = manager.createTask('Task 1', 'Desc 1');
      const task2 = manager.createTask('Task 2', 'Desc 2');
      const task3 = manager.createTask('Task 3', 'Desc 3');

      manager.addDependency(task1.id, task2.id);
      manager.addDependency(task1.id, task3.id);

      const available = manager.getAvailableTasks();
      assert.equal(available.length, 1);
      assert.equal(available[0].id, task1.id);
    });

    it('harus membuka task setelah blocker completed', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const task1 = manager.createTask('Task 1', 'Desc 1');
      const task2 = manager.createTask('Task 2', 'Desc 2');

      manager.addDependency(task1.id, task2.id);

      let available = manager.getAvailableTasks();
      assert.equal(available.length, 1);

      manager.completeTask(task1.id);

      available = manager.getAvailableTasks();
      assert.equal(available.length, 1);
      assert.equal(available[0].id, task2.id);
    });
  });

  describe('Goal-Task relationship', () => {
    it('harus mengaitkan task dengan goal', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const goal = manager.createGoal('Test goal');
      const task = manager.createTask('Task', 'Desc', { goalId: goal.id });

      assert.equal(task.goalId, goal.id);
    });

    it('harus mendapatkan tasks untuk goal tertentu', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      const goal1 = manager.createGoal('Goal 1');
      const goal2 = manager.createGoal('Goal 2');

      manager.createTask('Task 1', 'Desc', { goalId: goal1.id });
      manager.createTask('Task 2', 'Desc', { goalId: goal1.id });
      manager.createTask('Task 3', 'Desc', { goalId: goal2.id });

      const tasks = manager.listTasksForGoal(goal1.id);
      assert.equal(tasks.length, 2);
    });
  });

  describe('Reset', () => {
    it('harus mereset semua goals dan tasks', () => {
      const manager = new GoalManager({ cwd: tempDir, storagePath });
      manager.createGoal('Goal');
      manager.createTask('Task', 'Desc');

      manager.reset();

      assert.equal(manager.listGoals().length, 0);
      assert.equal(manager.listTasks().length, 0);
    });
  });
});
