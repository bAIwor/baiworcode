import { REASONING_CONTENT_PLACEHOLDER } from './reasoningPlaceholder.js';

/**
 * Helper untuk menyusun URL endpoint /chat/completions secara fleksibel
 * baik untuk AgentikMyID, OpenRouter, Groq, maupun endpoint OpenAI-compatible lainnya.
 */
export function buildChatEndpoint(baseUrl, model, apiStyle = null) {
  let url = (baseUrl || '').trim().replace(/\/+$/, '');
  const forcedResponses = apiStyle === 'responses';
  const forcedChat = apiStyle === 'chat' || apiStyle === 'chat_completions';
  const isResponsesModel =
    forcedResponses ||
    (!forcedChat &&
      (url.endsWith('/responses') ||
        (typeof model === 'string' && model.includes('responses'))));

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
 * Mengubah riwayat format Chat Completions menjadi `input` untuk Responses API.
 * Tool call & hasil tool menjadi item terpisah (`function_call` /
 * `function_call_output`), sesuai spesifikasi OpenAI Responses.
 *
 * @param {Array} messages
 * @returns {Array<Object>}
 */
export function buildResponsesInput(messages = []) {
  const input = [];
  let fallbackId = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;

    if (m.role === 'tool') {
      if (!m.tool_call_id) continue;
      input.push({
        type: 'function_call_output',
        call_id: m.tool_call_id,
        output: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
      });
      continue;
    }

    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      if (typeof m.content === 'string' && m.content.trim()) {
        input.push({ role: 'assistant', content: m.content });
      }
      for (const tc of m.tool_calls) {
        const name = tc?.function?.name || tc?.name;
        if (!name) continue;
        const args = tc?.function?.arguments ?? tc?.arguments ?? '{}';
        input.push({
          type: 'function_call',
          call_id: tc?.id || tc?.call_id || `call_fallback_${fallbackId++}`,
          name,
          arguments: typeof args === 'string' ? args : JSON.stringify(args),
        });
      }
      continue;
    }

    const role = m.role === 'system' || m.role === 'developer' ? m.role : m.role === 'assistant' ? 'assistant' : 'user';
    input.push({
      role,
      content: Array.isArray(m.content) ? m.content : typeof m.content === 'string' ? m.content : String(m.content ?? ''),
    });
  }
  return input;
}

/** Tools Chat Completions ({type,function:{...}}) → format Responses yang datar. */
export function buildResponsesTools(tools = []) {
  return (Array.isArray(tools) ? tools : [])
    .filter((t) => t?.function?.name)
    .map((t) => ({
      type: 'function',
      name: t.function.name,
      description: t.function.description || '',
      parameters: t.function.parameters || { type: 'object', properties: {} },
    }));
}

function createResponsesState() {
  return { calls: new Map(), order: [] };
}

function registerResponsesCall(state, item) {
  if (!item || typeof item !== 'object') return;
  const key = item.id || item.call_id;
  if (!key) return;
  let call = state.calls.get(key);
  if (!call) {
    call = { id: item.call_id || key, name: '', args: '' };
    state.calls.set(key, call);
    state.order.push(key);
  }
  if (item.call_id) call.id = item.call_id;
  if (item.name) call.name = item.name;
  if (typeof item.arguments === 'string' && item.arguments) call.args = item.arguments;
}

/**
 * Menyerap `response.completed` sebagai sumber kebenaran akhir. Dipakai untuk
 * provider yang tidak mengirim delta lengkap (atau hanya mengirim event final).
 *
 * @returns {string} teks final (bila ada)
 */
function applyResponsesFinalResponse(state, response) {
  let text = '';
  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'function_call') {
      registerResponsesCall(state, item);
      continue;
    }
    if (item.type === 'message') {
      const parts = Array.isArray(item.content) ? item.content : [];
      for (const part of parts) {
        if (part?.type === 'output_text' && typeof part.text === 'string') text += part.text;
      }
    }
  }
  return text;
}

function buildResponsesResult(state, content, reasoning) {
  const calls = state.order
    .map((key) => state.calls.get(key))
    .filter((call) => call && call.name && call.id)
    .map((call) => ({
      id: call.id,
      type: 'function',
      function: {
        name: call.name,
        arguments: call.args || '{}',
      },
    }));
  return {
    content,
    reasoning,
    tool_calls: calls.length > 0 ? calls : null,
    completed: true,
  };
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
  const url = buildChatEndpoint(credentials.baseUrl, credentials.model, credentials.apiStyle);

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
        input: buildResponsesInput(outgoingMessages),
      }
    : {
        model: credentials.model,
        messages: outgoingMessages,
        stream: true,
      };

  if (tools && Array.isArray(tools) && tools.length > 0) {
    if (isResponsesApi) {
      const responseTools = buildResponsesTools(tools);
      if (responseTools.length > 0) {
        payload.tools = responseTools;
        payload.tool_choice = 'auto';
      }
    } else {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }
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

    // Auto-recovery reasoning hanya berlaku untuk payload Chat Completions.
    const canPatchReasoning = Array.isArray(payload.messages);
    if (response.status === 400 && isReasoningRequiredError && canPatchReasoning) {
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
    } else if (response.status === 400 && isReasoningNotAllowedError && canPatchReasoning) {
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
  const responsesState = isResponsesApi ? createResponsesState() : null;

  const markStarted = () => {
    if (hasStarted) return;
    hasStarted = true;
    if (onStart) onStart();
  };

  /**
   * Menerapkan satu objek SSE ke akumulator.
   *
   * Dipakai baik untuk baris di dalam loop maupun untuk sisa buffer di akhir
   * stream, supaya `reasoning_content` dan `tool_calls` pada baris terakhir
   * — yang mungkin tidak diakhiri newline atau `[DONE]` — tidak ikut terbuang.
   */
  const applyChunk = (parsed) => {
    // Event stream OpenAI Responses API (/v1/responses).
    if (isResponsesApi) {
      const type = parsed?.type;
      if (!type) return;

      if (type === 'response.output_text.delta') {
        if (typeof parsed.delta !== 'string') return;
        markStarted();
        fullContent += parsed.delta;
        if (onDelta) onDelta(parsed.delta);
        return;
      }

      if (
        type === 'response.reasoning_summary_text.delta' ||
        type === 'response.reasoning_text.delta'
      ) {
        if (typeof parsed.delta !== 'string') return;
        markStarted();
        fullReasoning += parsed.delta;
        if (onReasoning) onReasoning(parsed.delta);
        return;
      }

      if (type === 'response.output_text.done') {
        if (!fullContent && typeof parsed.text === 'string' && parsed.text) {
          fullContent = parsed.text;
          markStarted();
          if (onDelta) onDelta(parsed.text);
        }
        return;
      }

      if (type === 'response.output_item.added' || type === 'response.output_item.done') {
        const item = parsed.item;
        if (item?.type === 'function_call') {
          markStarted();
          registerResponsesCall(responsesState, item);
        } else if (item?.type === 'message' && type === 'response.output_item.done' && !fullContent) {
          const parts = Array.isArray(item.content) ? item.content : [];
          const text = parts
            .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('');
          if (text) {
            fullContent = text;
            markStarted();
            if (onDelta) onDelta(text);
          }
        }
        return;
      }

      if (type === 'response.function_call_arguments.delta') {
        const key = parsed.item_id || parsed.call_id;
        if (!key) return;
        let call = responsesState.calls.get(key);
        if (!call) {
          call = { id: parsed.call_id || key, name: parsed.name || '', args: '' };
          responsesState.calls.set(key, call);
          responsesState.order.push(key);
        }
        if (typeof parsed.delta === 'string') call.args += parsed.delta;
        if (parsed.name && !call.name) call.name = parsed.name;
        markStarted();
        return;
      }

      if (type === 'response.function_call_arguments.done') {
        const key = parsed.item_id || parsed.call_id;
        if (key) {
          let call = responsesState.calls.get(key);
          if (!call) {
            call = { id: parsed.call_id || key, name: parsed.name || '', args: '' };
            responsesState.calls.set(key, call);
            responsesState.order.push(key);
          }
          if (typeof parsed.arguments === 'string') call.args = parsed.arguments;
          if (parsed.name) call.name = parsed.name;
        }
        return;
      }

      if (type === 'response.completed') {
        const finalText = applyResponsesFinalResponse(responsesState, parsed.response);
        if (finalText) {
          if (!fullContent) {
            fullContent = finalText;
            markStarted();
            if (onDelta) onDelta(finalText);
          } else if (finalText.length > fullContent.length && finalText.startsWith(fullContent)) {
            // Lengkapi bila delta terakhir tidak sempat terkirim.
            const rest = finalText.slice(fullContent.length);
            fullContent = finalText;
            if (onDelta) onDelta(rest);
          } else {
            fullContent = finalText;
          }
        }
        responsesState.completed = true;
        return;
      }

      if (type === 'response.failed' || type === 'error') {
        const message =
          parsed.response?.error?.message ||
          parsed.error?.message ||
          parsed.message ||
          JSON.stringify(parsed);
        throw new Error(`Responses API error: ${message}`);
      }
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
            // Beberapa provider tidak mengirim `id`. ID kosong membuat hasil
            // tool tidak bisa dipasangkan dengan assistant.tool_calls →
            // permintaan berikutnya ditolak 400 dan output tool hilang.
            // Karena itu ID disintesis dari indeks yang stabil.
            id: tc.id || `call_${idx}`,
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
            try { await reader.cancel(); } catch {}
            if (isResponsesApi) {
              return buildResponsesResult(responsesState, fullContent, fullReasoning);
            }
            const finalToolCalls = accumulatedToolCalls.filter(Boolean);
            return {
              content: fullContent,
              reasoning: fullReasoning,
              tool_calls: finalToolCalls.length > 0 ? finalToolCalls : null,
              completed: true,
            };
          }

          let parsed;
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            // Abaikan potongan baris SSE individual yang tidak valid.
            continue;
          }
          // Error dari event (mis. response.failed) HARUS diteruskan, bukan
          // ikut tertelan sebagai "JSON rusak".
          applyChunk(parsed);

          if (isResponsesApi && responsesState.completed) {
            try { await reader.cancel(); } catch {}
            return buildResponsesResult(responsesState, fullContent, fullReasoning);
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
    if (isResponsesApi) {
      return buildResponsesResult(responsesState, fullContent, fullReasoning);
    }
  } catch (err) {
    if (!err.partialContent && fullContent) {
      err.partialContent = fullContent;
      err.partialReasoning = fullReasoning;
    }
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

  if (isResponsesApi) {
    return buildResponsesResult(responsesState, fullContent, fullReasoning);
  }

  const finalToolCalls = accumulatedToolCalls.filter(Boolean);
  return {
    content: fullContent,
    reasoning: fullReasoning,
    tool_calls: finalToolCalls.length > 0 ? finalToolCalls : null,
    completed: true,
  };
}
