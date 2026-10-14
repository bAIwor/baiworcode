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
  const accumulatedToolCalls = [];

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
            const parsed = JSON.parse(jsonStr);
            const choice = parsed.choices?.[0];
            const delta = choice?.delta;

            if (!delta && !choice?.message) continue;

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
          } catch {
            // Abaikan potongan baris SSE individual yang tidak valid
          }
        }
      }
    }

    // Periksa sisa buffer jika masih ada data yang belum terurai
    if (buffer.trim().startsWith('data:')) {
      const jsonStr = buffer.trim().slice(5).trim();
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
