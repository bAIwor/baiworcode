import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * Tool Registry untuk bAIwor Code.
 * Mengelola pendaftaran tool secara modular, pembuatan skema OpenAI-compatible,
 * pemeriksaan ketersediaan (check_fn), pemotongan output budget (A2/F5),
 * serta eksekusi yang aman tanpa switch-case hard-coded (F4).
 */

const tools = new Map(); // name -> { name, toolset, schema, handler, check, maxChars, emoji }

/**
 * Batas maksimum karakter output tool sebelum dikirim kembali ke context LLM (~10.000 token)
 */
export const MAX_TOOL_OUTPUT_CHARS = 40000;

/**
 * Memotong output yang melebihi budget konteks agar tidak membuat context window meluap,
 * dan menyimpan output lengkap ke disk (.baiwor/reports/tool-outputs/) agar tidak hilang.
 */
export function capToolOutput(text, maxChars = MAX_TOOL_OUTPUT_CHARS) {
  if (!text || typeof text !== 'string') return String(text || '');
  if (text.length <= maxChars) return text;
  const cutCount = text.length - maxChars;

  let spillPath = '';
  try {
    const reportsDir = path.join(os.homedir(), '.baiwor', 'reports', 'tool-outputs');
    fs.mkdirSync(reportsDir, { recursive: true });
    const id = crypto.randomBytes(8).toString('hex');
    const fileName = `output-${Date.now()}-${id}.txt`;
    spillPath = path.join(reportsDir, fileName);
    fs.writeFileSync(spillPath, text, 'utf8');
  } catch {}

  const spillNotice = spillPath ? ` Disimpan lengkap di: ${spillPath}.` : '';
  return (
    text.slice(0, maxChars) +
    `\n\n… [Output dipotong: ${cutCount} karakter melebihi budget context.${spillNotice} Gunakan offset/limit atau persempit perintah jika perlu]`
  );
}

function safeCheck(fn) {
  try {
    return !!fn();
  } catch {
    return false;
  }
}

/**
 * Mendaftarkan sebuah tool ke dalam registry bAIwor Code
 *
 * @param {Object} options
 * @param {string} options.name - Nama unik tool (mis: 'read_file')
 * @param {string} [options.toolset='core'] - Kategori toolset
 * @param {Object} options.schema - Skema JSON Schema { description, parameters }
 * @param {Function} options.handler - Fungsi async yang menerima objek argumen
 * @param {Function} [options.check=null] - Fungsi probe ketersediaan
 * @param {number} [options.maxChars=40000] - Batas maksimum karakter hasil
 * @param {string} [options.emoji='⚡'] - Ikon visual tool
 */
export function registerTool({
  name,
  toolset = 'core',
  schema,
  handler,
  check = null,
  maxChars = MAX_TOOL_OUTPUT_CHARS,
  emoji = '⚡',
}) {
  if (!name || typeof name !== 'string') {
    throw new Error('Tool registration membutuhkan nama (string).');
  }
  if (!schema || typeof schema !== 'object') {
    throw new Error(`Tool '${name}': schema harus berupa object.`);
  }
  if (typeof handler !== 'function') {
    throw new Error(`Tool '${name}': handler harus berupa function.`);
  }

  tools.set(name, {
    name,
    toolset,
    schema,
    handler,
    check,
    maxChars,
    emoji,
  });
}

/**
 * Mengambil daftar tool dalam format OpenAI Function Calling
 *
 * @param {Array<string>} [names=null] - Filter daftar nama tool tertentu
 * @returns {Array<Object>}
 */
export function getDefinitions(names = null) {
  const out = [];
  for (const t of tools.values()) {
    if (names && !names.includes(t.name)) continue;
    if (t.check && !safeCheck(t.check)) continue;
    out.push({
      type: 'function',
      function: {
        name: t.name,
        ...t.schema,
      },
    });
  }
  return out;
}

/**
 * Menjalankan tool dari registry secara aman
 *
 * @param {string} name - Nama tool
 * @param {string|Object} rawArgs - Argumen string JSON atau Object
 * @param {Object} [options] - Opsi runtime yang diteruskan ke handler (mis. { signal })
 * @returns {Promise<{ success: boolean, output: string }>}
 */
export async function dispatchTool(name, rawArgs, options = {}) {
  const t = tools.get(name);
  if (!t) {
    return {
      success: false,
      output: `Error: Tool '${name}' tidak dikenal dalam sistem bAIwor Code.`,
    };
  }

  if (t.check && !safeCheck(t.check)) {
    return {
      success: false,
      output: `Error: Tool '${name}' saat ini tidak aktif atau dependensinya belum terpenuhi.`,
    };
  }

  let args = rawArgs;
  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return {
        success: false,
        output: `Error: Format argumen JSON untuk ${name} tidak valid: ${rawArgs}`,
      };
    }
  }

  args = args || {};

  try {
    const res = await t.handler(args, options);
    const success = res && typeof res === 'object' && 'success' in res ? res.success : true;
    const rawOutput = res && typeof res === 'object' && 'output' in res ? res.output : String(res || '');
    return {
      success,
      output: capToolOutput(rawOutput, t.maxChars),
    };
  } catch (err) {
    return {
      success: false,
      output: `Tool gagal dieksekusi: ${err.message}`,
    };
  }
}

/**
 * Mengambil metadata seluruh toolset yang terdaftar
 */
export function listToolsets() {
  const groups = {};
  for (const t of tools.values()) {
    groups[t.toolset] = groups[t.toolset] || [];
    groups[t.toolset].push(t.name);
  }
  return groups;
}

/**
 * Mengosongkan registry (berguna untuk pengujian)
 */
export function clearRegistry() {
  tools.clear();
}
