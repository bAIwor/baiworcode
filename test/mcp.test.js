import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  McpSession,
  loadMcpConfig,
  connectMcpServer,
  listActiveMcpSessions,
  disconnectAllMcpServers,
} from '../src/mcp/client.js';
import { startMcpServer } from '../src/mcp/server.js';
import { getDefinitions } from '../src/tools/index.js';

describe('MCP Client: Remote HTTP Transport', () => {
  let server;
  let port;

  before(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const json = JSON.parse(body || '{}');
        if (json.method === 'initialize') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('mcp-session-id', 'test-session-xyz');
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: json.id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'mock-mcp', version: '1.0.0' },
              },
            })
          );
        } else if (json.method === 'tools/list') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: json.id,
              result: {
                tools: [
                  {
                    name: 'echo',
                    description: 'Echoes back text',
                    inputSchema: {
                      type: 'object',
                      properties: { text: { type: 'string' } },
                    },
                  },
                ],
              },
            })
          );
        } else if (json.method === 'tools/call') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: json.id,
              result: {
                content: [{ type: 'text', text: `Echo: ${json.params?.arguments?.text}` }],
                isError: false,
              },
            })
          );
        } else {
          res.statusCode = 200;
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id || null, result: {} }));
        }
      });
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(() => {
    disconnectAllMcpServers();
    server.close();
  });

  it('terhubung ke server MCP remote, membaca tools, dan mengeksekusi tools/call', async () => {
    const session = await connectMcpServer('mock', {
      type: 'remote',
      url: `http://127.0.0.1:${port}`,
    });

    assert.equal(session.status, 'connected');
    assert.equal(session.sessionId, 'test-session-xyz');
    assert.equal(session.tools.length, 1);
    assert.equal(session.tools[0].name, 'echo');

    const callRes = await session.callTool('echo', { text: 'Halo Banyumas!' });
    assert.equal(callRes.success, true);
    assert.equal(callRes.output, 'Echo: Halo Banyumas!');

    const active = listActiveMcpSessions();
    assert.ok(active.some((s) => s.name === 'mock'));
  });
});

describe('MCP Client: Config Loader', () => {
  it('loadMcpConfig menyertakan TinyFish secara otomatis saat key tersedia', () => {
    const configs = loadMcpConfig();
    assert.ok(configs.tinyfish);
    assert.equal(configs.tinyfish.url, 'https://agent.tinyfish.ai/mcp');
    assert.ok(configs.tinyfish.headers?.['X-API-Key']);
  });
});

describe('MCP Server: Tools & Definitions', () => {
  it('menyediakan seluruh 15 tools bawaan bAIwor Code dalam format MCP', () => {
    const defs = getDefinitions();
    assert.equal(defs.length, 15);

    const mcpTools = defs.map((d) => ({
      name: d.function.name,
      description: d.function.description,
      inputSchema: d.function.parameters,
    }));

    assert.equal(mcpTools.length, 15);
    assert.ok(mcpTools.some((t) => t.name === 'read_file'));
    assert.ok(mcpTools.some((t) => t.name === 'write_file'));
    assert.ok(mcpTools.some((t) => t.name === 'websearch'));
    assert.ok(mcpTools.some((t) => t.name === 'webautomate'));
    assert.ok(mcpTools.some((t) => t.name === 'instabox_exec'));
  });
});
