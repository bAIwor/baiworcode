import { spawn } from 'node:child_process';
import { REASONING_CONTENT_PLACEHOLDER } from './reasoningPlaceholder.js';

/**
 * Melakukan streaming chat completion melalui Antigravity CLI (agy)
 * ditenagai oleh sesi Google AI Pro (Gemini 3.8 Flash, Claude Sonnet 4.6, Opus 4.6, dll.)
 */
export async function streamAgyCompletion({
  credentials,
  messages,
  signal,
  onStart,
  onDelta,
  onReasoning,
}) {
  const agyExe = process.env.ANTIGRAVITY_AGENTAPI_EXE || 'agy';
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const contextHistory = messages.slice(0, -1);

  let fullPrompt = '';
  if (contextHistory.length > 0) {
    const historyText = contextHistory
      .filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join('\n\n');
    fullPrompt = `Konteks percakapan sebelumnya:\n${historyText}\n\nInstruksi pengguna sekarang:\n${lastUserMsg}`;
  } else {
    fullPrompt = lastUserMsg;
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(
        agyExe,
        ['--model', credentials.model, '--output-format', 'stream-json', '-p', '-'],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
        }
      );
    } catch (err) {
      return reject(new Error(`Gagal menjalankan Antigravity CLI (${agyExe}): ${err.message}`));
    }

    if (signal) {
      signal.addEventListener('abort', () => {
        try {
          child.kill('SIGTERM');
        } catch {}
      });
    }

    let buffer = '';
    let hasStarted = false;
    let fullContent = '';
    let fullReasoning = '';

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          if (json.event === 'step_update') {
            const step = json.step_update;
            if (step?.text_delta) {
              if (!hasStarted) {
                hasStarted = true;
                if (onStart) onStart();
              }
              fullContent += step.text_delta;
              if (onDelta) onDelta(step.text_delta);
            }
          } else if (json.event === 'result') {
            if (json.result?.response && !fullContent) {
              fullContent = json.result.response;
            }
          }
        } catch {
          // Abaikan baris non-JSON
        }
      }
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (signal?.aborted) {
        const err = new Error('Streaming dihentikan oleh pengguna.');
        err.name = 'AbortError';
        // Konsisten dengan path OpenAI-compatible: jawaban yang sudah terkumpul
        // sebelum abort tetap dibawa agar bisa disimpan ke histori percakapan.
        err.partialContent = fullContent;
        err.partialReasoning = fullReasoning;
        return reject(err);
      }
      if (code !== 0 && !fullContent) {
        return reject(new Error(`Antigravity error (exit code ${code}): ${stderr || 'Unknown error'}`));
      }
      resolve({
        content: fullContent,
        reasoning: fullReasoning,
        tool_calls: null,
        completed: true,
      });
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();
  });
}

/**
 * Helper untuk menyusun URL endpoint /chat/completions secara fleksibel
 * baik untuk AgentikMyID, OpenRouter, Groq, maupun endpoint OpenAI-compatible lainnya.
 */
export function buildChatEndpoint(baseUrl, model) {
  let url = (baseUrl || '').trim().replace(/\/+$/, '');
  const isResponsesModel =
    typeof model === 'string' &&
    (model === 'gpt-6.1-sol' || model === 'gpt-6-astra' || model.includes('responses'));

  if (isResponsesModel) {
    if (url.endsWith('/responses')) {
      return url;
    }
    if (/\/(v\d+(?:beta|alpha|rc)?)(?=\/|$)/.test(url)) {
      return `${url}/responses`;
    }
    return `${url}/v1/responses`;
  }

  if (url.endsWith('/chat/completions')) {
    return url;
  }
  // Base URL yang sudah membawa segmen versi (…/v1, …/v1beta, …/v2alpha) —
  // termasuk bila masih punya segmen sesudahnya, mis. Google Gemini memakai
  // …/v1beta/openai — cukup dilanjutkan /chat/completions. Menyuntik /v1
  // lagi akan menghasilkan path yang tidak ada (404).
  if (/\/(v\d+(?:beta|alpha|rc)?)(?=\/|$)/.test(url)) {
    return `${url}/chat/completions`;
  }
  return `${url}/v1/chat/completions`;
}

/**
 * Batas percobaan ulang bawaan untuk gangguan sementara provider.
 * Retry hanya dilakukan SEBELUM byte pertama dibaca, jadi respons yang sudah
 * mulai mengalir tidak pernah diduplikasi.
 */
export const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 400;
// Batas diam stream (idle watchdog): jika TIDAK ADA byte yang datang selama
// durasi ini, stream dianggap macet dan diperpotong dengan TimeoutError.
// Tanpa ini, `reader.read()` bisa menunggu selamanya ketika proxy/provider
// menggantung koneksi tanpa menutupnya — pengguna mendapat spinner yang
// berputar tanpa akhir (perasaan "freeze") padahal tidak ada data yang jalan.
export const DEFAULT_STALL_TIMEOUT_MS = 180000;

/** Status HTTP yang layak dicoba ulang — murni gangguan sementara server. */
function isRetryableStatus(status) {
  return Number.isInteger(status) && status >= 500 && status < 600;
}

/** Kode error transport yang menandakan gangguan jaringan sesaat. */
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_RST',
]);

function isTransientNetworkError(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError') return true;
  const code = err.code || err.cause?.code;
  return RETRYABLE_NETWORK_CODES.has(code);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Menjalankan `fetch` dengan retry + backoff eksponensial untuk error yang
 * bersifat sementara (timeout/jaringan dan HTTP 5xx). Permintaan 4xx tidak
 * diulang karena bukan gangguan sesaat; 429 (rate limit) juga sengaja tidak
 * diulang agar kuota tidak makin terkuras.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {{maxRetries:number, retryDelayMs:number}} options
 * @returns {Promise<Response>}
 */
async function requestWithRetry(url, init, { maxRetries, retryDelayMs }) {
  let response;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (init.signal?.aborted) {
      const abortErr = new Error('Streaming dihentikan oleh pengguna.');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    try {
      response = await fetch(url, init);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      lastError = err;
      if (attempt < maxRetries && isTransientNetworkError(err)) {
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }
      throw err;
    }

    if (!response.ok && isRetryableStatus(response.status) && attempt < maxRetries) {
      // Buang isi respons gagal sebelum mengulang agar koneksi tidak menggantung.
      try {
        await response.body?.cancel();
      } catch {
        // abaikan
      }
      await sleep(retryDelayMs * 2 ** attempt);
      continue;
    }

    return response;
  }

  if (lastError) throw lastError;
  return response;
}

/**
 * Melakukan panggilan streaming chat completion ke endpoint OpenAI-compatible.
 * Menggunakan line-buffering untuk mencegah error JSON.parse pada potongan TCP/SSE chunk.
 * Mendukung akumulasi tool_calls untuk Agentic Tool Calling (Tahap 3B).
 *
 * @param {Object} options
 * @param {Object} options.credentials - { baseUrl, headers, model }
 * @param {Array} options.messages - Array pesan [{ role, content }]
 * @param {Array} [options.tools] - Definisi tools berformat OpenAI function calling
 * @param {AbortSignal} [options.signal] - Signal pembatalan AbortController
 * @param {Function} [options.onStart] - Callback saat token pertama tiba
 * @param {Function} [options.onDelta] - Callback setiap token konten tiba
 * @param {Function} [options.onReasoning] - Callback setiap token reasoning/thinking tiba
 * @param {number} [options.maxRetries] - Jumlah percobaan ulang untuk gangguan sesaat (default 2)
 * @param {number} [options.retryDelayMs] - Jeda dasar backoff dalam ms (default 400)
 * @param {number} [options.stallTimeoutMs] - Batas diam stream tanpa byte baru
 *   (idle watchdog). Default 180000 (3 menit). Timer direset setiap kali byte
 *   datang — termasuk keep-alive SSE — sehingga stream sehat tidak pernah
 *   salah didenda; hanya koneksi yang benar-benar macet yang dipotong.
 * @returns {Promise<{ content: string, reasoning: string, tool_calls: Array|null, completed: boolean }>}
 */
// Provider/model reasoning tertentu (mis. Reflection Beam) menuntut field
// `reasoning_content` ADA DAN TIDAK KOSONG pada setiap pesan asisten lama.
// Bukti uji langsung ke API Reflection:
//   - field tidak ada        -> 400 missing_required_parameter
//   - reasoning_content: ''  -> 400 (dianggap tetap "missing")
//   - reasoning_content: ' ' -> 200 OK
// Karena itu backfill WAJIB memakai placeholder non-kosong.
const REASONING_BACKFILL_HOSTS = new Set();

function backfillReasoningContent(messages) {
  return messages.map((m) =>
    m &&
    m.role === 'assistant' &&
    (typeof m.reasoning_content !== 'string' || m.reasoning_content.length === 0)
      ? { ...m, reasoning_content: REASONING_CONTENT_PLACEHOLDER }
      : m
  );
}

export async function streamChatCompletion({
  credentials,
  messages,
  tools,
  signal,
  onStart,
  onDelta,
  onReasoning,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
}) {
  if (credentials.type === 'agy') {
    return await streamAgyCompletion({
      credentials,
      messages,
      tools,
      signal,
      onStart,
      onDelta,
      onReasoning,
    });
  }

  const url = buildChatEndpoint(credentials.baseUrl, credentials.model);

  // Bila provider ini pernah menolak karena `reasoning_content` hilang, rapikan
  // langsung di muka supaya tidak membuang satu request 400 + retry setiap turn.
  const outgoingMessages = REASONING_BACKFILL_HOSTS.has(credentials.baseUrl)
    ? backfillReasoningContent(messages)
    : messages;

  const isResponsesApi = url.endsWith('/responses');
  const payload = isResponsesApi
    ? {
        model: credentials.model,
        stream: true,
        input: outgoingMessages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
          content: m.content || '',
        })),
      }
    : {
        model: credentials.model,
        messages: outgoingMessages,
        stream: true,
      };

  if (!isResponsesApi && tools && Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  let response = await requestWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        ...credentials.headers,
      },
      body: JSON.stringify(payload),
      signal,
    },
    { maxRetries, retryDelayMs }
  );

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail =
        errJson?.error?.message ||
        errJson?.message ||
        JSON.stringify(errJson);
    } catch {
      try {
        errorDetail = await response.text();
      } catch {
        errorDetail = response.statusText;
      }
    }

    // Auto-recovery untuk ketidakcocokan parameter reasoning_content antar-provider:
    // 1. Model reasoning (Reflection Beam, DeepSeek R1, Kimi) mewajibkan reasoning_content pada setiap pesan asisten.
    //    Jika pesan asisten lama tidak membawanya (mis. hasil pemadatan konteks, sesi lama, atau ganti model
    //    dari model non-reasoning), provider menolak. Kita isi field itu dengan placeholder NON-KOSONG
    //    lalu coba ulang sekali.
    const isReasoningRequiredError =
      /reasoning_content/i.test(errorDetail) &&
      /(?:missing|required|needs the reasoning|send back)/i.test(errorDetail);

    // 2. Gateway/proxy OpenAI yang kaku menolak request jika pesan membawa property di luar skema resmi.
    //    Jika ditolak dengan 'Extra inputs are not permitted' terkait reasoning_content, kita buang property tersebut dan coba ulang sekali.
    const isReasoningNotAllowedError =
      /extra inputs are not permitted/i.test(errorDetail) ||
      (/reasoning_content/i.test(errorDetail) && /(?:unrecognized|not allowed|permitted|unexpected)/i.test(errorDetail));

    if (response.status === 400 && isReasoningRequiredError) {
      // Tandai provider ini agar turn berikutnya langsung dirapikan di muka,
      // lalu isi reasoning_content yang hilang dengan placeholder non-kosong.
      REASONING_BACKFILL_HOSTS.add(credentials.baseUrl);
      const patchedMessages = backfillReasoningContent(payload.messages);
      try {
        const retryRes = await requestWithRetry(
          url,
          {
            method: 'POST',
            headers: { ...credentials.headers },
            body: JSON.stringify({ ...payload, messages: patchedMessages }),
            signal,
          },
          { maxRetries: 0 }
        );
        if (retryRes.ok) {
          response = retryRes;
        } else {
          try {
            const retryJson = await retryRes.json();
            errorDetail = retryJson?.error?.message || retryJson?.message || errorDetail;
          } catch {}
        }
      } catch {}
    } else if (response.status === 400 && isReasoningNotAllowedError) {
      const strippedMessages = payload.messages.map((m) => {
        if (m.role === 'assistant' && 'reasoning_content' in m) {
          const copy = { ...m };
          delete copy.reasoning_content;
          return copy;
        }
        return m;
      });
      try {
        const retryRes = await requestWithRetry(
          url,
          {
            method: 'POST',
            headers: { ...credentials.headers },
            body: JSON.stringify({ ...payload, messages: strippedMessages }),
            signal,
          },
          { maxRetries: 0 }
        );
        if (retryRes.ok) {
          response = retryRes;
        } else {
          try {
            const retryJson = await retryRes.json();
            errorDetail = retryJson?.error?.message || retryJson?.message || errorDetail;
          } catch {}
        }
      } catch {}
    }

    if (!response.ok) {
      const error = new Error(errorDetail || `HTTP Error ${response.status}`);
      error.status = response.status;
      error.url = url;
      throw error;
    }
  }

  if (!response.body) {
    throw new Error('Response body dari provider kosong (tidak ada data stream).');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');

  let buffer = '';
  let hasStarted = false;
  let fullContent = '';
  let fullReasoning = '';
  const accumulatedToolCalls = [];

  /**
   * Menerapkan satu objek SSE ke akumulator.
   *
   * Dipakai baik untuk baris di dalam loop maupun untuk sisa buffer di akhir
   * stream, supaya `reasoning_content` dan `tool_calls` pada baris terakhir
   * — yang mungkin tidak diakhiri newline atau `[DONE]` — tidak ikut terbuang.
   */
  const applyChunk = (parsed) => {
    // Tangani event stream dari OpenAI Responses API (/v1/responses)
    if (parsed?.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
      if (!hasStarted) {
        hasStarted = true;
        if (onStart) onStart();
      }
      fullContent += parsed.delta;
      if (onDelta) onDelta(parsed.delta);
      return;
    }

    const choice = parsed?.choices?.[0];
    const delta = choice?.delta;

    if (!delta && !choice?.message) return;

    if (!hasStarted) {
      hasStarted = true;
      if (onStart) onStart();
    }

    // Tangani token reasoning / thinking (DeepSeek R1 dsb.)
    if (delta?.reasoning_content) {
      fullReasoning += delta.reasoning_content;
      if (onReasoning) {
        onReasoning(delta.reasoning_content);
      }
    }

    // Tangani token konten utama
    if (delta?.content) {
      fullContent += delta.content;
      if (onDelta) {
        onDelta(delta.content);
      }
    }

    // Tangani token tool calls (OpenAI function calling)
    if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!accumulatedToolCalls[idx]) {
          accumulatedToolCalls[idx] = {
            id: tc.id || '',
            type: tc.type || 'function',
            function: {
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            },
          };
        } else {
          if (tc.id) accumulatedToolCalls[idx].id = tc.id;
          if (tc.function?.name) accumulatedToolCalls[idx].function.name += tc.function.name;
          if (tc.function?.arguments) accumulatedToolCalls[idx].function.arguments += tc.function.arguments;
        }
      }
    }

    // Fallback jika provider mengirimkan tool_calls langsung di object message
    if (choice?.message?.tool_calls && Array.isArray(choice.message.tool_calls)) {
      for (const tc of choice.message.tool_calls) {
        const idx = tc.index ?? accumulatedToolCalls.length;
        accumulatedToolCalls[idx] = tc;
      }
    }
  };

  try {
    while (true) {
      /**
       * Idle watchdog: `reader.read()` murni menunggu byte berikutnya dan
       * tidak punya batas waktu. Koneksi yang menggentung (proxy mati saat
       * upstream masih menyala, jaringan berubah tanpa membunuh TCP, dsb.)
       * membuat panggilan ini menggantung selamanya — spinner terus berputar
       * dan pengguna merasakan freeze. Promise.race memastikan kita selalu
       * menang: byte datang atau timer berakhir lebih dulu.
       *
       * Timer direset pada SETIAP chunk yang berhasil dibaca, jadi selama
       * provider mengirim apa pun (termasuk keep-alive ': ping'), stream
       * dianggap hidup; hanya diam total yang dipotong.
       */
      let stallTimer = null;
      const result = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          stallTimer = setTimeout(() => {
            try {
              const stallErr = new Error(
                `Stream macet — tidak ada data selama ${(stallTimeoutMs / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} detik. ` +
                `Kemungkinan provider/proxy menggantung koneksi. Coba kirim ulang.`
              );
              stallErr.name = 'TimeoutError';
              // Rejection HARUS lebih dulu: kalau reader.cancel() dieksekusi
              // lebih dulu, read yang pending justru bangun sebagai done:true
              // dan race menyimpulkan "stream wajar berakhir" — tanpa error.
              reject(stallErr);
              // Lepaskan koneksi agar socket tidak menggantung di latar belakang.
              reader.cancel().catch(() => {});
            } catch {}
          }, stallTimeoutMs);
        }),
      ]).finally(() => {
        if (stallTimer) clearTimeout(stallTimer);
      });
      const { done, value } = result;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Simpan potongan baris terakhir yang mungkin belum utuh
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        // Lewati baris kosong atau keep-alive SSE comment (: ping)
        if (!line || line.startsWith(':')) continue;

        // Toleran terhadap 'data: {...}' maupun 'data:{...}' (tanpa spasi).
        if (line.startsWith('data:')) {
          const jsonStr = line.slice(5).trim();
          if (jsonStr === '[DONE]') {
            const finalToolCalls = accumulatedToolCalls.filter(Boolean);
            return {
              content: fullContent,
              reasoning: fullReasoning,
              tool_calls: finalToolCalls.length > 0 ? finalToolCalls : null,
              completed: true,
            };
          }
          try {
            applyChunk(JSON.parse(jsonStr));
          } catch {
            // Abaikan potongan baris SSE individual yang tidak valid
          }
        }
      }
    }

    // Periksa sisa buffer bila stream berakhir tanpa newline/`[DONE]`. Baris
    // terakhir tetap diurai utuh (termasuk reasoning & tool_calls).
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      const jsonStr = tail.slice(5).trim();
      if (jsonStr && jsonStr !== '[DONE]') {
        try {
          applyChunk(JSON.parse(jsonStr));
        } catch {
          // Lewati sisa buffer yang tidak valid
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      const abortErr = new Error('Streaming dihentikan oleh pengguna.');
      abortErr.name = 'AbortError';
      abortErr.partialContent = fullContent;
      abortErr.partialReasoning = fullReasoning;
      const finalToolCalls = accumulatedToolCalls.filter(Boolean);
      abortErr.partialToolCalls = finalToolCalls.length > 0 ? finalToolCalls : null;
      throw abortErr;
    }
    if (err.name === 'TimeoutError') {
      // Stream macet dibunuh watchdog: jawaban yang sudah tercetak sebelum
      // terpotong tetap dilampirkan agar pemanggil bisa memanfaatkannya
      // (mis. menyimpan ke histori) dan pesan error jelas berada di bagian mana.
      err.partialContent = fullContent;
      err.partialReasoning = fullReasoning;
      const finalToolCalls = accumulatedToolCalls.filter(Boolean);
      err.partialToolCalls = finalToolCalls.length > 0 ? finalToolCalls : null;
    }
    throw err;
  }

  const finalToolCalls = accumulatedToolCalls.filter(Boolean);
  return {
    content: fullContent,
    reasoning: fullReasoning,
    tool_calls: finalToolCalls.length > 0 ? finalToolCalls : null,
    completed: true,
  };
}
