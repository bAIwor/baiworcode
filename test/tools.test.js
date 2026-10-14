import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { TOOL_DEFINITIONS, executeTool } from '../src/tools/index.js';
import {
  handleReadFile,
  handleWriteFile,
  handleEditFile,
  handleListDirectory,
  handleRunCommand,
} from '../src/tools/handlers.js';
import { streamChatCompletion } from '../src/chat/client.js';

describe('Tahap 3B: Tool Definitions & Schemas', () => {
  it('harus memuat 5 tools utama dengan format OpenAI Function Calling', () => {
    assert.equal(Array.isArray(TOOL_DEFINITIONS), true);
    assert.equal(TOOL_DEFINITIONS.length, 5);

    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('write_file'));
    assert.ok(names.includes('edit_file'));
    assert.ok(names.includes('list_directory'));
    assert.ok(names.includes('run_command'));
  });
});

describe('Tahap 3B: File System Handlers', () => {
  const tmpDir = path.join(os.tmpdir(), `baiwor-test-${Date.now()}`);

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('harus dapat menulis berkas baru dan membuat subfolder otomatis (write_file)', async () => {
    const targetFile = path.join(tmpDir, 'nested', 'sub', 'test.txt');
    const res = await handleWriteFile({
      file_path: targetFile,
      content: 'Baris 1\nBaris 2\nBaris 3',
    });

    assert.equal(res.success, true);
    assert.ok(fs.existsSync(targetFile));
    assert.equal(fs.readFileSync(targetFile, 'utf8'), 'Baris 1\nBaris 2\nBaris 3');
  });

  it('harus dapat membaca berkas dengan penomoran baris (read_file)', async () => {
    const targetFile = path.join(tmpDir, 'read_test.txt');
    fs.writeFileSync(targetFile, 'Halo 1\nHalo 2\nHalo 3\nHalo 4\nHalo 5', 'utf8');

    const res = await handleReadFile({
      file_path: targetFile,
      offset: 2,
      limit: 2,
    });

    assert.equal(res.success, true);
    assert.ok(res.output.includes('2: Halo 2'));
    assert.ok(res.output.includes('3: Halo 3'));
    assert.ok(!res.output.includes('1: Halo 1'));
  });

  it('harus dapat mengedit potongan kode spesifik (edit_file)', async () => {
    const targetFile = path.join(tmpDir, 'edit_test.js');
    fs.writeFileSync(targetFile, 'const a = 1;\nconst b = 2;\nconsole.log(a + b);', 'utf8');

    const res = await handleEditFile({
      file_path: targetFile,
      old_content: 'const b = 2;',
      new_content: 'const b = 20;',
    });

    assert.equal(res.success, true);
    const updated = fs.readFileSync(targetFile, 'utf8');
    assert.equal(updated, 'const a = 1;\nconst b = 20;\nconsole.log(a + b);');
  });

  it('harus gagal jika old_content tidak ditemukan pada edit_file', async () => {
    const targetFile = path.join(tmpDir, 'edit_test.js');
    const res = await handleEditFile({
      file_path: targetFile,
      old_content: 'const tidak_ada = 999;',
      new_content: 'const baru = 0;',
    });

    assert.equal(res.success, false);
    assert.match(res.output, /tidak ditemukan/i);
  });

  it('harus dapat melihat isi direktori dan mengabaikan node_modules (list_directory)', async () => {
    const res = await handleListDirectory({ dir_path: tmpDir });
    assert.equal(res.success, true);
    assert.ok(res.output.includes('read_test.txt'));
  });

  it('harus dapat menjalankan perintah terminal (run_command)', async () => {
    const res = await handleRunCommand({
      command: 'node -e "console.log(\'bAIwor Agentik\')"',
    });

    assert.equal(res.success, true);
    assert.match(res.output, /bAIwor Agentik/);
  });
});

describe('Tahap 3B: Tool Dispatcher & JSON Argument Parser', () => {
  it('harus mengeksekusi tool via executeTool dengan string JSON argumen', async () => {
    const res = await executeTool('run_command', JSON.stringify({ command: 'node -e "console.log(12345)"' }));
    assert.equal(res.success, true);
    assert.match(res.output, /12345/);
  });

  it('harus mengembalikan error jika nama tool tidak dikenal', async () => {
    const res = await executeTool('unknown_magic_tool', {});
    assert.equal(res.success, false);
    assert.match(res.output, /tidak dikenal/i);
  });
});

describe('Tahap 3B: SSE Streaming Tool Calls Accumulation', () => {
  it('harus mengakumulasi potongan delta.tool_calls dari stream SSE', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      // Chunk 1: Inisialisasi function call
      res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_999","type":"function","function":{"name":"read_file","arguments":"{\\"file_pa"}}]}}]}\n\n');

      setTimeout(() => {
        // Chunk 2: Potongan argumen lanjutan
        res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"index.js\\"}"}}]}}]}\n\n');

        setTimeout(() => {
          // Chunk 3: Selesai
          res.write('data: [DONE]\n\n');
          res.end();
        }, 20);
      }, 20);
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const result = await streamChatCompletion({
      credentials: {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        headers: {},
        model: 'test-model',
      },
      messages: [{ role: 'user', content: 'baca file index.js' }],
      tools: TOOL_DEFINITIONS,
    });

    server.close();

    assert.equal(result.completed, true);
    assert.ok(result.tool_calls);
    assert.equal(result.tool_calls.length, 1);
    assert.equal(result.tool_calls[0].id, 'call_999');
    assert.equal(result.tool_calls[0].function.name, 'read_file');
    assert.equal(result.tool_calls[0].function.arguments, '{"file_path":"index.js"}');
  });
});
