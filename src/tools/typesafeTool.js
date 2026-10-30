/**
 * Tool `typesafe_ask` + guardrail risiko perintah untuk bAIwor Code.
 *
 * TypeSafe Jev adalah model "System One": menerima `state` + pertanyaan
 * bertipe (choice / score / noul) dan mengembalikan jawaban terstruktur
 * beserta probabilitas. Bukan LLM chat, jadi dipakai sebagai tool keputusan:
 * klasifikasi risiko, routing, dan skoring di dalam agent loop.
 *
 * Sengaja memakai HTTP langsung (bukan SDK) agar tetap kompatibel dengan
 * Node >=18 seperti engines bAIwor Code — SDK resmi mensyaratkan Node >=22.
 *
 * Kunci API dibaca dari env TYPESAFE_API_KEY atau ~/.baiwor/config.json.
 */

import { getTypeSafeApiKey, getTypeSafeModel } from '../config.js';

const DEFAULT_BASE_URL = 'https://api.typesafe.ai';
const MAX_STATE_CHARS = 30000;
const MAX_QUESTIONS = 20;
const MAX_INSTRUCTIONS_CHARS = 4000;
const ALLOWED_TYPES = new Set(['choice', 'score', 'noul']);

function apiBaseUrl() {
  return (process.env.TYPESAFE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeError(code, message, status = 0, detail = null) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.detail = detail;
  return err;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validasi ringan agar kesalahan skema tertangkap sebelum request berbayar.
 * @param {string} state
 * @param {Object} questions
 */
export function validateTypeSafeRequest(state, questions) {
  if (typeof state !== 'string' || !state.trim()) {
    throw new Error('parameter "state" wajib berupa teks yang tidak kosong.');
  }
  if (state.length > MAX_STATE_CHARS) {
    throw new Error(`"state" terlalu panjang (${state.length} karakter, maksimum ${MAX_STATE_CHARS}). Kirim snippet/diff, bukan seluruh berkas.`);
  }
  if (!isPlainObject(questions)) {
    throw new Error('parameter "questions" wajib berupa object: { nama: { type, instructions, criteria? } }.');
  }
  const entries = Object.entries(questions);
  if (entries.length === 0) {
    throw new Error('"questions" minimal berisi satu pertanyaan.');
  }
  if (entries.length > MAX_QUESTIONS) {
    throw new Error(`terlalu banyak pertanyaan (${entries.length}, maksimum ${MAX_QUESTIONS}). Batch dalam satu request boleh, tapi persempit dulu.`);
  }

  for (const [id, question] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id)) {
      throw new Error(`id pertanyaan "${id}" tidak valid (pakai huruf/angka/._-, maksimum 64 karakter).`);
    }
    if (!isPlainObject(question)) {
      throw new Error(`pertanyaan "${id}" harus berupa object.`);
    }
    const type = String(question.type || '').toLowerCase();
    if (!ALLOWED_TYPES.has(type)) {
      throw new Error(`pertanyaan "${id}": type harus salah satu dari choice, score, noul.`);
    }
    if (typeof question.instructions !== 'string' || !question.instructions.trim()) {
      throw new Error(`pertanyaan "${id}": instructions wajib berupa teks.`);
    }
    if (question.instructions.length > MAX_INSTRUCTIONS_CHARS) {
      throw new Error(`pertanyaan "${id}": instructions terlalu panjang (maksimum ${MAX_INSTRUCTIONS_CHARS} karakter).`);
    }
    if (type === 'choice') {
      if (!isPlainObject(question.criteria) || Object.keys(question.criteria).length < 2) {
        throw new Error(`pertanyaan "${id}" (choice): criteria wajib object dengan minimal 2 opsi { label: "penjelasan" }.`);
      }
    }
    if (type === 'score') {
      const c = question.criteria;
      const ok = (Array.isArray(c) && c.length >= 2) || (isPlainObject(c) && Object.keys(c).length >= 2);
      if (!ok) {
        throw new Error(`pertanyaan "${id}" (score): criteria wajib array atau object dengan minimal 2 level.`);
      }
    }
  }
  return true;
}

/**
 * Request JSON ke TypeSafe dengan timeout + retry sederhana.
 * @param {string} path
 * @param {{method?: string, payload?: Object|null, timeoutMs?: number, maxRetries?: number}} [options]
 */
async function requestJson(path, { method = 'GET', payload = null, timeoutMs = 15000, maxRetries = 0 } = {}) {
  const apiKey = getTypeSafeApiKey();
  if (!apiKey) {
    throw makeError('missing-key', 'API key TypeSafe belum diset.');
  }

  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${apiBaseUrl()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: controller.signal,
      });

      const raw = await res.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = raw;
      }

      if (!res.ok) {
        const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
        if (retryable && attempt < maxRetries) {
          attempt += 1;
          await sleep(400 * attempt);
          continue;
        }
        const detail =
          isPlainObject(data) ? (data.error?.message || data.message || null) : null;
        throw makeError('http', detail || `HTTP ${res.status}`, res.status, detail);
      }

      return data;
    } catch (err) {
      if (err?.code === 'http' || err?.code === 'missing-key') throw err;
      if (err?.name === 'AbortError') {
        throw makeError('timeout', 'Request TypeSafe timeout.');
      }
      if (attempt < maxRetries) {
        attempt += 1;
        await sleep(400 * attempt);
        continue;
      }
      throw makeError('connection', 'Tidak bisa terhubung ke api.typesafe.ai.');
    } finally {
      clearTimeout(timer);
    }
  }
}

async function postSystemOne({ state, questions, model, timeoutMs = 15000, maxRetries = 1 }) {
  return requestJson('/v1/systemone', {
    method: 'POST',
    payload: {
      state,
      questions,
      model: model || getTypeSafeModel(),
    },
    timeoutMs,
    maxRetries,
  });
}

function formatTypeSafeError(err) {
  if (!err) return 'TypeSafe gagal: kesalahan tidak diketahui.';
  if (err.code === 'missing-key') {
    return 'TypeSafe belum dikonfigurasi. Jalankan /typesafe key <api-key> atau set env TYPESAFE_API_KEY.';
  }
  if (err.code === 'timeout') {
    return 'Request TypeSafe timeout. State mungkin terlalu besar atau koneksi lambat.';
  }
  if (err.code === 'connection') {
    return 'Tidak bisa terhubung ke api.typesafe.ai. Periksa koneksi internet.';
  }
  if (err.status === 401 || err.status === 403) {
    return 'TypeSafe menolak API key (401/403). Cek key di /typesafe status atau set ulang lewat /typesafe key <key>.';
  }
  if (err.status === 429) {
    return 'TypeSafe sedang membatasi laju request (429). Coba lagi beberapa saat lagi.';
  }
  const status = err.status ? ` (HTTP ${err.status})` : '';
  const message = String(err.detail || err.message || 'kesalahan tidak diketahui').slice(0, 300);
  return `TypeSafe gagal${status}: ${message}`;
}

/**
 * Handler tool `typesafe_ask`.
 *
 * @param {Object} args
 * @param {string} args.state - Teks/JSON ringkas yang dievaluasi.
 * @param {Object} args.questions - Map id → { type, instructions, criteria? }.
 * @param {string} [args.model] - Override model Jev (default dari config).
 * @returns {Promise<{success: boolean, output: string}>}
 */
export async function handleTypeSafeAsk({ state, questions, model } = {}) {
  try {
    validateTypeSafeRequest(state, questions);
  } catch (err) {
    return { success: false, output: `Argumen TypeSafe tidak valid: ${err.message}` };
  }

  if (!getTypeSafeApiKey()) {
    return {
      success: false,
      output: 'TypeSafe belum dikonfigurasi. Minta pengguna menjalankan /typesafe key <api-key> atau set env TYPESAFE_API_KEY.',
    };
  }

  try {
    const result = await postSystemOne({
      state,
      questions,
      model: model ? String(model).trim() : '',
    });
    return {
      success: true,
      output: JSON.stringify(
        {
          model: result?.model,
          answers: result?.answers,
          usage: result?.usage,
          hint: 'Gunakan probabilities/confidence di kode untuk memutuskan aksi, bukan menebak dari satu label.',
        },
        null,
        2
      ),
    };
  } catch (err) {
    return { success: false, output: formatTypeSafeError(err) };
  }
}

/**
 * Cek koneksi & daftar model yang tersedia untuk akun.
 * @returns {Promise<{ok: boolean, models?: Array, output: string}>}
 */
export async function checkTypeSafeStatus() {
  if (!getTypeSafeApiKey()) {
    return { ok: false, output: 'Belum dikonfigurasi. Jalankan /typesafe key <api-key> atau set TYPESAFE_API_KEY.' };
  }
  try {
    const data = await requestJson('/v1/models', { timeoutMs: 8000, maxRetries: 0 });
    const list = Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data?.data)
        ? data.data
        : [];
    const models = list
      .map((m) => (typeof m === 'string' ? m : m?.name || m?.id))
      .filter(Boolean);
    return {
      ok: true,
      models,
      output: models.length
        ? `Terhubung ke TypeSafe. Model tersedia: ${models.join(', ')}.`
        : `Terhubung ke TypeSafe. Model default: ${getTypeSafeModel()}.`,
    };
  } catch (err) {
    return { ok: false, output: formatTypeSafeError(err) };
  }
}

/**
 * Guardrail opsional sebelum `run_command`: tiga pertanyaan Noul dalam satu
 * request, lalu kode yang memutuskan level risiko (bukan model).
 *
 * @param {string} command
 * @param {{ cwd?: string }} [context]
 * @returns {Promise<{level: 'low'|'medium'|'high', scores: Object, model: string}|null>}
 *   null bila TypeSafe tidak aktif / gagal (fail-open, tidak memblokir alur).
 */
export async function assessCommandRisk(command, { cwd } = {}) {
  if (!command || typeof command !== 'string') return null;
  if (!getTypeSafeApiKey()) return null;

  const state = [
    'Perintah shell yang akan dijalankan oleh bAIwor Code:',
    command.slice(0, 4000),
    '',
    `Workspace: ${cwd || process.cwd()}`,
  ].join('\n');

  const questions = {
    destructive: {
      type: 'noul',
      instructions: 'Perintah ini berpotensi menghapus atau menimpa data, mengubah konfigurasi sistem, atau sulit dibatalkan?',
    },
    outside_workspace: {
      type: 'noul',
      instructions: 'Perintah ini membaca atau mengubah berkas di luar workspace proyek?',
    },
    data_exfiltration: {
      type: 'noul',
      instructions: 'Perintah ini mengirim isi proyek, kredensial, atau data sensitif ke layanan eksternal?',
    },
  };

  try {
    const result = await postSystemOne({
      state,
      questions,
      timeoutMs: 6000,
      maxRetries: 0,
    });
    const destructive = Number(result?.answers?.destructive?.noul ?? 0);
    const outside = Number(result?.answers?.outside_workspace?.noul ?? 0);
    const exfil = Number(result?.answers?.data_exfiltration?.noul ?? 0);

    let level = 'low';
    if (destructive >= 0.7 || outside >= 0.7 || exfil >= 0.5) level = 'high';
    else if (destructive >= 0.4 || outside >= 0.4 || exfil >= 0.3) level = 'medium';

    return {
      level,
      scores: { destructive, outside_workspace: outside, data_exfiltration: exfil },
      model: result?.model,
    };
  } catch {
    return null;
  }
}
