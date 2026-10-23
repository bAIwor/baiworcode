import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registerTool, unregisterTool, getDefinitions } from '../src/tools/index.js';
import { filterToolsForAgentMode } from '../src/chat/planMode.js';

/**
 * Regresi: daftar tool yang dikirim ke provider harus diambil dari registry
 * (runtime), bukan dari konstanta statis TOOL_DEFINITIONS. Kalau konstanta
 * statis yang dipakai, tool MCP yang baru terhubung hanya muncul di system
 * prompt tanpa pernah dikirim sebagai function-calling — sehingga model yang
 * patuh tidak akan pernah memanggilnya.
 */

test('tool yang didaftarkan saat runtime muncul di definisi yang dikirim ke provider', () => {
  const nama = 'mcp_uji_server_cari';
  registerTool({
    name: nama,
    toolset: 'mcp',
    emoji: '🔌',
    schema: {
      description: 'Tool MCP uji',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: [],
      },
    },
    handler: async () => ({ success: true, output: 'ok' }),
  });

  try {
    const defs = getDefinitions();
    const found = defs.find((d) => d.function.name === nama);
    assert.ok(found, 'tool runtime harus ada di getDefinitions()');
    assert.equal(found.type, 'function');
    assert.equal(found.function.description, 'Tool MCP uji');

    // Mode build: seluruh tool (termasuk MCP) diteruskan ke provider.
    const build = filterToolsForAgentMode(defs, 'build');
    assert.ok(
      build.some((d) => d.function.name === nama),
      'tool MCP harus dikirim ke provider pada mode build'
    );

    // Mode plan: hanya tool read-only yang boleh ikut.
    const plan = filterToolsForAgentMode(defs, 'plan');
    assert.ok(
      !plan.some((d) => d.function.name === nama),
      'tool MCP tidak boleh otomatis lolos ke mode plan'
    );
  } finally {
    unregisterTool(nama);
  }
});

test('tool runtime yang dilepas kembali hilang dari definisi', () => {
  const nama = 'mcp_uji_server_lepas';
  registerTool({
    name: nama,
    toolset: 'mcp',
    schema: {
      description: 'Tool MCP uji yang akan dilepas',
      parameters: { type: 'object', properties: {} },
    },
    handler: async () => ({ success: true, output: 'ok' }),
  });

  assert.ok(getDefinitions().some((d) => d.function.name === nama));
  assert.equal(unregisterTool(nama), true);
  assert.ok(!getDefinitions().some((d) => d.function.name === nama));
});
