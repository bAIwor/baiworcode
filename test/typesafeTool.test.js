import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateTypeSafeRequest } from '../src/tools/typesafeTool.js';

const validQuestions = {
  destructive: {
    type: 'noul',
    instructions: 'Apakah perintah ini berpotensi menghapus data?',
  },
  intent: {
    type: 'choice',
    instructions: 'Apa niat utama perintah ini?',
    criteria: { build: 'Membangun proyek', cleanup: 'Membersihkan artefak' },
  },
  severity: {
    type: 'score',
    instructions: 'Seberapa berisiko dampaknya?',
    criteria: ['Aman', 'Sedang', 'Berisiko tinggi'],
  },
};

describe('TypeSafe tool: validasi request', () => {
  it('menerima kombinasi choice, score, dan noul yang valid', () => {
    assert.equal(validateTypeSafeRequest('rm -rf ./build', validQuestions), true);
  });

  it('menolak state kosong', () => {
    assert.throws(() => validateTypeSafeRequest('   ', validQuestions), /state/);
  });

  it('menolak state yang melebihi batas', () => {
    assert.throws(
      () => validateTypeSafeRequest('x'.repeat(30001), validQuestions),
      /state.*terlalu panjang/
    );
  });

  it('menolak type pertanyaan yang tidak dikenal', () => {
    assert.throws(
      () => validateTypeSafeRequest('teks', {
        q: { type: 'essay', instructions: 'Tulis esai' },
      }),
      /type harus salah satu/
    );
  });

  it('menolak choice tanpa minimal dua opsi', () => {
    assert.throws(
      () => validateTypeSafeRequest('teks', {
        q: { type: 'choice', instructions: 'Pilih', criteria: { satu: 'Hanya satu' } },
      }),
      /minimal 2 opsi/
    );
  });

  it('menolak questions yang bukan object', () => {
    assert.throws(
      () => validateTypeSafeRequest('teks', ['bukan', 'object']),
      /questions/
    );
  });
});
