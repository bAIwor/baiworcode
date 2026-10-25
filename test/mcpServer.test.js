import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MCP_SAFE_TOOLS,
  isMcpDangerousAllowed,
  isMcpToolAllowed,
  filterMcpDefinitions,
} from '../src/mcp/server.js';
import { TOOL_DEFINITIONS } from '../src/tools/definitions.js';

const defs = TOOL_DEFINITIONS.map((d) => d);

describe('MCP Server: mode aman read-only', () => {
  it('mengizinkan tool read-only tanpa opt-in', () => {
    for (const name of ['read_file', 'list_directory', 'search_files', 'webfetch', 'websearch', 'todo_list']) {
      assert.equal(isMcpToolAllowed(name), true, name);
    }
  });

  it('memblokir tool tulis, terminal, dan aksi berisiko secara default', () => {
    for (const name of [
      'write_file',
      'edit_file',
      'patch_file',
      'run_command',
      'diagnostics',
      'delegate_task',
      'ask_user',
      'webautomate',
      'instabox_exec',
    ]) {
      assert.equal(isMcpToolAllowed(name), false, name);
    }
  });

  it('mengizinkan semua tool hanya bila operator opt-in', () => {
    assert.equal(isMcpToolAllowed('write_file', { allowDangerous: true }), true);
    assert.equal(isMcpToolAllowed('run_command', { allowDangerous: true }), true);
    assert.equal(isMcpToolAllowed('tool_tidak_dikenal', { allowDangerous: true }), true);
  });

  it('env BAIWOR_MCP_ALLOW_DANGEROUS mengikuti nilai true-ish', () => {
    for (const value of ['1', 'true', 'YES', 'on']) {
      assert.equal(
        isMcpDangerousAllowed({ BAIWOR_MCP_ALLOW_DANGEROUS: value }),
        true,
        value
      );
    }
    for (const value of ['', '0', 'false', 'tidak']) {
      assert.equal(
        isMcpDangerousAllowed({ BAIWOR_MCP_ALLOW_DANGEROUS: value }),
        false,
        value
      );
    }
  });

  it('tools/list menyaring definisi ke tool aman secara default', () => {
    const safe = filterMcpDefinitions(defs);
    assert.ok(safe.length > 0);
    assert.ok(safe.length < defs.length);
    for (const d of safe) {
      assert.ok(MCP_SAFE_TOOLS.has(d.function.name), d.function.name);
    }
  });

  it('tools/list mengembalikan semua definisi saat opt-in', () => {
    assert.equal(filterMcpDefinitions(defs, { allowDangerous: true }).length, defs.length);
  });

  it('seluruh tool safe memang terdaftar di definisi tool', () => {
    const names = new Set(defs.map((d) => d.function.name));
    for (const name of MCP_SAFE_TOOLS) {
      assert.ok(names.has(name), `Tool safe tidak terdefinisi: ${name}`);
    }
  });
});
