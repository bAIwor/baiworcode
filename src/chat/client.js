/**
 * Helper untuk menyusun URL endpoint /chat/completions secara fleksibel
 * baik untuk AgentikMyID, OpenRouter, Groq, maupun endpoint OpenAI-compatible lainnya.
 */
export function buildChatEndpoint(baseUrl) {
  let url = (baseUrl || '').trim().replace(/\/+$/, '');
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
 * @returns {Promise<{ content: string, reasoning: string, tool_calls: Array|null, completed: boolean }>}
 */
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
}) {
  const url = buildChatEndpoint(credentials.baseUrl);
  const payload = {
    model: credentials.model,
    messages,
    stream: true,
  };

  if (tools && Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  const response = await requestWithRetry(
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

    const error = new Error(errorDetail || `HTTP Error ${response.status}`);
    error.status = response.status;
    error.url = url;
    throw error;
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
      const { done, value } = await reader.read();
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
      const finalToolCalls = accumulatedToolCalls.filter(Boolean);
      abortErr.partialToolCalls = finalToolCalls.length > 0 ? finalToolCalls : null;
      throw abortErr;
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
