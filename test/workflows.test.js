import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkflowEngine } from '../src/workflows/workflowEngine.js';

describe('Workflows System', () => {
  let tempDir;
  let workflowsDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-workflows-test-'));
    workflowsDir = path.join(tempDir, '.baiwor', 'workflows');
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('WorkflowEngine initialization', () => {
    it('harus membuat instance dengan workflows directory yang valid', () => {
      const engine = new WorkflowEngine({ cwd: tempDir });
      assert.ok(engine);
      assert.equal(engine.cwd, tempDir);
    });
  });

  describe('loadWorkflows', () => {
    it('harus memuat workflow dari file .js', async () => {
      fs.mkdirSync(workflowsDir, { recursive: true });
      fs.writeFileSync(
        path.join(workflowsDir, 'test-workflow.js'),
        `
export const meta = {
  name: 'test-workflow',
  description: 'Test workflow',
};

export default async function(context) {
  return { success: true, message: 'Test completed' };
}
`
      );

      const engine = new WorkflowEngine({ cwd: tempDir });
      await engine.loadWorkflows();

      const workflows = engine.listWorkflows();
      assert.equal(workflows.length, 1);
      assert.equal(workflows[0].name, 'test-workflow');
    });

    it('harus melewati file tanpa meta.name', async () => {
      fs.mkdirSync(workflowsDir, { recursive: true });
      fs.writeFileSync(
        path.join(workflowsDir, 'invalid.js'),
        `export default async function() { return {}; }`
      );

      const engine = new WorkflowEngine({ cwd: tempDir });
      await engine.loadWorkflows();

      const workflows = engine.listWorkflows();
      assert.equal(workflows.length, 0);
    });

    it('harus menangani direktori yang tidak ada', async () => {
      const engine = new WorkflowEngine({ cwd: tempDir });
      await engine.loadWorkflows();

      const workflows = engine.listWorkflows();
      assert.equal(workflows.length, 0);
    });
  });

  describe('createWorkflow', () => {
    it('harus membuat file workflow baru', () => {
      const engine = new WorkflowEngine({ cwd: tempDir });
      const filePath = engine.createWorkflow(
        {
          name: 'new-workflow',
          description: 'New workflow',
        },
        `return { success: true };`
      );

      assert.ok(fs.existsSync(filePath));
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('new-workflow'));
      assert.ok(content.includes('return { success: true }'));
    });
  });

  describe('run', () => {
    it('harus menjalankan workflow dan mengembalikan hasil', async () => {
      fs.mkdirSync(workflowsDir, { recursive: true });
      fs.writeFileSync(
        path.join(workflowsDir, 'simple.js'),
        `
export const meta = {
  name: 'simple',
  description: 'Simple workflow',
};

export default async function(context) {
  return { success: true, data: 'test' };
}
`
      );

      const engine = new WorkflowEngine({ cwd: tempDir });
      await engine.loadWorkflows();

      const result = await engine.run('simple');
      assert.equal(result.success, true);
      assert.equal(result.output.data, 'test');
    });

    it('harus mengembalikan error jika workflow tidak ditemukan', async () => {
      const engine = new WorkflowEngine({ cwd: tempDir });
      const result = await engine.run('nonexistent');
      assert.equal(result.success, false);
      assert.ok(result.output.includes('tidak ditemukan'));
    });

    it('harus menangani error dalam workflow', async () => {
      fs.mkdirSync(workflowsDir, { recursive: true });
      fs.writeFileSync(
        path.join(workflowsDir, 'error.js'),
        `
export const meta = {
  name: 'error',
  description: 'Error workflow',
};

export default async function(context) {
  throw new Error('Test error');
}
`
      );

      const engine = new WorkflowEngine({ cwd: tempDir });
      await engine.loadWorkflows();

      const result = await engine.run('error');
      assert.equal(result.success, false);
      assert.ok(result.output.includes('Test error'));
    });
  });

  describe('agent API', () => {
    it('harus menjalankan agent dan mengembalikan hasil', async () => {
      const engine = new WorkflowEngine({ cwd: tempDir });
      const result = await engine.agent('Test prompt', { label: 'test-agent' });

      assert.equal(result.success, true);
      assert.ok(result.output.includes('Test prompt'));
      assert.equal(result.label, 'test-agent');
    });
  });

  describe('parallel API', () => {
    it('harus menjalankan beberapa task secara paralel', async () => {
      const engine = new WorkflowEngine({ cwd: tempDir });
      const results = await engine.parallel([
        () => Promise.resolve({ id: 1 }),
        () => Promise.resolve({ id: 2 }),
        () => Promise.resolve({ id: 3 }),
      ]);

      assert.equal(results.length, 3);
      assert.equal(results[0].id, 1);
      assert.equal(results[1].id, 2);
      assert.equal(results[2].id, 3);
    });

    it('harus menolak input non-array', async () => {
      const engine = new WorkflowEngine({ cwd: tempDir });
      await assert.rejects(
        () => engine.parallel('not an array'),
        /membutuhkan array of functions/
      );
    });
  });

  describe('pipeline API', () => {
    it('harus menjalankan pipeline dengan map function', async () => {
      const engine = new WorkflowEngine({ cwd: tempDir });
      const results = await engine.pipeline(
        ['item1', 'item2'],
        item => Promise.resolve({ processed: item })
      );

      assert.equal(results.length, 2);
      assert.equal(results[0].processed, 'item1');
      assert.equal(results[1].processed, 'item2');
    });

    it('harus menjalankan pipeline dengan reduce function', async () => {
      const engine = new WorkflowEngine({ cwd: tempDir });
      const results = await engine.pipeline(
        ['a', 'b'],
        item => Promise.resolve({ value: item }),
        phase1 => Promise.resolve({ summary: phase1.length })
      );

      assert.equal(results.length, 2);
      assert.equal(results[0].length, 2);
      assert.equal(results[1].summary, 2);
    });
  });

  describe('phase API', () => {
    it('harus menjalankan function dalam fase', async () => {
      const engine = new WorkflowEngine({ cwd: tempDir });
      const result = await engine.phase('Test Phase', () => Promise.resolve('phase result'));

      assert.equal(result, 'phase result');
    });
  });
});
