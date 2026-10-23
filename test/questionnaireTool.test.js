import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleAskUser,
  setQuestionnaireHandler,
  resetQuestionnaireHandler,
} from '../src/tools/questionnaireTool.js';
import { executeTool } from '../src/tools/index.js';

describe('Interactive Questionnaire Widget (ask_user)', () => {
  beforeEach(() => {
    resetQuestionnaireHandler();
  });

  afterEach(() => {
    resetQuestionnaireHandler();
  });

  it('harus menolak bila pertanyaan kosong', async () => {
    const res = await handleAskUser({
      question: '',
      options: ['Opsi A', 'Opsi B'],
    });

    assert.equal(res.success, false);
    assert.ok(res.output.includes('Parameter "question" wajib diisi'));
  });

  it('harus menolak bila options kosong atau bukan array', async () => {
    const res = await handleAskUser({
      question: 'Pilih opsi:',
      options: [],
    });

    assert.equal(res.success, false);
    assert.ok(res.output.includes('minimal 1 pilihan jawaban'));
  });

  it('harus menolak di lingkungan non-TTY alih-alih memalsukan jawaban', async () => {
    // Di lingkungan pengujian otomatis (biasanya non-TTY) tidak ada manusia
    // yang bisa menjawab. Tool TIDAK boleh memalsukan jawaban atas nama
    // pengguna — ia harus menolak dan menyuruh operator opting-in.
    const res = await handleAskUser({
      question: 'Pilih format basis data:',
      options: ['SQLite', 'PostgreSQL', 'MySQL'],
      default_option: 'PostgreSQL',
    });

    assert.equal(res.success, false);
    assert.equal(res.answer, undefined);
    assert.ok(res.output.includes('non-TTY'));
    assert.ok(res.output.includes('BAIWOR_ASK_USER_AUTO'));
  });

  it('harus memakai jawaban otomatis bila operator opting-in lewat env', async () => {
    const previous = process.env.BAIWOR_ASK_USER_AUTO;
    process.env.BAIWOR_ASK_USER_AUTO = '1';
    try {
      const res = await handleAskUser({
        question: 'Pilih format basis data:',
        options: ['SQLite', 'PostgreSQL', 'MySQL'],
        default_option: 'PostgreSQL',
      });

      assert.equal(res.success, true);
      assert.equal(res.answer, 'PostgreSQL');
      assert.ok(res.output.includes('PostgreSQL'));
    } finally {
      if (previous === undefined) delete process.env.BAIWOR_ASK_USER_AUTO;
      else process.env.BAIWOR_ASK_USER_AUTO = previous;
    }
  });

  it('harus dapat menangkap pilihan single-select via custom handler', async () => {
    setQuestionnaireHandler(async ({ question, options }) => {
      assert.equal(question, 'Pilih CSS framework:');
      assert.deepEqual(options, ['Tailwind', 'Vanilla CSS']);
      return {
        success: true,
        output: 'Jawaban pengguna: "Tailwind"',
        answer: 'Tailwind',
      };
    });

    const res = await handleAskUser({
      question: 'Pilih CSS framework:',
      options: ['Tailwind', 'Vanilla CSS'],
    });

    assert.equal(res.success, true);
    assert.equal(res.answer, 'Tailwind');
    assert.ok(res.output.includes('Tailwind'));
  });

  it('harus dapat menangkap pilihan multi-select via custom handler', async () => {
    setQuestionnaireHandler(async ({ question, multi_select }) => {
      assert.equal(multi_select, true);
      return {
        success: true,
        output: 'Jawaban pengguna: "ESLint, Prettier"',
        answer: ['ESLint', 'Prettier'],
      };
    });

    const res = await handleAskUser({
      question: 'Pilih tool kualitas kode:',
      options: ['ESLint', 'Prettier', 'TypeScript'],
      multi_select: true,
    });

    assert.equal(res.success, true);
    assert.deepEqual(res.answer, ['ESLint', 'Prettier']);
    assert.ok(res.output.includes('ESLint, Prettier'));
  });

  it('harus dapat dieksekusi via executeTool dispatcher', async () => {
    setQuestionnaireHandler(async () => {
      return {
        success: true,
        output: 'Jawaban pengguna: "Express.js"',
        answer: 'Express.js',
      };
    });

    const res = await executeTool(
      'ask_user',
      JSON.stringify({
        question: 'Pilih framework backend:',
        options: ['Express.js', 'Fastify', 'NestJS'],
      })
    );

    assert.equal(res.success, true);
    assert.ok(res.output.includes('Express.js'));
  });
});
