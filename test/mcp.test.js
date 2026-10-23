import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  McpSession,
  loadMcpConfig,
  loadMcpConfigDetailed,
  connectMcpServer,
  listActiveMcpSessions,
  disconnectAllMcpServers,
  buildSafeMcpEnv,
  validateMcpUrl,
  resolveMcpSecrets,
  isValidMcpServerName,
  saveMcpServer,
  removeMcpServer,
  readMcpJson,
} from '../src/mcp/client.js';
import { startMcpServer } from '../src/mcp/server.js';
import { getDefinitions } from '../src/tools/index.js';
import {
  buatHomeSementara,
  envHome,
  bacaConfig,
  tulisConfig,
  hapusHome,
} from './tempHomeHelper.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO_ROOT, 'bin', 'baiwor.js');
const polos = (teks) => teks.replace(/\x1b\[[0-9;]*m/g, '');

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

    // Tool MCP diberi prefix agar tidak bisa menimpa tool bawaan.
    const toolNames = getDefinitions().map((d) => d.function.name);
    assert.ok(toolNames.includes('mcp_mock_echo'));
  });
});

describe('MCP Client: Config Loader', () => {
  it('loadMcpConfig menyertakan TinyFish secara otomatis saat key tersedia', () => {
    const sebelumnya = process.env.TINYFISH_API_KEY;
    process.env.TINYFISH_API_KEY = 'tf-test-key';
    try {
      const configs = loadMcpConfig();
      assert.ok(configs.tinyfish);
      assert.equal(configs.tinyfish.url, 'https://agent.tinyfish.ai/mcp');
      assert.equal(configs.tinyfish.headers?.['X-API-Key'], 'tf-test-key');
    } finally {
      if (sebelumnya === undefined) delete process.env.TINYFISH_API_KEY;
      else process.env.TINYFISH_API_KEY = sebelumnya;
    }
  });

  it('loadMcpConfigDetailed menandai konfigurasi proyek + hash-nya', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-mcp-'));
    try {
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify({ mcpServers: { proyek: { command: 'node', args: ['server.js'] } } })
      );
      const detail = loadMcpConfigDetailed(dir);
      assert.equal(detail.project.file, path.join(dir, '.mcp.json'));
      assert.equal(detail.project.hash.length, 64);
      assert.deepEqual(detail.project.servers.proyek, { command: 'node', args: ['server.js'] });
      assert.ok(detail.configs.proyek);
      assert.ok(!detail.globalConfigs.proyek);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('MCP Client: Hardening', () => {
  it('buildSafeMcpEnv hanya mewariskan variabel sistem dan env eksplisit', () => {
    const env = buildSafeMcpEnv(
      { CUSTOM_TOKEN: 'dari-config' },
      {
        PATH: '/usr/bin',
        HOME: '/home/uji',
        GEMINI_API_KEY: 'jangan-bocor',
        AWS_SECRET_ACCESS_KEY: 'jangan-bocor',
      }
    );
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.HOME, '/home/uji');
    assert.equal(env.CUSTOM_TOKEN, 'dari-config');
    assert.equal(env.GEMINI_API_KEY, undefined);
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  });

  it('validateMcpUrl menolak HTTP non-loopback dan menerima HTTPS/loopback', () => {
    assert.equal(validateMcpUrl('https://mcp.example.com/sse'), 'https://mcp.example.com/sse');
    assert.equal(validateMcpUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/');
    assert.equal(validateMcpUrl('http://localhost:3000/mcp'), 'http://localhost:3000/mcp');
    assert.throws(() => validateMcpUrl('http://mcp.example.com'), /HTTPS/);
    assert.throws(() => validateMcpUrl('file:///etc/passwd'), /tidak didukung/);
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

describe('MCP Client: Placeholder Rahasia ${VAR}', () => {
  it('mengganti ${VAR} di headers, env, dan args dengan isi environment', () => {
    const resolved = resolveMcpSecrets(
      {
        type: 'remote',
        url: 'https://mcp.agentmail.to/mcp',
        headers: { 'x-api-key': '${AGENTMAIL_API_KEY}' },
        env: { TOKEN: '${TOKEN}' },
        args: ['-y', '${PKG}'],
      },
      { AGENTMAIL_API_KEY: 'am_langgeng', TOKEN: 'tkn', PKG: '@acme/mcp' },
      'agentmail'
    );

    assert.equal(resolved.headers['x-api-key'], 'am_langgeng');
    assert.equal(resolved.env.TOKEN, 'tkn');
    assert.deepEqual(resolved.args, ['-y', '@acme/mcp']);
    assert.equal(resolved.url, 'https://mcp.agentmail.to/mcp');
  });

  it('memakai nilai cadangan ${VAR:-cadangan} saat variabel kosong', () => {
    const resolved = resolveMcpSecrets(
      { headers: { 'x-api-key': '${TIDAK_ADA:-am_cadangan}' } },
      { TIDAK_ADA: '' },
      'demo'
    );
    assert.equal(resolved.headers['x-api-key'], 'am_cadangan');
  });

  it('menyebut nama variabel yang kosong agar pengguna tahu harus mengisi apa', () => {
    assert.throws(
      () => resolveMcpSecrets({ headers: { 'x-api-key': '${KEKURANG_KEY}' } }, {}, 'agentmail'),
      /agentmail.*KEKURANG_KEY/s
    );
  });

  it('mengembalikan salinan tanpa mengubah konfigurasi asli', () => {
    const asli = { headers: { 'x-api-key': '${K}' } };
    resolveMcpSecrets(asli, { K: 'isi' }, 'demo');
    assert.equal(asli.headers['x-api-key'], '${K}');
  });

  it('McpSession menolak konfigurasi saat variabelnya belum diisi', () => {
    delete process.env.DEMO_KEY_BAIWOR;
    assert.throws(
      () =>
        new McpSession('demo', {
          type: 'remote',
          url: 'https://example.com/mcp',
          headers: { 'x-api-key': '${DEMO_KEY_BAIWOR}' },
        }),
      /DEMO_KEY_BAIWOR/
    );
  });

  it('McpSession memakai nilai environment ketika tersedia', () => {
    process.env.DEMO_KEY_BAIWOR = 'am_langgeng';
    try {
      const session = new McpSession('demo', {
        type: 'remote',
        url: 'https://example.com/mcp',
        headers: { 'x-api-key': '${DEMO_KEY_BAIWOR}' },
      });
      assert.equal(session.config.headers['x-api-key'], 'am_langgeng');
    } finally {
      delete process.env.DEMO_KEY_BAIWOR;
    }
  });
});

describe('MCP Client: Wizard Simpan & Lepas Server', () => {
  it('nama server divalidasi sebelum dipakai sebagai prefix tool', () => {
    assert.equal(isValidMcpServerName('agentmail'), true);
    assert.equal(isValidMcpServerName('Agent_Mail-2'), true);
    assert.equal(isValidMcpServerName('email masuk'), false);
    assert.equal(isValidMcpServerName('1mail'), false);
    assert.equal(isValidMcpServerName(''), false);
  });

  it('saveMcpServer & removeMcpServer menulis konfigurasi global tanpa entri lain hilang', () => {
    const home = buatHomeSementara();
    try {
      tulisConfig(home, { mcpServers: { lama: { type: 'remote', url: 'https://lama.example.com/mcp' } } });

      const script = `
        import { saveMcpServer, removeMcpServer } from ${JSON.stringify(
          pathToFileURL(path.join(REPO_ROOT, 'src', 'mcp', 'client.js')).href
        )};
        saveMcpServer('agentmail', { type: 'remote', url: 'https://mcp.agentmail.to/mcp', headers: { 'x-api-key': '\${AGENTMAIL_API_KEY}' } });
        removeMcpServer('lama');
        saveMcpServer('Nama Salah Satu', {});
      `;
      // Nama terakhir invalid → harus berhenti dengan pesan jelas.
      assert.throws(
        () =>
          execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            encoding: 'utf8',
            env: envHome(home),
            timeout: 90_000,
          }),
        /tidak valid/
      );

      const config = bacaConfig(home);
      assert.deepEqual(config.mcpServers.agentmail, {
        type: 'remote',
        url: 'https://mcp.agentmail.to/mcp',
        headers: { 'x-api-key': '${AGENTMAIL_API_KEY}' },
      });
      assert.equal(config.mcpServers.lama, undefined, 'entri lama harus terhapus');
    } finally {
      hapusHome(home);
    }
  });
});

describe('CLI: /mcp add & /mcp remove & status', () => {
  const jalankan = (perintah, home) =>
    polos(
      execFileSync(process.execPath, [BIN], {
        input: `${perintah}\n`,
        encoding: 'utf8',
        timeout: 90_000,
        env: envHome(home),
      })
    );

  it('/mcp tanpa argumen di non-TTY menampilkan ringkasan server konfigurasi', () => {
    const home = buatHomeSementara();
    try {
      tulisConfig(home, {
        mcpServers: {
          testserv: {
            type: 'remote',
            url: 'https://mcp.test.com/mcp',
          },
        },
      });
      const out = jalankan('/mcp', home);
      assert.match(out, /Model Context Protocol/);
      assert.match(out, /testserv/);
    } finally {
      hapusHome(home);
    }
  });

  it('/mcp list menampilkan status ringkas tanpa muntahan ratusan tools', () => {
    const home = buatHomeSementara();
    try {
      tulisConfig(home, {
        mcpServers: {
          demo: {
            type: 'remote',
            url: 'https://demo.example.com',
          },
        },
      });
      const out = jalankan('/mcp list', home);
      assert.match(out, /demo/);
      assert.match(out, /Tidak terhubung/);
    } finally {
      hapusHome(home);
    }
  });

  it('CLI menormalkan "baiworcode /mcp" sehingga tidak masuk ke prompt obrolan AI', () => {
    const home = buatHomeSementara();
    try {
      const out = polos(
        execFileSync(process.execPath, [BIN, '/mcp'], {
          encoding: 'utf8',
          timeout: 15_000,
          env: envHome(home),
        })
      );
      assert.match(out, /Model Context Protocol/);
      assert.doesNotMatch(out, /How can I help you/);
    } finally {
      hapusHome(home);
    }
  });

  it('/mcp add tanpa TTY memberi panduan konfigurasi manual', () => {
    const home = buatHomeSementara();
    try {
      const out = jalankan('/mcp add', home);
      assert.match(out, /terminal interaktif/);
      assert.match(out, /mcpServers/);
      assert.match(out, /\$\{AGENTMAIL_API_KEY\}/);
    } finally {
      hapusHome(home);
    }
  });

  it('/mcp remove melaporkan bila konfigurasi global masih kosong', () => {
    const home = buatHomeSementara();
    try {
      const out = jalankan('/mcp remove', home);
      assert.match(out, /Belum ada MCP server di konfigurasi global/);
    } finally {
      hapusHome(home);
    }
  });
});

describe('MCP Client: Balasan SSE (Tavily & Firecrawl)', () => {
  const buatResponse = (body, contentType) =>
    new Response(body, { status: 200, headers: { 'content-type': contentType } });

  it('mengurai balasan bingkai SSE "event: message" + "data: {...}"', async () => {
    const res = buatResponse(
      'event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"tools":[{"name":"tavily_search"}]}}\n\n',
      'text/event-stream'
    );
    const data = await readMcpJson(res);
    assert.equal(data.result.tools[0].name, 'tavily_search');
  });

  it('mengabaikan notifikasi dan mengambil jawaban permintaan', async () => {
    const res = buatResponse(
      [
        'event: message',
        'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}',
        '',
        'event: message',
        'data: {"jsonrpc":"2.0","id":4,"result":{"tools":[]}}',
        '',
        '',
      ].join('\n'),
      'text/event-stream; charset=utf-8'
    );
    const data = await readMcpJson(res);
    assert.equal(data.id, 4);
  });

  it('tetap membaca JSON biasa seperti server lain', async () => {
    const res = buatResponse('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}', 'application/json');
    assert.equal((await readMcpJson(res)).id, 1);
  });

  it('menggabungkan satu peristiwa yang terpecah ke beberapa baris data', async () => {
    const res = buatResponse(
      'event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":9,"result":{"ok":true}}\n\n',
      'text/event-stream'
    );
    assert.equal((await readMcpJson(res)).result.ok, true);
  });

  it('memberi pesan jelas bila balasan bukan JSON maupun SSE', async () => {
    const res = buatResponse('<html>login dulu</html>', 'text/html');
    await assert.rejects(() => readMcpJson(res), /tidak dapat dibaca/);
  });

  it('server remote yang membalas SSE bisa dihubungi penuh', async () => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body || '{}');
        res.setHeader('Content-Type', 'text/event-stream');
        const payload =
          json.method === 'tools/list'
            ? { result: { tools: [{ name: 'firecrawl_scrape', description: 'Scrape', inputSchema: { type: 'object' } }] } }
            : { result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'sse-mock', version: '1' } } };
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: json.id, ...payload })}\n\n`);
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      const session = await connectMcpServer('sse-mock', {
        type: 'remote',
        url: `http://127.0.0.1:${port}`,
        headers: { Authorization: 'Bearer fc-uji' },
      });
      assert.equal(session.status, 'connected');
      assert.deepEqual(session.tools.map((t) => t.name), ['firecrawl_scrape']);
    } finally {
      disconnectAllMcpServers();
      srv.close();
    }
  });
});

describe('MCP Client: Tavily & Firecrawl Bawaan', () => {
  it('terdaftar otomatis sebagai remote MCP saat API key tersedia', () => {
    const sebelumnya = { ...process.env };
    process.env.TAVILY_API_KEY = 'tvly-UJI-123';
    process.env.FIRECRAWL_API_KEY = 'fc-UJI-456';
    try {
      const configs = loadMcpConfig();
      assert.equal(configs.tavily.url, 'https://mcp.tavily.com/mcp/');
      assert.equal(configs.tavily.headers.Authorization, 'Bearer tvly-UJI-123');
      assert.equal(configs.firecrawl.url, 'https://mcp.firecrawl.dev/v2/mcp');
      assert.equal(configs.firecrawl.headers.Authorization, 'Bearer fc-UJI-456');
    } finally {
      process.env = sebelumnya;
    }
  });

  it('tidak didaftarkan saat kunci kosong', () => {
    const home = buatHomeSementara();
    try {
      const script = `
        import assert from 'node:assert/strict';
        import { loadMcpConfig } from ${JSON.stringify(
          pathToFileURL(path.join(REPO_ROOT, 'src', 'mcp', 'client.js')).href
        )};
        delete process.env.TAVILY_API_KEY;
        delete process.env.FIRECRAWL_API_KEY;
        const configs = loadMcpConfig();
        assert.equal(configs.tavily, undefined, 'tanpa kunci, tavily tidak boleh muncul');
        assert.equal(configs.firecrawl, undefined, 'tanpa kunci, firecrawl tidak boleh muncul');
      `;
      execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
        env: envHome(home),
        timeout: 90_000,
      });
    } finally {
      hapusHome(home);
    }
  });
});
