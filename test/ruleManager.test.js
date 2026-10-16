import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  parseRuleContent,
  discoverRules,
  formatRulesPrompt,
  MAX_RULES_CHARS,
} from '../src/rules/ruleManager.js';
import { getSystemPrompt } from '../src/chat/systemPrompt.js';

describe('ruleManager: parseRuleContent', () => {
  it('harus membaca file aturan tanpa frontmatter', () => {
    const raw = '# Aturan Umum\nJangan gunakan console.log di production.';
    const res = parseRuleContent(raw, '/project/rules/general.md');

    assert.equal(res.metadata.name, 'general');
    assert.equal(res.content, raw);
  });

  it('harus membaca file aturan dengan frontmatter YAML', () => {
    const raw = `---
name: styling-rules
title: "Konvensi Tailwind CSS"
description: Aturan styling proyek
---
# Panduan Styling
Gunakan Tailwind utility classes.`;

    const res = parseRuleContent(raw, '/project/.baiwor/rules/styling.md');
    assert.equal(res.metadata.name, 'styling-rules');
    assert.equal(res.metadata.title, 'Konvensi Tailwind CSS');
    assert.equal(res.metadata.description, 'Aturan styling proyek');
    assert.equal(res.content, '# Panduan Styling\nGunakan Tailwind utility classes.');
  });

  it('harus aman terhadap input kosong atau non-string', () => {
    assert.deepEqual(parseRuleContent(null), { metadata: {}, content: '' });
    assert.deepEqual(parseRuleContent(''), { metadata: {}, content: '' });
    assert.deepEqual(parseRuleContent(123), { metadata: {}, content: '' });
  });
});

describe('ruleManager: discoverRules', () => {
  let tmpDir;
  let tmpHome;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-test-rules-project-'));
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-test-rules-home-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('harus menemukan file root BAIWORS.md', () => {
    const rootFile = path.join(tmpDir, 'BAIWORS.md');
    fs.writeFileSync(rootFile, '# Aturan Proyek Utama\nSelalu tulis unit test.', 'utf8');

    const rules = discoverRules({ cwd: tmpDir, homeDir: tmpHome });
    assert.equal(rules.size, 1);
    const r = Array.from(rules.values())[0];
    assert.equal(r.scope, 'project');
    assert.match(r.content, /Selalu tulis unit test/);
    assert.equal(r.path, rootFile);
  });

  it('harus menemukan aturan dari .baiwor/rules/*.md', () => {
    const rulesDir = path.join(tmpDir, '.baiwor', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rulesDir, 'api-guidelines.md'),
      '---\ntitle: "Pedoman API"\n---\nValidasi input dengan zod.',
      'utf8'
    );

    const rules = discoverRules({ cwd: tmpDir, homeDir: tmpHome });
    assert.equal(rules.size, 1);
    const r = Array.from(rules.values())[0];
    assert.equal(r.title, 'Pedoman API');
    assert.equal(r.scope, 'project');
    assert.match(r.content, /Validasi input dengan zod/);
  });

  it('harus menemukan aturan global dan mengizinkan proyek meng-override aturan dengan nama sama', () => {
    // 1. Buat aturan global
    const globalDir = path.join(tmpHome, '.baiwor', 'rules');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, 'commit.md'),
      'Gunakan pesan commit format global.',
      'utf8'
    );
    fs.writeFileSync(
      path.join(globalDir, 'security.md'),
      'Jangan simpan token di repo.',
      'utf8'
    );

    // 2. Buat aturan proyek yang meng-override commit.md
    const projectDir = path.join(tmpDir, '.baiwor', 'rules');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'commit.md'),
      'Gunakan pesan commit format proyek lokal.',
      'utf8'
    );

    const rules = discoverRules({ cwd: tmpDir, homeDir: tmpHome });
    assert.equal(rules.size, 2);

    const commitRule = rules.get('commit');
    assert.ok(commitRule);
    assert.equal(commitRule.scope, 'project');
    assert.match(commitRule.content, /format proyek lokal/);

    const secRule = rules.get('security');
    assert.ok(secRule);
    assert.equal(secRule.scope, 'global');
    assert.match(secRule.content, /Jangan simpan token/);
  });

  it('harus mengembalikan Map kosong jika tidak ada aturan sama sekali', () => {
    const rules = discoverRules({ cwd: tmpDir, homeDir: tmpHome });
    assert.equal(rules.size, 0);
  });
});

describe('ruleManager: formatRulesPrompt', () => {
  it('harus mengembalikan string kosong untuk rules kosong', () => {
    assert.equal(formatRulesPrompt(null), '');
    assert.equal(formatRulesPrompt(new Map()), '');
    assert.equal(formatRulesPrompt([]), '');
  });

  it('harus memformat aturan menjadi teks prompt rapi', () => {
    const rules = [
      {
        name: 'test-rule',
        title: 'Aturan Pengujian',
        scope: 'project',
        path: '/workspace/BAIWORS.md',
        content: 'Jalankan npm test sebelum commit.',
      },
    ];

    const prompt = formatRulesPrompt(rules);
    assert.match(prompt, /Aturan Koding & Konvensi Proyek Lokal/);
    assert.match(prompt, /Aturan: Aturan Pengujian \(Proyek\)/);
    assert.match(prompt, /Jalankan npm test sebelum commit/);
    assert.match(prompt, /Sumber: `\/workspace\/BAIWORS\.md`/);
  });

  it('harus memotong teks jika melebihi batas maxChars', () => {
    const longContent = 'A'.repeat(500);
    const rules = [
      {
        name: 'long-rule',
        title: 'Aturan Panjang',
        scope: 'project',
        path: '/workspace/rules.md',
        content: longContent,
      },
    ];

    const prompt = formatRulesPrompt(rules, 150);
    assert.match(prompt, /Sisa aturan dipotong agar hemat konteks/);
  });
});

describe('ruleManager: integrasi getSystemPrompt', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-test-prompt-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('harus menyertakan aturan proyek di system prompt saat BAIWORS.md ada di workspace', () => {
    const origCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'BAIWORS.md'), 'Semua file harus pakai camelCase.', 'utf8');

      const sysPrompt = getSystemPrompt();
      assert.match(sysPrompt, /Aturan Koding & Konvensi Proyek Lokal/);
      assert.match(sysPrompt, /Semua file harus pakai camelCase/);
    } finally {
      process.chdir(origCwd);
    }
  });
});
