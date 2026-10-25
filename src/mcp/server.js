import readline from 'node:readline';
import { getDefinitions, dispatchTool } from '../tools/index.js';
import { APP_NAME, VERSION, TAGLINE } from '../branding.js';

/**
 * Tool yang aman diekspos tanpa persetujuan manusia di MCP server mode:
 * read-only atau state in-memory. Tool tulis/perintah harus di-opt-in
 * eksplisit karena klien MCP eksternal tidak punya prompt approval.
 */
export const MCP_SAFE_TOOLS = new Set([
  'read_file',
  'list_directory',
  'search_files',
  'webfetch',
  'websearch',
  'todo_list',
]);

/** Apakah operator membuka tool tulis/perintah untuk MCP server mode. */
export function isMcpDangerousAllowed(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.BAIWOR_MCP_ALLOW_DANGEROUS || '').trim());
}

export function isMcpToolAllowed(name, { allowDangerous = false } = {}) {
  if (!name) return false;
  return allowDangerous || MCP_SAFE_TOOLS.has(name);
}

export function filterMcpDefinitions(defs, { allowDangerous = false } = {}) {
  if (allowDangerous) return defs;
  return defs.filter((def) => MCP_SAFE_TOOLS.has(def?.function?.name));
}

/**
 * Menjalankan bAIwor Code sebagai MCP Server melalui standar input/output (stdio).
 * Kompatibel dengan berbagai aplikasi dan klien MCP berstandar stdio.
 *
 * @param {{allowDangerous?: boolean}} [options]
 */
export function startMcpServer(options = {}) {
  // stdout adalah kanal JSON-RPC; log apa pun dari tool/handler harus ke stderr.
  console.log = (...args) => console.error(...args);

  const allowDangerous =
    options.allowDangerous === true || isMcpDangerousAllowed();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  function sendResponse(id, result) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  }

  function sendError(id, code, message) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code, message },
      }) + '\n'
    );
  }

  rl.on('line', async (line) => {
    const raw = line.trim();
    if (!raw) return;

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      sendError(null, -32700, 'Parse error: invalid JSON');
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      sendError(null, -32600, 'Invalid Request: message harus berupa object JSON-RPC.');
      return;
    }

    const { id, method, params } = msg;

    // Handle notifications (tidak mengembalikan respon id)
    if (!id && id !== 0) {
      // misal: 'notifications/initialized'
      return;
    }

    try {
      switch (method) {
        case 'initialize': {
          sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: {
              name: 'baiworcode',
              version: VERSION,
            },
            instructions:
              `${APP_NAME} — ${TAGLINE}. ` +
              (allowDangerous
                ? 'Semua 15 tools bawaan tersedia; operator sudah mengaktifkan tool tulis/perintah.'
                : 'Mode aman: hanya tool read-only yang diekspos. Set BAIWOR_MCP_ALLOW_DANGEROUS=1 atau jalankan dengan --allow-dangerous untuk mengaktifkan tool tulis/perintah.'),
          });
          break;
        }

        case 'ping': {
          sendResponse(id, {});
          break;
        }

        case 'tools/list': {
          const defs = filterMcpDefinitions(getDefinitions(), { allowDangerous });
          const tools = defs.map((d) => ({
            name: d.function.name,
            description: d.function.description,
            inputSchema: d.function.parameters || { type: 'object', properties: {} },
          }));
          sendResponse(id, { tools });
          break;
        }

        case 'tools/call': {
          const toolName = params?.name;
          const toolArgs = params?.arguments || {};

          if (!toolName) {
            sendError(id, -32602, 'Parameter "name" wajib diisi pada tools/call.');
            return;
          }

          if (!isMcpToolAllowed(toolName, { allowDangerous })) {
            sendResponse(id, {
              content: [
                {
                  type: 'text',
                  text:
                    `Tool '${toolName}' diblokir di MCP server mode (default read-only). ` +
                    'Set BAIWOR_MCP_ALLOW_DANGEROUS=1 atau jalankan server dengan --allow-dangerous.',
                },
              ],
              isError: true,
            });
            break;
          }

          // Klien MCP adalah batas tinjauan: bila operator sudah membuka
          // tool tulis/perintah, approval interaktif tidak punya manusia
          // untuk meninjaunya. Mode aman default hanya meloloskan tool
          // read-only, jadi skipApproval tidak membuka eksekusi destruktif.
          const res = await dispatchTool(toolName, toolArgs, { skipApproval: true });
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: res.output,
              },
            ],
            isError: !res.success,
          });
          break;
        }

        default:
          sendError(id, -32601, `Method '${method}' tidak ditemukan.`);
          break;
      }
    } catch (err) {
      sendError(id, -32603, `Internal error: ${err.message}`);
    }
  });

  process.on('SIGINT', () => process.exit(0));
}
