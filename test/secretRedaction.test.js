import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { redactSecretsInText } from '../src/security/secretDetector.js';
import {
  getProjectSessionDir,
  saveSession,
  appendSessionMessage,
  redactMessageForStorage,
} from '../src/chat/sessionManager.js';

describe('Redaksi secret di session log', () => {
  it('menyensor generic API key tanpa menghapus nama field', () => {
    const out = redactSecretsInText('config: api_key = "abcdefghijklmnopqrstuvwx"');
    assert.ok(!out.includes('abcdefghijklmnopqrstuvwx'));
    assert.match(out, /\[REDACTED\]/);
    assert.match(out, /api_key/);
  });

  it('menyensor AWS access key, GitHub token, JWT, dan private key', () => {
    const aws = 'AKIAABCDEFGHIJKLMNOP';
    const gh = `ghp_${'a'.repeat(36)}`;
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature';
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEsecret\n-----END RSA PRIVATE KEY-----';
    const out = redactSecretsInText(`aws=${aws}\ngh=${gh}\njwt=${jwt}\n${pem}`);

    assert.ok(!out.includes(aws));
    assert.ok(!out.includes(gh));
    assert.ok(!out.includes(jwt));
    assert.ok(!out.includes('MIIEsecret'));
    assert.match(out, /REDACTED/);
  });

  it('tidak mengubah teks normal', () => {
    const text = 'jalankan npm test lalu baca src/chat/index.js';
    assert.equal(redactSecretsInText(text), text);
  });

  it('menyensor content dan argument tool_calls secara valid JSON', () => {
    const secret = 'abcdefghijklmnopqrstuvwx';
    const stored = redactMessageForStorage({
      role: 'assistant',
      content: `api_key = "${secret}"`,
      tool_calls: [
        {
          function: {
            name: 'write_file',
            arguments: JSON.stringify({ path: '.env', content: `API_KEY=${secret}` }),
          },
        },
      ],
    });

    assert.ok(!JSON.stringify(stored).includes(secret));
    assert.doesNotThrow(() => JSON.parse(stored.tool_calls[0].function.arguments));
  });

  it('menyensor saat saveSession & appendSessionMessage tanpa mengubah objek di memori', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-redact-base-'));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-redact-project-'));
    const secret = 'abcdefghijklmnopqrstuvwx';
    const userMessage = { role: 'user', content: `api_key = "${secret}"` };

    try {
      const id = 'redact-test-session';
      saveSession({ id, messages: [userMessage] }, { projectPath: project, baseConfigDir: base });
      const filePath = path.join(getProjectSessionDir(project, base), `${id}.jsonl`);
      const raw = fs.readFileSync(filePath, 'utf8');

      assert.ok(!raw.includes(secret));
      assert.match(raw, /\[REDACTED\]/);
      assert.equal(userMessage.content, `api_key = "${secret}"`);

      appendSessionMessage(
        id,
        { role: 'tool', name: 'read_file', content: `token = "${secret}"` },
        { projectPath: project, baseConfigDir: base }
      );
      const raw2 = fs.readFileSync(filePath, 'utf8');
      assert.ok(!raw2.includes(secret));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
