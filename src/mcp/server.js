import readline from 'node:readline';
import { getDefinitions, dispatchTool } from '../tools/index.js';
import { APP_NAME, VERSION, TAGLINE } from '../branding.js';

/**
 * Menjalankan bAIwor Code sebagai MCP Server melalui standar input/output (stdio).
 * Kompatibel dengan berbagai aplikasi dan klien MCP berstandar stdio.
 */
export function startMcpServer() {
  // stdout adalah kanal JSON-RPC; log apa pun dari tool/handler harus ke stderr.
  console.log = (...args) => console.error(...args);

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
            instructions: `${APP_NAME} — ${TAGLINE}. Menyediakan 15 tools bawaan untuk manipulasi berkas, terminal, penelusuran, diagnosa, dan kecerdasan web.`,
          });
          break;
        }

        case 'ping': {
          sendResponse(id, {});
          break;
        }

        case 'tools/list': {
          const defs = getDefinitions();
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

          const res = await dispatchTool(toolName, toolArgs);
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
