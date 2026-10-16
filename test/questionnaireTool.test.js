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

  it('harus otomatis memilih opsi default pada lingkungan non-TTY', async () => {
    // Di lingkungan pengujian otomatis (biasanya non-TTY)
    const res = await handleAskUser({
      question: 'Pilih format basis data:',
      options: ['SQLite', 'PostgreSQL', 'MySQL'],
      default_option: 'PostgreSQL',
    });

    assert.equal(res.success, true);
    assert.equal(res.answer, 'PostgreSQL');
    assert.ok(res.output.includes('PostgreSQL'));
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
