/**
 * Helper untuk menyusun URL endpoint /chat/completions secara fleksibel
 * baik untuk AgentikMyID, OpenRouter, Groq, maupun endpoint OpenAI-compatible lainnya.
 */
export function buildChatEndpoint(baseUrl) {
  let url = (baseUrl || '').trim().replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) {
    return url;
  }
  if (url.endsWith('/v1')) {
    return `${url}/chat/completions`;
  }
  return `${url}/v1/chat/completions`;
}

/**
 * Melakukan panggilan streaming chat completion ke endpoint OpenAI-compatible.
 * Menggunakan line-buffering untuk mencegah error JSON.parse pada potongan TCP/SSE chunk.
 *
 * @param {Object} options
 * @param {Object} options.credentials - { baseUrl, headers, model }
 * @param {Array} options.messages - Array pesan [{ role, content }]
 * @param {AbortSignal} [options.signal] - Signal pembatalan AbortController
 * @param {Function} [options.onStart] - Callback saat token pertama tiba
 * @param {Function} [options.onDelta] - Callback setiap token konten tiba
 * @param {Function} [options.onReasoning] - Callback setiap token reasoning/thinking tiba
 * @returns {Promise<{ content: string, reasoning: string, completed: boolean }>}
 */
export async function streamChatCompletion({
  credentials,
  messages,
  signal,
  onStart,
  onDelta,
  onReasoning,
}) {
  const url = buildChatEndpoint(credentials.baseUrl);
  const payload = {
    model: credentials.model,
    messages,
    stream: true,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...credentials.headers,
    },
    body: JSON.stringify(payload),
    signal,
  });

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

        if (line === 'data: [DONE]') {
          return { content: fullContent, reasoning: fullReasoning, completed: true };
        }

        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          try {
            const parsed = JSON.parse(jsonStr);
            const choice = parsed.choices?.[0];
            const delta = choice?.delta;

            if (!delta) continue;

            if (!hasStarted) {
              hasStarted = true;
              if (onStart) onStart();
            }

            // Tangani token reasoning / thinking (DeepSeek R1 dsb.)
            if (delta.reasoning_content) {
              fullReasoning += delta.reasoning_content;
              if (onReasoning) {
                onReasoning(delta.reasoning_content);
              }
            }

            // Tangani token konten utama
            if (delta.content) {
              fullContent += delta.content;
              if (onDelta) {
                onDelta(delta.content);
              }
            }
          } catch {
            // Abaikan potongan baris SSE individual yang tidak valid
          }
        }
      }
    }

    // Periksa sisa buffer jika masih ada data yang belum terurai
    if (buffer.trim().startsWith('data: ')) {
      const jsonStr = buffer.trim().slice(6).trim();
      if (jsonStr !== '[DONE]') {
        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            if (onDelta) onDelta(delta.content);
          }
        } catch {}
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      const abortErr = new Error('Streaming dihentikan oleh pengguna.');
      abortErr.name = 'AbortError';
      abortErr.partialContent = fullContent;
      throw abortErr;
    }
    throw err;
  }

  return { content: fullContent, reasoning: fullReasoning, completed: true };
}
