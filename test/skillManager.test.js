import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseSkillContent,
  discoverSkills,
  getSkill,
  formatSkillsPrompt,
} from '../src/skills/skillManager.js';

describe('Skill & Extension Plugin System (.baiwor/skills)', () => {
  const tmpDir = path.join(os.tmpdir(), `baiwor-skill-test-${Date.now()}`);
  const projectSkillsDir = path.join(tmpDir, 'project', '.baiwor', 'skills');
  const globalSkillsDir = path.join(tmpDir, 'global', '.baiwor', 'skills');

  before(() => {
    fs.mkdirSync(projectSkillsDir, { recursive: true });
    fs.mkdirSync(globalSkillsDir, { recursive: true });

    // Buat project skill
    const projectSkillPath = path.join(projectSkillsDir, 'docker-expert');
    fs.mkdirSync(projectSkillPath, { recursive: true });
    fs.writeFileSync(
      path.join(projectSkillPath, 'SKILL.md'),
      `---
name: docker-expert
description: Panduan Dockerfile efisien dan aman
version: 1.2.0
author: Tim bAIwor
---
# Aturan Docker
1. Gunakan multi-stage build.
2. Jangan jalankan root.`,
      'utf8'
    );

    // Buat global skill
    const globalSkillPath = path.join(globalSkillsDir, 'sql-migration');
    fs.mkdirSync(globalSkillPath, { recursive: true });
    fs.writeFileSync(
      path.join(globalSkillPath, 'SKILL.md'),
      `---
name: sql-migration
description: Best practices skrip migrasi SQL atomik
version: 1.0.0
---
# Aturan SQL
1. Selalu sertakan rollback transaksi.`,
      'utf8'
    );
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('parseSkillContent', () => {
    it('harus memisahkan frontmatter YAML dan markdown instructions', () => {
      const raw = `---
name: "nextjs-master"
description: 'Optimasi Next.js SSR'
version: 2.0.0
---
# Panduan
Gunakan Server Components untuk fetch data.`;

      const { metadata, instructions } = parseSkillContent(raw);
      assert.equal(metadata.name, 'nextjs-master');
      assert.equal(metadata.description, 'Optimasi Next.js SSR');
      assert.equal(metadata.version, '2.0.0');
      assert.ok(instructions.includes('Gunakan Server Components'));
    });

    it('harus bertahan jika file tidak memiliki frontmatter', () => {
      const raw = '# Petunjuk Polos\nLakukan sesuatu secara rapi.';
      const { metadata, instructions } = parseSkillContent(raw, '/some/path/my-skill/SKILL.md');

      assert.equal(metadata.name, 'my-skill');
      assert.ok(instructions.includes('Lakukan sesuatu secara rapi'));
    });
  });

  describe('discoverSkills', () => {
    it('harus menemukan skill proyek dan global', () => {
      const skills = discoverSkills({
        cwd: path.join(tmpDir, 'project'),
        homeDir: path.join(tmpDir, 'global'),
      });

      assert.equal(skills.has('docker-expert'), true);
      assert.equal(skills.has('sql-migration'), true);

      const docker = skills.get('docker-expert');
      assert.equal(docker.scope, 'project');
      assert.equal(docker.version, '1.2.0');

      const sql = skills.get('sql-migration');
      assert.equal(sql.scope, 'global');
    });

    it('skill proyek harus menimpa global skill jika nama sama', () => {
      // Buat skill di global dengan nama 'docker-expert' tapi versi lama
      const duplicateGlobalPath = path.join(globalSkillsDir, 'docker-expert');
      fs.mkdirSync(duplicateGlobalPath, { recursive: true });
      fs.writeFileSync(
        path.join(duplicateGlobalPath, 'SKILL.md'),
        `---
name: docker-expert
description: Versi global lama
version: 0.9.0
---
Global old instruction`,
        'utf8'
      );

      const skills = discoverSkills({
        cwd: path.join(tmpDir, 'project'),
        homeDir: path.join(tmpDir, 'global'),
      });

      const docker = skills.get('docker-expert');
      assert.equal(docker.scope, 'project');
      assert.equal(docker.version, '1.2.0');
      assert.ok(docker.instructions.includes('multi-stage build'));
    });

    it('harus menemukan skill bawaan (builtin) dengan scope "builtin"', () => {
      const skills = discoverSkills({
        cwd: path.join(tmpDir, 'project'),
        homeDir: path.join(tmpDir, 'global'),
      });
      assert.equal(skills.has('instabox'), true, 'skill builtin instabox harus tersedia');
      const ib = skills.get('instabox');
      assert.equal(ib.scope, 'builtin');
      assert.ok(ib.description.length > 0);
    });

    it('skill proyek menimpa builtin jika nama sama', () => {
      // Buat skill proyek dengan nama 'instabox' (override builtin)
      const overridePath = path.join(projectSkillsDir, 'instabox');
      fs.mkdirSync(overridePath, { recursive: true });
      fs.writeFileSync(
        path.join(overridePath, 'SKILL.md'),
        `---
name: instabox
description: Override proyek
version: 9.9.9
---
Override instructions`,
        'utf8'
      );

      const skills = discoverSkills({
        cwd: path.join(tmpDir, 'project'),
        homeDir: path.join(tmpDir, 'global'),
      });
      const ib = skills.get('instabox');
      assert.equal(ib.scope, 'project');
      assert.equal(ib.version, '9.9.9');

      // bersihkan
      fs.rmSync(overridePath, { recursive: true, force: true });
    });
  });

  describe('getSkill & formatSkillsPrompt', () => {
    it('harus dapat mengambil satu skill dengan getSkill', () => {
      const skill = getSkill('docker-expert', {
        cwd: path.join(tmpDir, 'project'),
        homeDir: path.join(tmpDir, 'global'),
      });

      assert.ok(skill);
      assert.equal(skill.name, 'docker-expert');
    });

    it('harus memformat daftar skill menjadi prompt yang bersih', () => {
      const skills = discoverSkills({
        cwd: path.join(tmpDir, 'project'),
        homeDir: path.join(tmpDir, 'global'),
      });

      const prompt = formatSkillsPrompt(skills);
      assert.ok(prompt.includes('Modul Keahlian / Ekstensi Proyek'));
      assert.ok(prompt.includes('`docker-expert` (project):'));
      assert.ok(prompt.includes('`sql-migration` (global):'));
    });
  });
});
