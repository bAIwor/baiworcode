import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HookManager, HOOK_EVENTS } from '../src/hooks/hookManager.js';

describe('Hooks System', () => {
  let tempDir;
  let configPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-hooks-test-'));
    configPath = path.join(tempDir, '.baiwor', 'hooks.json');
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('HookManager initialization', () => {
    it('harus membuat instance dengan config path yang valid', () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      assert.ok(manager);
      assert.equal(manager.configPath, configPath);
    });

    it('harus memuat hooks dari config file jika ada', () => {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          hooks: [
            { event: 'pre-tool-execute', command: 'echo test' },
          ],
        })
      );

      const manager = new HookManager({ cwd: tempDir, configPath });
      const hooks = manager.listHooks();
      assert.equal(hooks.length, 1);
      assert.equal(hooks[0].event, 'pre-tool-execute');
    });

    it('harus mengembalikan array kosong jika config tidak ada', () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      const hooks = manager.listHooks();
      assert.deepEqual(hooks, []);
    });
  });

  describe('addHook', () => {
    it('harus menambahkan hook baru ke config', () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      manager.addHook({
        event: 'pre-tool-execute',
        command: 'echo "Pre-hook"',
      });

      const hooks = manager.listHooks();
      assert.equal(hooks.length, 1);
      assert.equal(hooks[0].event, 'pre-tool-execute');
      assert.equal(hooks[0].command, 'echo "Pre-hook"');
    });

    it('harus menolak event yang tidak valid', () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      assert.throws(() => {
        manager.addHook({ event: 'invalid-event', command: 'echo test' });
      }, /Event tidak valid/);
    });

    it('harus menyimpan hook ke disk', () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      manager.addHook({ event: 'session-start', command: 'echo start' });

      const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(content.hooks.length, 1);
    });
  });

  describe('removeHook', () => {
    it('harus menghapus hook berdasarkan index', () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      manager.addHook({ event: 'pre-tool-execute', command: 'echo 1' });
      manager.addHook({ event: 'post-tool-execute', command: 'echo 2' });

      manager.removeHook(0);
      const hooks = manager.listHooks();
      assert.equal(hooks.length, 1);
      assert.equal(hooks[0].event, 'post-tool-execute');
    });

    it('harus menolak index yang tidak valid', () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      assert.throws(() => {
        manager.removeHook(0);
      }, /Index hook tidak valid/);
    });
  });

  describe('triggerPreToolExecute', () => {
    it('harus mengizinkan eksekusi jika tidak ada hook', async () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      const result = await manager.triggerPreToolExecute('read_file', { path: 'test.js' });
      assert.equal(result.allowed, true);
    });

    it('harus menjalankan pre-hook dan mengizinkan jika exit code 0', async () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      manager.addHook({
        event: 'pre-tool-execute',
        command: 'echo "Allowed"',
      });

      const result = await manager.triggerPreToolExecute('read_file', { path: 'test.js' });
      assert.equal(result.allowed, true);
    });

    it('harus memblokir eksekusi jika pre-hook exit code non-zero', async () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      manager.addHook({
        event: 'pre-tool-execute',
        command: 'echo "Block: Not allowed" && exit 1',
      });

      const result = await manager.triggerPreToolExecute('read_file', { path: 'test.js' });
      assert.equal(result.allowed, false);
      assert.ok(result.reason);
    });

    it('harus menghormati kondisi hook', async () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      manager.addHook({
        event: 'pre-tool-execute',
        command: 'echo "Block" && exit 1',
        condition: "toolName === 'run_command'",
      });

      // Hook hanya trigger untuk run_command, bukan read_file
      const result1 = await manager.triggerPreToolExecute('read_file', { path: 'test.js' });
      assert.equal(result1.allowed, true);

      const result2 = await manager.triggerPreToolExecute('run_command', { command: 'ls' });
      assert.equal(result2.allowed, false);
    });
  });

  describe('triggerPostToolExecute', () => {
    it('harus menjalankan post-hook tanpa mempengaruhi hasil', async () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      manager.addHook({
        event: 'post-tool-execute',
        command: 'echo "Post-hook executed"',
      });

      // Post-hook tidak mengembalikan allowed/reason
      await manager.triggerPostToolExecute('read_file', { path: 'test.js' }, { success: true, output: 'ok' });
      // Jika tidak throw, berarti berhasil
    });
  });

  describe('HOOK_EVENTS', () => {
    it('harus berisi event types yang valid', () => {
      assert.ok(Array.isArray(HOOK_EVENTS));
      assert.ok(HOOK_EVENTS.includes('pre-tool-execute'));
      assert.ok(HOOK_EVENTS.includes('post-tool-execute'));
      assert.ok(HOOK_EVENTS.includes('session-start'));
      assert.ok(HOOK_EVENTS.includes('session-end'));
    });
  });

  describe('Condition evaluation', () => {
    it('harus mengevaluasi kondisi sederhana dengan ===', async () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      manager.addHook({
        event: 'pre-tool-execute',
        command: 'echo "Block" && exit 1',
        condition: "toolName === 'write_file'",
      });

      const result1 = await manager.triggerPreToolExecute('read_file', {});
      assert.equal(result1.allowed, true);

      const result2 = await manager.triggerPreToolExecute('write_file', {});
      assert.equal(result2.allowed, false);
    });

    it('harus mengevaluasi kondisi dengan !==', async () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      manager.addHook({
        event: 'pre-tool-execute',
        command: 'echo "Block" && exit 1',
        condition: "toolName !== 'read_file'",
      });

      const result1 = await manager.triggerPreToolExecute('read_file', {});
      assert.equal(result1.allowed, true);

      const result2 = await manager.triggerPreToolExecute('write_file', {});
      assert.equal(result2.allowed, false);
    });

    it('harus menangani kondisi yang tidak valid dengan aman', async () => {
      const manager = new HookManager({ cwd: tempDir, configPath });
      manager.addHook({
        event: 'pre-tool-execute',
        command: 'echo "Block" && exit 1',
        condition: 'invalid syntax here',
      });

      // Kondisi invalid seharusnya default ke true (jalankan hook)
      const result = await manager.triggerPreToolExecute('read_file', {});
      assert.equal(result.allowed, false);
    });
  });
});
