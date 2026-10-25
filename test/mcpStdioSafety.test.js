import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsWindowsShell, assertSafeStdioSpec } from '../src/mcp/client.js';

test('needsWindowsShell hanya untuk shim .cmd/.bat yang dikenal di Windows', () => {
  assert.equal(needsWindowsShell('npx', 'win32'), true);
  assert.equal(needsWindowsShell('npm', 'win32'), true);
  assert.equal(needsWindowsShell('uvx', 'win32'), true);
  assert.equal(needsWindowsShell('node', 'win32'), false);
  assert.equal(needsWindowsShell('C:\\tools\\server.exe', 'win32'), false);
  assert.equal(needsWindowsShell('C:\\tools\\server.cmd', 'win32'), true);
  assert.equal(needsWindowsShell('npx', 'linux'), false);
});

test('assertSafeStdioSpec menolak command/argumen dengan karakter kontrol', () => {
  assert.doesNotThrow(() => assertSafeStdioSpec('npx', ['-y', '@modelcontextprotocol/server-filesystem', '.']));
  assert.throws(() => assertSafeStdioSpec('npx\nwhoami'), /karakter kontrol/i);
  assert.throws(() => assertSafeStdioSpec('npx', ['-y', 'pkg\rwhoami']), /karakter kontrol/i);
  assert.throws(() => assertSafeStdioSpec('npx', ['-y', 'pkg\0x']), /karakter kontrol/i);
  assert.throws(() => assertSafeStdioSpec('', []), /command wajib/i);
  assert.throws(() => assertSafeStdioSpec('npx', 'not-array'), /args harus/i);
});
