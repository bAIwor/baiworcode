import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleSearchFiles, globToRegExp } from '../src/tools/searchTool.js';
import { handleTodoList, resetTodoStore, todoStore } from '../src/tools/todoTool.js';
import { dispatchTool, listToolsets, getDefinitions } from '../src/tools/index.js';

describe('Tool search_files: pencarian isi berkas', () => {
  const tmpDir = path.join(os.tmpdir(), `baiwor-search-${Date.now()}`);

  before(() => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'nested'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'junk'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, 'src', 'alpha.js'),
      ['function hitTarget() {', '  return 1;', '}', 'const other = 2;'].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'nested', 'beta.js'),
      ['// hitTarget muncul di sini juga', 'module.exports = {};'].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'notes.md'), '# hitTarget dalam markdown\n');
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'junk', 'skip.js'), 'hitTarget diabaikan\n');
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('menemukan pola beserta nama berkas dan nomor baris', async () => {
    const res = await handleSearchFiles({ pattern: 'hitTarget', path: tmpDir });
    assert.equal(res.success, true);
    assert.match(res.output, /src[/\\]alpha\.js:1:/);
    assert.match(res.output, /src[/\\]nested[/\\]beta\.js:1:/);
  });

  it('mengabaikan node_modules', async () => {
    const res = await handleSearchFiles({ pattern: 'hitTarget', path: tmpDir });
    assert.equal(res.output.includes('node_modules'), false);
  });

  it('memfilter dengan file_glob', async () => {
    const res = await handleSearchFiles({ pattern: 'hitTarget', path: tmpDir, file_glob: '*.md' });
    assert.equal(res.success, true);
    assert.match(res.output, /notes\.md/);
    assert.equal(res.output.includes('alpha.js'), false);
  });

  it('memberi pesan ramah saat tidak ada kecocokan', async () => {
    const res = await handleSearchFiles({ pattern: 'zzz_tidak_ada_zzz', path: tmpDir });
    assert.equal(res.success, true);
    assert.match(res.output, /Tidak ada kecocokan/);
  });

  it('menolak pola regex yang tidak valid', async () => {
    const res = await handleSearchFiles({ pattern: '([unclosed', path: tmpDir });
    assert.equal(res.success, false);
    assert.match(res.output, /regex tidak valid/i);
  });

  it('menolak pencarian tanpa parameter pattern', async () => {
    const res = await handleSearchFiles({ path: tmpDir });
    assert.equal(res.success, false);
    assert.match(res.output, /pattern/);
  });

  it('tetap terikat sandbox: path di luar workspace ditolak', async () => {
    const res = await handleSearchFiles({ pattern: 'x', path: path.dirname(process.cwd()) });
    assert.equal(res.success, false);
    assert.match(res.output, /Akses ditolak/);
  });
});

describe('Tool search_files: pencarian nama berkas', () => {
  const tmpDir = path.join(os.tmpdir(), `baiwor-files-${Date.now()}`);

  before(() => {
    fs.mkdirSync(path.join(tmpDir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'lib', 'satu.test.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'lib', 'dua.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'catatan.txt'), '');
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('menemukan berkas berdasarkan pola glob', async () => {
    const res = await handleSearchFiles({ pattern: '*.test.js', target: 'files', path: tmpDir });
    assert.equal(res.success, true);
    assert.match(res.output, /satu\.test\.js/);
    assert.equal(res.output.includes('dua.js'), false);
  });

  it('globToRegExp mendukung * ? dan **', () => {
    assert.equal(globToRegExp('*.js').test('a.js'), true);
    assert.equal(globToRegExp('*.js').test('a.ts'), false);
    assert.equal(globToRegExp('src/*.js').test('src/a.js'), true);
    assert.equal(globToRegExp('a?.js').test('ab.js'), true);
    assert.equal(globToRegExp('**/*.js').test('src/deep/a.js'), true);
  });
});

describe('Tool todo_list: manajemen daftar tugas', () => {
  beforeEach(() => {
    resetTodoStore();
  });

  it('mengembalikan daftar kosong saat pertama dibaca', async () => {
    const res = await handleTodoList({});
    assert.equal(res.success, true);
    const data = JSON.parse(res.output);
    assert.deepEqual(data.todos, []);
    assert.equal(data.summary.total, 0);
  });

  it('menulis daftar tugas dan mengembalikan ringkasan status', async () => {
    const res = await handleTodoList({
      todos: [
        { id: '1', content: 'Baca struktur proyek', status: 'completed' },
        { id: '2', content: 'Tulis tool baru', status: 'in_progress' },
        { id: '3', content: 'Tulis test', status: 'pending' },
      ],
    });
    assert.equal(res.success, true);
    const data = JSON.parse(res.output);
    assert.equal(data.todos.length, 3);
    assert.equal(data.summary.completed, 1);
    assert.equal(data.summary.in_progress, 1);
    assert.equal(data.summary.pending, 1);
  });

  it('menaikkan revision setiap kali isi berubah', async () => {
    const pertama = JSON.parse((await handleTodoList({
      todos: [{ id: '1', content: 'A', status: 'pending' }],
    })).output);

    const kedua = JSON.parse((await handleTodoList({
      todos: [{ id: '1', content: 'A', status: 'completed' }],
    })).output);

    assert.ok(kedua.revision > pertama.revision);
  });

  it('merge memperbarui item berdasarkan id tanpa menghapus item lain', async () => {
    await handleTodoList({
      todos: [
        { id: '1', content: 'Langkah satu', status: 'pending' },
        { id: '2', content: 'Langkah dua', status: 'pending' },
      ],
    });

    const res = await handleTodoList({ todos: [{ id: '1', status: 'completed' }], merge: true });
    const data = JSON.parse(res.output);

    assert.equal(data.todos.length, 2);
    const satu = data.todos.find((t) => t.id === '1');
    assert.equal(satu.status, 'completed');
    assert.equal(satu.content, 'Langkah satu', 'content lama harus tetap utuh');
  });

  it('mengubah status tak dikenal menjadi pending', async () => {
    const res = await handleTodoList({ todos: [{ id: '1', content: 'A', status: 'ngawur' }] });
    const data = JSON.parse(res.output);
    assert.equal(data.todos[0].status, 'pending');
  });

  it('menolak item tanpa content', async () => {
    const res = await handleTodoList({ todos: [{ id: '1', content: '   ', status: 'pending' }] });
    assert.equal(res.success, false);
    assert.match(res.output, /content/i);
  });

  it('menolak argumen todos yang bukan array', async () => {
    const res = await handleTodoList({ todos: 'bukan array' });
    assert.equal(res.success, false);
    assert.match(res.output, /array/i);
  });

  it('menghapus parent yang menggantung', async () => {
    const res = await handleTodoList({
      todos: [
        { id: '1', content: 'Induk', status: 'pending' },
        { id: '2', content: 'Anak', status: 'pending', parent: '99' },
      ],
    });
    const data = JSON.parse(res.output);
    const anak = data.todos.find((t) => t.id === '2');
    assert.equal(anak.parent, undefined);
  });

  it('menyimpan satu item in_progress saja di urutan teratas', async () => {
    await handleTodoList({
      todos: [
        { id: '1', content: 'Pertama', status: 'pending' },
        { id: '2', content: 'Kedua', status: 'in_progress' },
      ],
    });
    assert.equal(todoStore.read()[0].status, 'in_progress');
  });
});

describe('Integrasi registry: kedua tool baru terdaftar', () => {
  it('search_files dan todo_list muncul di getDefinitions()', () => {
    const names = getDefinitions().map((d) => d.function.name);
    assert.ok(names.includes('search_files'));
    assert.ok(names.includes('todo_list'));
  });

  it('listToolsets menempatkan keduanya di toolset yang tepat', () => {
    const groups = listToolsets();
    assert.ok(groups.file.includes('search_files'));
    assert.ok(groups.todo.includes('todo_list'));
  });

  it('dispatchTool menjalankan search_files lewat registry', async () => {
    const res = await dispatchTool('search_files', JSON.stringify({
      pattern: 'handleSearchFiles',
      path: 'src/tools',
      file_glob: '*.js',
    }));
    assert.equal(res.success, true);
    assert.match(res.output, /searchTool\.js/);
  });
});
