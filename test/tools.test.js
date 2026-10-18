import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {
  TOOL_DEFINITIONS,
  executeTool,
  capToolOutput,
  registerTool,
  getDefinitions,
  listToolsets,
  handleSearchFiles,
  isHomeDirectory,
  resolveCommandTimeout,
  defaultReportsDir,
} from '../src/tools/index.js';
import {
  handleReadFile,
  handleWriteFile,
  handleEditFile,
  handleListDirectory,
  handleRunCommand,
} from '../src/tools/handlers.js';
import { streamChatCompletion } from '../src/chat/client.js';
import { detectRiskyRegex } from '../src/tools/searchTool.js';
import { setApprovalHandler, resetApprovalHandler } from '../src/tools/approval.js';

describe('Tahap 3B: Tool Definitions & Schemas', () => {
  it('harus memuat 14 tools utama dengan format OpenAI Function Calling', () => {
    assert.equal(Array.isArray(TOOL_DEFINITIONS), true);
    assert.equal(TOOL_DEFINITIONS.length, 14);

    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('write_file'));
    assert.ok(names.includes('edit_file'));
    assert.ok(names.includes('patch_file'));
    assert.ok(names.includes('list_directory'));
    assert.ok(names.includes('run_command'));
    assert.ok(names.includes('search_files'));
    assert.ok(names.includes('todo_list'));
    assert.ok(names.includes('webfetch'));
    assert.ok(names.includes('websearch'));
    assert.ok(names.includes('webautomate'));
    assert.ok(names.includes('diagnostics'));
    assert.ok(names.includes('delegate_task'));
    assert.ok(names.includes('ask_user'));
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

  it('read_file harus membuang \\r pada berkas berakhiran CRLF', async () => {
    const targetFile = path.join(tmpDir, 'crlf_read.txt');
    fs.writeFileSync(targetFile, 'Baris A\r\nBaris B\r\n', 'utf8');

    const res = await handleReadFile({ file_path: targetFile });

    assert.equal(res.success, true);
    assert.ok(res.output.includes('1: Baris A'));
    assert.ok(res.output.includes('2: Baris B'));
    assert.equal(res.output.includes('\r'), false, 'output read_file tidak boleh menyisakan \\r');
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

  it('edit_file harus mempertahankan akhir baris CRLF berkas', async () => {
    const targetFile = path.join(tmpDir, 'crlf_test.js');
    fs.writeFileSync(targetFile, 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;\r\n', 'utf8');

    // old_content memakai LF (seperti keluaran model) sehingga memicu jalur normalisasi.
    const res = await handleEditFile({
      file_path: targetFile,
      old_content: 'const a = 1;\nconst b = 2;',
      new_content: 'const a = 1;\nconst b = 42;',
    });

    assert.equal(res.success, true);
    const updated = fs.readFileSync(targetFile, 'utf8');
    assert.equal(updated, 'const a = 1;\r\nconst b = 42;\r\nconst c = 3;\r\n');
    assert.equal((updated.match(/(?<!\r)\n/g) || []).length, 0, 'tidak boleh menyisakan LF telanjang');
  });

  it('edit_file harus menulis new_content apa adanya walau memuat $& dan $1', async () => {
    const targetFile = path.join(tmpDir, 'dollar_test.js');
    fs.writeFileSync(targetFile, 'const x = 1;\n', 'utf8');

    const res = await handleEditFile({
      file_path: targetFile,
      old_content: 'const x = 1;',
      new_content: 'const y = "$& $1 $` $$";',
    });

    assert.equal(res.success, true);
    const updated = fs.readFileSync(targetFile, 'utf8');
    assert.equal(updated, 'const y = "$& $1 $` $$";\n');
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

  it('harus dapat menjalankan perintah chained dengan && di semua sistem operasi (F3)', async () => {
    const res = await handleRunCommand({
      command: 'node -e "console.log(\'STEP_A\')" && node -e "console.log(\'STEP_B\')"',
    });

    assert.equal(res.success, true);
    assert.match(res.output, /STEP_A/);
    assert.match(res.output, /STEP_B/);
  });

  it('harus menolak akses ke berkas di luar workspace (F1 Sandbox)', async () => {
    // Jalur di luar workspace dan di luar tmpdir
    const outsidePath = path.resolve(process.cwd(), '..', '..', 'arbitrary_outside_file.txt');
    const res = await handleReadFile({ file_path: outsidePath });

    assert.equal(res.success, false);
    assert.match(res.output, /Akses ditolak/i);
    assert.match(res.output, /luar direktori workspace/i);
  });

  it('harus menolak akses ke berkas/direktori sensitif .baiwor atau .ssh (F1)', async () => {
    const sensitiveFile = path.join(os.homedir(), '.baiwor', 'config.json');
    const res = await handleReadFile({ file_path: sensitiveFile });

    assert.equal(res.success, false);
    assert.match(res.output, /Akses ditolak/i);
    assert.match(res.output, /sensitif/i);
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

  it('harus memotong output yang melebihi batas budget karakter (A2/F5)', () => {
    // Direktori spill dikarahkan ke folder sementara supaya PENGUJIAN tidak
    // meninggalkan file sampah 50 KB di ~/.baiwor/reports milik pengguna.
    const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-spill-'));
    try {
      const hugeText = 'X'.repeat(50000);
      const capped = capToolOutput(hugeText, 40000, { reportsDir: spillDir });

      assert.ok(capped.length < 50000);
      assert.match(capped, /Output dipotong: 10000 karakter melebihi budget context/);
      // Output lengkap tetap tersimpan — tapi di folder uji, bukan di home pengguna.
      assert.equal(fs.readdirSync(spillDir).length, 1, 'spill harus ditulis ke folder uji');
      assert.equal(capToolOutput('pendek', 40000, { reportsDir: spillDir }), 'pendek');
      assert.equal(fs.readdirSync(spillDir).length, 1, 'output pendek tidak boleh menulis spill');
    } finally {
      fs.rmSync(spillDir, { recursive: true, force: true });
    }
  });

  it('harus mendukung pendaftaran tool baru via registerTool (F4)', async () => {
    registerTool({
      name: 'hitung_kuadrat',
      toolset: 'math',
      schema: {
        description: 'Menghitung kuadrat angka',
        parameters: {
          type: 'object',
          properties: { n: { type: 'number' } },
          required: ['n'],
        },
      },
      handler: async ({ n }) => {
        return { success: true, output: `Hasil: ${n * n}` };
      },
    });

    const res = await executeTool('hitung_kuadrat', JSON.stringify({ n: 7 }));
    assert.equal(res.success, true);
    assert.match(res.output, /Hasil: 49/);
  });

  it('harus menyaring tool dengan check_fn yang bernilai false saat getDefinitions()', () => {
    registerTool({
      name: 'tool_rahasia_nonaktif',
      toolset: 'secret',
      schema: { description: 'Tool rahasia' },
      handler: async () => ({ success: true, output: 'ok' }),
      check: () => false, // probe gagal
    });

    const defs = getDefinitions();
    const found = defs.some((d) => d.function.name === 'tool_rahasia_nonaktif');
    assert.equal(found, false);
  });

  it('harus mengelompokkan toolsets dengan listToolsets()', () => {
    const sets = listToolsets();
    assert.ok(Array.isArray(sets.file));
    assert.ok(sets.file.includes('read_file'));
    assert.ok(Array.isArray(sets.terminal));
    assert.ok(sets.terminal.includes('run_command'));
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

describe('Tahap 5: Human-in-the-Loop Command Approval Gate', () => {
  after(() => {
    resetApprovalHandler();
  });

  it('harus mengeksekusi perintah confirm jika pengguna menyetujui', async () => {
    setApprovalHandler(async () => ({ approved: true }));

    const res = await handleRunCommand({ command: 'npm publish --dry-run' });
    assert.equal(res.success, true);
    assert.match(res.output, /baiworcode/i);
  });

  it('harus menolak eksekusi dan mengembalikan alasan jika pengguna menolak', async () => {
    setApprovalHandler(async (cmd) => ({
      approved: false,
      message: `Perintah '${cmd}' dibatalkan oleh pengguna (butuh konfirmasi).`,
    }));

    const res = await handleRunCommand({ command: 'git push origin main' });
    assert.equal(res.success, false);
    assert.match(res.output, /dibatalkan oleh pengguna/i);
    assert.match(res.output, /butuh konfirmasi/i);
  });

  it('harus otomatis membatalkan dan tidak menggantung saat mode non-TTY', async () => {
    resetApprovalHandler(); // Menguji perilaku riil saat non-TTY

    // Pasang batas timer 2 detik untuk memastikan tidak menggantung
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT: approval gate menggantung di mode non-TTY!')), 2000)
    );

    const execPromise = handleRunCommand({ command: 'git push origin main' });
    const res = await Promise.race([execPromise, timeoutPromise]);

    assert.equal(res.success, false);
    assert.match(res.output, /dibatalkan otomatis/i);
    assert.match(res.output, /non-TTY/i);
  });
});

describe('search_files: pengaman ReDoS', () => {
  it('menandai pola berbahaya dan meloloskan pola wajar', () => {
    assert.ok(detectRiskyRegex('(a+)+'));
    assert.ok(detectRiskyRegex('(.*)*'));
    assert.ok(detectRiskyRegex('(\\d+)+'));
    assert.ok(detectRiskyRegex('.*.*'));
    assert.equal(detectRiskyRegex('function\\s+\\w+'), null);
    assert.equal(detectRiskyRegex('(foo|bar)+'), null);
    assert.equal(detectRiskyRegex('TODO'), null);
  });

  it('handleSearchFiles menolak pola berbahaya dengan pesan jelas', async () => {
    const res = await handleSearchFiles({ pattern: '(a+)+', path: '.' });
    assert.equal(res.success, false);
    assert.match(res.output, /ditolak/i);
  });
});

describe('Penjaga workspace = direktori HOME', () => {
  it('isHomeDirectory mengenali home dan menolak jalur lain', () => {
    assert.equal(isHomeDirectory(os.homedir()), true);
    assert.equal(isHomeDirectory(path.join(os.homedir(), 'baiworcode')), false);
    assert.equal(isHomeDirectory(os.tmpdir()), false);
  });

  it('search_files tidak menelusuri direktori berisik milik home (AppData, .npm, ...)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-ignore-'));
    try {
      fs.mkdirSync(path.join(root, 'AppData'));
      fs.writeFileSync(path.join(root, 'AppData', 'rahasia.txt'), 'x');
      fs.mkdirSync(path.join(root, '.npm'));
      fs.writeFileSync(path.join(root, '.npm', 'cache.txt'), 'x');
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(path.join(root, 'src', 'app.txt'), 'x');

      const res = await handleSearchFiles({ target: 'files', pattern: '*.txt', path: root });
      assert.equal(res.success, true);
      assert.match(res.output, /app\.txt/);
      assert.doesNotMatch(res.output, /rahasia\.txt/);
      assert.doesNotMatch(res.output, /cache\.txt/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('run_command: batas waktu yang bisa dikonfigurasi', () => {
  it('memakai bawaan 60 detik bila tidak ada permintaan khusus', () => {
    assert.equal(resolveCommandTimeout(null, {}), 60000);
    assert.equal(resolveCommandTimeout(undefined, {}), 60000);
  });

  it('menghormati env BAIWOR_RUN_COMMAND_TIMEOUT_MS dan mengabaikan nilai tak valid', () => {
    assert.equal(resolveCommandTimeout(null, { BAIWOR_RUN_COMMAND_TIMEOUT_MS: '300000' }), 300000);
    assert.equal(resolveCommandTimeout(null, { BAIWOR_RUN_COMMAND_TIMEOUT_MS: 'abc' }), 60000);
    assert.equal(resolveCommandTimeout(null, { BAIWOR_RUN_COMMAND_TIMEOUT_MS: '-5' }), 60000);
  });

  it('argumen timeout_ms menang atas env, tapi tetap dijepit ke rentang aman', () => {
    assert.equal(resolveCommandTimeout(120000, { BAIWOR_RUN_COMMAND_TIMEOUT_MS: '30000' }), 120000);
    // Terlalu kecil → dinaikkan ke 1 detik; terlalu besar → dipotong ke 10 menit.
    assert.equal(resolveCommandTimeout(10, {}), 1000);
    assert.equal(resolveCommandTimeout(99999999, {}), 600000);
  });

  it('timeout_ms muncul di skema run_command agar model tahu cara memakainya', () => {
    const def = TOOL_DEFINITIONS.find((t) => t.function.name === 'run_command');
    assert.ok(def.function.parameters.properties.timeout_ms);
    assert.match(def.function.parameters.properties.timeout_ms.description, /600000/);
  });
});

describe('capToolOutput: tujuan spill bisa dikarahkan (isolasi pengujian)', () => {
  it('menghormati env BAIWOR_REPORTS_DIR', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-envdir-'));
    const before = process.env.BAIWOR_REPORTS_DIR;
    try {
      process.env.BAIWOR_REPORTS_DIR = dir;
      assert.equal(defaultReportsDir(), dir);
    } finally {
      if (before === undefined) delete process.env.BAIWOR_REPORTS_DIR;
      else process.env.BAIWOR_REPORTS_DIR = before;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

