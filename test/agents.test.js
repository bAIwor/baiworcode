import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentCreator, DEFAULT_AGENTS } from '../src/agents/agentCreator.js';

describe('Custom Agent Creator', () => {
  let tempDir;
  let agentsDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-agents-test-'));
    agentsDir = path.join(tempDir, '.baiwor', 'agents');
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('AgentCreator initialization', () => {
    it('harus membuat instance dengan default agents', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      const agents = creator.listAgents();

      assert.ok(agents.length >= 3);
      assert.ok(creator.getAgent('pAItruk'));
      assert.ok(creator.getAgent('gAIreng'));
      assert.ok(creator.getAgent('bAIwor'));
    });

    it('harus load custom agents dari disk', () => {
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentsDir, 'custom-agent.json'),
        JSON.stringify({
          name: 'custom-agent',
          title: 'Custom Agent',
          emoji: '🎯',
          systemPrompt: 'You are a custom agent',
          allowedTools: ['read_file'],
          createdAt: new Date().toISOString(),
        })
      );

      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      const agent = creator.getAgent('custom-agent');

      assert.ok(agent);
      assert.equal(agent.title, 'Custom Agent');
    });
  });

  describe('createAgent', () => {
    it('harus membuat custom agent baru', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      const agent = creator.createAgent({
        name: 'test-agent',
        title: 'Test Agent',
        emoji: '🧪',
        systemPrompt: 'You are a test agent',
        allowedTools: ['read_file', 'write_file'],
      });

      assert.equal(agent.name, 'test-agent');
      assert.equal(agent.title, 'Test Agent');
      assert.equal(agent.emoji, '🧪');
      assert.equal(agent.isDefault, false);
    });

    it('harus menolak agent dengan nama yang sudah ada', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      creator.createAgent({
        name: 'duplicate',
        systemPrompt: 'Test',
        allowedTools: ['read_file'],
      });

      assert.throws(() => {
        creator.createAgent({
          name: 'duplicate',
          systemPrompt: 'Test 2',
          allowedTools: ['read_file'],
        });
      }, /already exists/);
    });

    it('harus menolak agent tanpa name', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      assert.throws(() => {
        creator.createAgent({
          systemPrompt: 'Test',
          allowedTools: ['read_file'],
        });
      }, /name is required/);
    });

    it('harus menolak agent tanpa systemPrompt', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      assert.throws(() => {
        creator.createAgent({
          name: 'test',
          allowedTools: ['read_file'],
        });
      }, /System prompt is required/);
    });

    it('harus menolak agent tanpa allowedTools', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      assert.throws(() => {
        creator.createAgent({
          name: 'test',
          systemPrompt: 'Test',
          allowedTools: [],
        });
      }, /non-empty array/);
    });

    it('harus persist agent ke disk', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      creator.createAgent({
        name: 'persistent',
        systemPrompt: 'Test',
        allowedTools: ['read_file'],
      });

      const filePath = path.join(agentsDir, 'persistent.json');
      assert.ok(fs.existsSync(filePath));

      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      assert.equal(content.name, 'persistent');
    });
  });

  describe('updateAgent', () => {
    it('harus update custom agent', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      creator.createAgent({
        name: 'updatable',
        title: 'Original',
        systemPrompt: 'Original prompt',
        allowedTools: ['read_file'],
      });

      const updated = creator.updateAgent('updatable', {
        title: 'Updated',
        systemPrompt: 'Updated prompt',
      });

      assert.equal(updated.title, 'Updated');
      assert.equal(updated.systemPrompt, 'Updated prompt');
      assert.ok(updated.updatedAt);
    });

    it('harus menolak update default agent', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      assert.throws(() => {
        creator.updateAgent('pAItruk', { title: 'New Title' });
      }, /Cannot modify default agent/);
    });

    it('harus menolak update agent yang tidak ada', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      assert.throws(() => {
        creator.updateAgent('nonexistent', { title: 'Test' });
      }, /not found/);
    });
  });

  describe('deleteAgent', () => {
    it('harus hapus custom agent', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      creator.createAgent({
        name: 'deletable',
        systemPrompt: 'Test',
        allowedTools: ['read_file'],
      });

      creator.deleteAgent('deletable');
      assert.equal(creator.getAgent('deletable'), null);
    });

    it('harus menolak hapus default agent', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      assert.throws(() => {
        creator.deleteAgent('pAItruk');
      }, /Cannot delete default agent/);
    });

    it('harus hapus file dari disk', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      creator.createAgent({
        name: 'file-test',
        systemPrompt: 'Test',
        allowedTools: ['read_file'],
      });

      const filePath = path.join(agentsDir, 'file-test.json');
      assert.ok(fs.existsSync(filePath));

      creator.deleteAgent('file-test');
      assert.ok(!fs.existsSync(filePath));
    });
  });

  describe('listAgents', () => {
    it('harus list semua agents (default + custom)', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      creator.createAgent({
        name: 'custom1',
        systemPrompt: 'Test',
        allowedTools: ['read_file'],
      });

      const all = creator.listAgents();
      assert.ok(all.length >= 4); // 3 defaults + 1 custom
    });

    it('harus list custom agents saja', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      creator.createAgent({
        name: 'custom1',
        systemPrompt: 'Test',
        allowedTools: ['read_file'],
      });

      const custom = creator.listCustomAgents();
      assert.equal(custom.length, 1);
      assert.equal(custom[0].name, 'custom1');
    });

    it('harus list default agents saja', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      const defaults = creator.listDefaultAgents();
      assert.equal(defaults.length, 3);
    });
  });

  describe('filterToolsForAgent', () => {
    it('harus filter tools berdasarkan allowedTools', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      const allTools = [
        { name: 'read_file', description: 'Read file' },
        { name: 'write_file', description: 'Write file' },
        { name: 'run_command', description: 'Run command' },
      ];

      const filtered = creator.filterToolsForAgent('pAItruk', allTools);
      assert.ok(filtered.length < allTools.length);
      assert.ok(filtered.every((t) => ['read_file', 'list_directory', 'search_files', 'webfetch', 'websearch'].includes(t.name)));
    });

    it('harus return semua tools jika agent tidak ditemukan', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      const allTools = [{ name: 'read_file' }, { name: 'write_file' }];

      const filtered = creator.filterToolsForAgent('nonexistent', allTools);
      assert.deepEqual(filtered, allTools);
    });
  });

  describe('reset', () => {
    it('harus reset ke default agents', () => {
      const creator = new AgentCreator({ cwd: tempDir, agentsDir });
      creator.createAgent({
        name: 'custom1',
        systemPrompt: 'Test',
        allowedTools: ['read_file'],
      });
      creator.createAgent({
        name: 'custom2',
        systemPrompt: 'Test',
        allowedTools: ['read_file'],
      });

      creator.reset();
      const agents = creator.listAgents();
      assert.equal(agents.length, 3);
      assert.ok(agents.every((a) => a.isDefault));
    });
  });

  describe('DEFAULT_AGENTS', () => {
    it('harus berisi 3 default agents', () => {
      assert.ok(DEFAULT_AGENTS.pAItruk);
      assert.ok(DEFAULT_AGENTS.gAIreng);
      assert.ok(DEFAULT_AGENTS.bAIwor);
    });

    it('harus memiliki field yang required', () => {
      for (const agent of Object.values(DEFAULT_AGENTS)) {
        assert.ok(agent.name);
        assert.ok(agent.title);
        assert.ok(agent.emoji);
        assert.ok(agent.systemPrompt);
        assert.ok(Array.isArray(agent.allowedTools));
      }
    });
  });
});
