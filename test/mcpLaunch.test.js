import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveMcpLaunchMode } from '../src/mcp/launchMode.js';

/* ------------------------------------------------------------------ *
 * Mode peluncuran perintah `baiworcode mcp`
 * ------------------------------------------------------------------ */

test('resolveMcpLaunchMode menjalankan server stdio untuk klien MCP eksternal', () => {
  // Klien stdio menutup stdin & stdout dengan pipe.
  const mode = resolveMcpLaunchMode({
    wantsServe: false,
    action: undefined,
    stdinIsTty: false,
    stdoutIsTty: false,
    wasSlashMcp: false,
  });
  assert.equal(mode, 'serve');
});

test('resolveMcpLaunchMode tidak menggantung saat stdin di-pipe tetapi stdout terminal', () => {
  // Regresi: script/CI seperti `echo | baiworcode mcp` sebelumnya dianggap
  // klien dan menggantung sebagai server stdio.
  const mode = resolveMcpLaunchMode({
    wantsServe: false,
    action: undefined,
    stdinIsTty: false,
    stdoutIsTty: true,
    wasSlashMcp: false,
  });
  assert.equal(mode, 'manage');
});

test('resolveMcpLaunchMode memakai mode kelola saat dijalankan dari terminal interaktif', () => {
  const mode = resolveMcpLaunchMode({
    wantsServe: false,
    action: undefined,
    stdinIsTty: true,
    stdoutIsTty: true,
    wasSlashMcp: false,
  });
  assert.equal(mode, 'manage');
});

test('resolveMcpLaunchMode menghormati permintaan eksplisit --serve dan subperintah serve', () => {
  assert.equal(
    resolveMcpLaunchMode({ wantsServe: true, stdinIsTty: true, stdoutIsTty: true }),
    'serve'
  );
  assert.equal(
    resolveMcpLaunchMode({ action: 'serve', stdinIsTty: true, stdoutIsTty: true }),
    'serve'
  );
  assert.equal(
    resolveMcpLaunchMode({ action: 'server', stdinIsTty: true, stdoutIsTty: true }),
    'serve'
  );
});

test('resolveMcpLaunchMode memperlakukan `/mcp` sebagai perintah kelola, bukan server', () => {
  const mode = resolveMcpLaunchMode({
    wantsServe: false,
    action: undefined,
    stdinIsTty: false,
    stdoutIsTty: false,
    wasSlashMcp: true,
  });
  assert.equal(mode, 'manage');
});

test('resolveMcpLaunchMode tidak pernah menjadi server bila ada subperintah eksplisit', () => {
  const mode = resolveMcpLaunchMode({
    wantsServe: false,
    action: 'list',
    stdinIsTty: false,
    stdoutIsTty: false,
    wasSlashMcp: false,
  });
  assert.equal(mode, 'manage');
});
