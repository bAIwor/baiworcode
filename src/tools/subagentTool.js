import { resolveActiveCredentials } from '../auth/resolve.js';
import { streamChatCompletion } from '../chat/client.js';
import { getDefinitions, dispatchTool } from './registry.js';
import { TOOL_DEFINITIONS } from './definitions.js';

/**
 * Konfigurasi subagent Punakawan terisolasi:
 * - pAItruk : Scout & Penjelajah (Murni read-only: membaca, mencari berkas, webfetch/websearch).
 * - gAIreng : Auditor & Verifikator (Uji mutu: run_command, diagnostics, inspeksi berkas).
 * - bAIwor  : Master Builder (Pekerja sub-tugas kode terarah).
 */
export const SUBAGENT_ROLES = {
  pAItruk: {
    name: 'pAItruk',
    title: 'Scout & Penjelajah',
    emoji: '🔭',
    allowedTools: ['read_file', 'list_directory', 'search_files', 'webfetch', 'websearch'],
    systemPrompt: `Kamu adalah pAItruk — Sang Scout & Penjelajah handal tim Punakawan bAIwor Code.
Peranmu murni investigasi & eksplorasi (READ-ONLY).
Aturan ketat:
1. Kamu HANYA boleh membaca dan mencari berkas (read_file, search_files, list_directory, websearch, webfetch).
2. Dilarang keras mencoba mengubah berkas atau menjalankan perintah penulisan.
3. Setelah menemukan informasi yang diminta, berikan laporan akhir terstruktur (lokasi berkas, fungsi/baris relevan, dan analisis singkat) untuk agen utama.
Jawab lugas, to-the-point, dan jujur (blakasuta).`,
  },
  gAIreng: {
    name: 'gAIreng',
    title: 'Auditor & Verifikator',
    emoji: '⚖️',
    allowedTools: ['read_file', 'search_files', 'list_directory', 'run_command', 'diagnostics'],
    systemPrompt: `Kamu adalah gAIreng — Sang Auditor & Verifikator mutu tim Punakawan bAIwor Code.
Peranmu menguji kebenaran, memeriksa test suite, linter, dan memvalidasi pekerjaan.
Aturan:
1. Gunakan run_command untuk menjalankan perintah pengujian (seperti npm test, linter, dsb.) dan diagnostics untuk validasi.
2. Periksa berkas bila perlu memverifikasi kode atau pesan galat.
3. Berikan laporan verifikasi jelas: LULUS atau GAGAL, beserta rincian kegagalan dan rekomendasi perbaikan.
Jawab lugas, to-the-point, dan jujur (blakasuta).`,
  },
  bAIwor: {
    name: 'bAIwor',
    title: 'Master Builder',
    emoji: '🔨',
    allowedTools: [
      'read_file',
      'write_file',
      'edit_file',
      'patch_file',
      'list_directory',
      'search_files',
      'run_command',
      'diagnostics',
    ],
    systemPrompt: `Kamu adalah bAIwor — Sang Master Builder tim Punakawan bAIwor Code.
Peranmu menyelesaikan sub-tugas penulisan atau pengubahan kode terfokus.
Tuntaskan tugas yang didelegasikan dan laporkan hasil konkretnya kepada agen utama.
Jawab lugas, to-the-point, dan jujur (blakasuta).`,
  },
};

/**
 * Menjalankan subagent Punakawan dalam loop terisolasi.
 *
 * @param {Object} args
 * @param {string} args.role - 'pAItruk' | 'gAIreng' | 'bAIwor'
 * @param {string} args.task - Deskripsi tugas
 * @param {string} [args.context] - Konteks tambahan
 * @param {number} [args.max_turns=8] - Batas putaran (1-20)
 * @param {Object} [options] - Opsi runtime & dependency injection ({ completionFn, credentials, signal })
 * @returns {Promise<{ success: boolean, output: string, role?: string, turns?: number }>}
 */
export async function handleDelegateTask(args = {}, options = {}) {
  const { role, task, context = '', max_turns = 8 } = args || {};

  if (!role || !SUBAGENT_ROLES[role]) {
    const rolesList = Object.keys(SUBAGENT_ROLES).join(', ');
    return {
      success: false,
      output: `[delegate_task] Peran "${role}" tidak dikenal. Peran yang tersedia: ${rolesList}.`,
    };
  }

  if (!task || typeof task !== 'string' || !task.trim()) {
    return {
      success: false,
      output: '[delegate_task] Parameter "task" wajib diisi dengan instruksi tugas yang jelas.',
    };
  }

  const roleConfig = SUBAGENT_ROLES[role];
  const maxTurns = Math.max(1, Math.min(20, Number(max_turns) || 8));

  // Ambil definisi tool yang diizinkan untuk peran ini
  const rawDefs = getDefinitions();
  const allDefs = rawDefs && rawDefs.length > 0 ? rawDefs : TOOL_DEFINITIONS;
  const allowedToolDefs = allDefs.filter((d) =>
    roleConfig.allowedTools.includes(d.function?.name)
  );

  const messages = [
    { role: 'system', content: roleConfig.systemPrompt },
    {
      role: 'user',
      content: context
        ? `[Tugas Delegasi untuk ${roleConfig.name}]:\n${task.trim()}\n\n[Konteks Tambahan]:\n${context.trim()}`
        : `[Tugas Delegasi untuk ${roleConfig.name}]:\n${task.trim()}`,
    },
  ];

  let turn = 0;
  let finalReport = '';

  while (turn < maxTurns) {
    turn += 1;

    if (options.signal?.aborted) {
      return {
        success: false,
        output: `[delegate_task] Subagent ${roleConfig.name} dibatalkan oleh sinyal pengguna.`,
        role,
        turns: turn,
      };
    }

    let completionResult = null;

    if (typeof options.completionFn === 'function') {
      try {
        completionResult = await options.completionFn({
          messages: [...messages],
          tools: allowedToolDefs,
          signal: options.signal,
          turn,
        });
      } catch (err) {
        return {
          success: false,
          output: `[delegate_task] Eksekusi subagent gagal: ${err.message}`,
          role,
          turns: turn,
        };
      }
    } else {
      const credentials = options.credentials || resolveActiveCredentials();
      if (!credentials || !credentials.apiKey) {
        return {
          success: false,
          output: '[delegate_task] Kredensial model AI tidak ditemukan untuk menjalankan subagent.',
          role,
          turns: turn,
        };
      }

      let contentBuffer = '';
      try {
        completionResult = await streamChatCompletion({
          credentials,
          messages,
          tools: allowedToolDefs,
          signal: options.signal,
          onDelta: (chunk) => {
            contentBuffer += chunk;
          },
        });
        if (!completionResult.content && contentBuffer) {
          completionResult.content = contentBuffer;
        }
      } catch (err) {
        return {
          success: false,
          output: `[delegate_task] Komunikasi model untuk subagent ${roleConfig.name} gagal: ${err.message}`,
          role,
          turns: turn,
        };
      }
    }

    const { content = '', tool_calls } = completionResult || {};

    // Jika model meminta pemanggilan tool
    if (Array.isArray(tool_calls) && tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: content || '',
        tool_calls,
      });

      for (const tc of tool_calls) {
        const fnName = tc.function?.name || 'unknown';
        const rawArgs = tc.function?.arguments || '{}';

        // Pemeriksaan kepatuhan peran (sandbox role enforcement)
        if (!roleConfig.allowedTools.includes(fnName)) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id || `call_${Date.now()}`,
            name: fnName,
            content: `Error: Tool "${fnName}" dilarang untuk peran ${roleConfig.name}. Tool yang diizinkan: ${roleConfig.allowedTools.join(', ')}.`,
          });
          continue;
        }

        const res = await dispatchTool(fnName, rawArgs, { signal: options.signal });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id || `call_${Date.now()}`,
          name: fnName,
          content: res.output,
        });
      }

      continue;
    }

    // Jika model merespons dengan teks naratif tanpa tool_calls, ini adalah laporan akhir
    if (content && typeof content === 'string' && content.trim()) {
      finalReport = content.trim();
      break;
    }

    // Jika respons kosong tanpa tool_calls, keluar
    break;
  }

  if (!finalReport) {
    finalReport = `Subagent ${roleConfig.name} telah menyelesaikan siklus penugasan (${turn} putaran) tanpa laporan teks tambahan.`;
  }

  return {
    success: true,
    output: `${roleConfig.emoji} [Laporan Subagent ${roleConfig.name} - ${roleConfig.title}]:\n\n${finalReport}`,
    role,
    turns: turn,
  };
}
