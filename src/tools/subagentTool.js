import { resolveActiveCredentials } from '../auth/resolve.js';
import { streamChatCompletion } from '../chat/client.js';
import { getDefinitions, dispatchTool } from './registry.js';
import { TOOL_DEFINITIONS } from './definitions.js';

/**
 * Handler progres global subagent — dipasang oleh integrasi terminal
 * (LiveActivity) saat tool `delegate_task` paralel berjalan. Handler per
 * panggilan (`options.onProgress`) diprioritaskan untuk pengujian.
 */
let subagentProgressHandler = null;

/**
 * Memasang handler progres global. Mengembalikan handler sebelumnya agar
 * bisa dipulihkan (tanpa tumpang tindih antar tool).
 *
 * @param {Function|null} fn - (event: {role:string, task:string, turn:number, status:string}) => void
 * @returns {Function|null}
 */
export function setSubagentProgressHandler(fn) {
  const previous = subagentProgressHandler;
  subagentProgressHandler = typeof fn === 'function' ? fn : null;
  return previous;
}

/**
 * Konfigurasi subagent Punakawan terisolasi:
 * - semAIr  : Arsitek & Pamomong Strategi (READ-ONLY: merancang rencana & membedah kebutuhan).
 * - pAItruk : Scout & Penjelajah (Murni read-only: membaca, mencari berkas, webfetch/websearch).
 * - gAIreng : Auditor & Verifikator (Uji mutu: run_command, diagnostics, inspeksi berkas).
 * - bAIwor  : Master Builder (Pekerja sub-tugas kode terarah).
 */
export const SUBAGENT_ROLES = {
  semAIr: {
    name: 'semAIr',
    title: 'Arsitek & Pamomong Strategi',
    emoji: '👑',
    allowedTools: ['read_file', 'list_directory', 'search_files', 'websearch', 'webfetch'],
    systemPrompt: `Kamu adalah semAIr — Sang Arsitek & Pamomong Strategi tim Punakawan bAIwor Code.
Peranmu merancang rencana kerja dan membedah kebutuhan (READ-ONLY).
Aturan ketat:
1. Kamu HANYA boleh membaca dan mencari berkas (read_file, search_files, list_directory, websearch, webfetch) untuk memahami konteks sebelum menyusun rencana.
2. Dilarang keras mengubah berkas atau menjalankan perintah penulisan.
3. Susun laporan akhir berupa rencana terstruktur: tujuan, urutan langkah, berkas yang perlu disentuh, serta risiko dan asumsi — untuk agen utama.
Jawab lugas, to-the-point, dan jujur (blakasuta).`,
  },
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
 * Batas putaran bawaan per peran. pAItruk mendapat jatah lebih longgar karena
 * tugas eksplorasi memang membaca banyak berkas sebelum bisa menyimpulkan;
 * semAIr juga agak longgar karena harus membedah konteks sebelum merancang.
 */
export const DEFAULT_MAX_TURNS_BY_ROLE = {
  semAIr: 10,
  pAItruk: 12,
  gAIreng: 8,
  bAIwor: 8,
};

export const MAX_PARALLEL_TASKS = 6;
export const PARALLEL_CONCURRENCY = 3;

/**
 * Menjalankan SATU subagent Punakawan dalam loop terisolasi.
 *
 * @param {Object} args
 * @param {string} args.role - 'semAIr' | 'pAItruk' | 'gAIreng' | 'bAIwor'
 * @param {string} args.task - Deskripsi tugas
 * @param {string} [args.context] - Konteks tambahan
 * @param {number} [args.max_turns] - Batas putaran (1-20; default per peran, lihat DEFAULT_MAX_TURNS_BY_ROLE)
 * @param {Object} [options] - Opsi runtime & dependency injection ({ completionFn, credentials, signal })
 * @returns {Promise<{ success: boolean, output: string, role?: string, turns?: number }>}
 */
async function runSingleDelegate(args = {}, options = {}) {
  const { role, task, context = '', max_turns } = args || {};

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
  const defaultTurns = DEFAULT_MAX_TURNS_BY_ROLE[role] || 8;
  const maxTurns = Math.max(1, Math.min(20, Number(max_turns) || defaultTurns));

  // Progres: mulai → tiap turn → selesai/gagal. Kegagalan callback tidak boleh
  // menggagalkan subagent.
  const progressFn = options.onProgress || subagentProgressHandler;
  const emitProgress = (status, turnNumber = 0) => {
    if (typeof progressFn !== 'function') return;
    try {
      progressFn({ role, task: String(task).trim(), turn: turnNumber, status });
    } catch {
      // abaikan — progres murni informatif
    }
  };
  emitProgress('started', 0);

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
  let toolCallCount = 0;
  // Alasan loop berhenti tanpa laporan: 'tool_budget' | 'empty' | null (batas putaran).
  let stopReason = null;
  const startedAt = Date.now();
  const MAX_DURATION_MS = 5 * 60 * 1000;
  const MAX_TOOL_CALLS = 40;

  /**
   * Satu panggilan model ke provider (atau `completionFn` saat pengujian).
   * Melempar error ber-`code: 'NO_CREDENTIALS'` bila kredensial belum tersedia.
   */
  const requestCompletion = async (outboundMessages, tools) => {
    if (typeof options.completionFn === 'function') {
      return await options.completionFn({
        messages: [...outboundMessages],
        tools,
        signal: options.signal,
        turn,
      });
    }

    const credentials = options.credentials || (await resolveActiveCredentials());
    if (!credentials || !(credentials.apiKey || credentials.headers?.Authorization)) {
      const err = new Error('Kredensial model AI tidak ditemukan untuk menjalankan subagent.');
      err.code = 'NO_CREDENTIALS';
      throw err;
    }

    let contentBuffer = '';
    const result = await streamChatCompletion({
      credentials,
      messages: outboundMessages,
      tools,
      signal: options.signal,
      onDelta: (chunk) => {
        contentBuffer += chunk;
      },
    });
    if (!result.content && contentBuffer) {
      result.content = contentBuffer;
    }
    return result;
  };

  /**
   * Giliran penutup TANPA tool: memaksa subagent menyusun laporan dari temuan
   * yang sudah ada ketika batas putaran/panggilan tool tercapai. Tanpa ini,
   * seluruh hasil investigasi dibuang dan agen utama menerima error kosong.
   */
  const attemptWrapUpReport = async (reasonText) => {
    try {
      const wrap = await requestCompletion(
        [
          ...messages,
          {
            role: 'user',
            content:
              `[Sistem] ${reasonText}. JANGAN memanggil tool lagi. ` +
              'Tuliskan laporan akhir sekarang dari hasil yang sudah kamu peroleh, ' +
              'dan sebutkan secara jujur bagian mana yang belum tuntas.',
          },
        ],
        []
      );
      return String(wrap?.content || '').trim();
    } catch {
      return '';
    }
  };

  while (turn < maxTurns) {
    turn += 1;

    if (options.signal?.aborted) {
      emitProgress('aborted', turn);
      return {
        success: false,
        output: `[delegate_task] Subagent ${roleConfig.name} dibatalkan oleh sinyal pengguna.`,
        role,
        turns: turn,
      };
    }

    if (Date.now() - startedAt > MAX_DURATION_MS) {
      emitProgress('failed', turn);
      return {
        success: false,
        output: `[delegate_task] Subagent ${roleConfig.name} dihentikan: melebihi batas waktu 5 menit tanpa laporan akhir.`,
        role,
        turns: turn,
      };
    }

    emitProgress('turn', turn);

    let completionResult = null;
    try {
      completionResult = await requestCompletion(messages, allowedToolDefs);
    } catch (err) {
      emitProgress('failed', turn);
      return {
        success: false,
        output:
          err.code === 'NO_CREDENTIALS'
            ? '[delegate_task] Kredensial model AI tidak ditemukan untuk menjalankan subagent.'
            : `[delegate_task] Status: GAGAL — subagent ${roleConfig.name} berhenti karena error: ${err.message}`,
        role,
        turns: turn,
      };
    }

    const { content = '', tool_calls } = completionResult || {};

    // Jika model meminta pemanggilan tool
    if (Array.isArray(tool_calls) && tool_calls.length > 0) {
      if (toolCallCount + tool_calls.length > MAX_TOOL_CALLS) {
        stopReason = 'tool_budget';
        break;
      }
      toolCallCount += tool_calls.length;

      // Normalisasi ID tool call SEBELUM pesan assistant disimpan, supaya
      // pasangan assistant.tool_calls ↔ role:'tool' selalu konsisten.
      // Fallback lama (`call_${Date.now()}`) bisa bentrok antar tool call
      // yang selesai pada milidetik yang sama, dan tidak cocok dengan ID
      // yang tersimpan di pesan assistant.
      tool_calls.forEach((tc, idx) => {
        if (!tc.id) tc.id = `call_${turn}_${idx}`;
      });

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
            tool_call_id: tc.id,
            name: fnName,
            content: `Error: Tool "${fnName}" dilarang untuk peran ${roleConfig.name}. Tool yang diizinkan: ${roleConfig.allowedTools.join(', ')}.`,
          });
          continue;
        }

        const res = await dispatchTool(fnName, rawArgs, { signal: options.signal });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
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

    // Respons kosong tanpa tool_calls bukan laporan: minta laporan penutup.
    stopReason = 'empty';
    break;
  }

  if (!finalReport) {
    const stop = stopReason || 'max_turns';
    const reasonText =
      stop === 'tool_budget'
        ? `Batas ${MAX_TOOL_CALLS} panggilan tool tercapai`
        : stop === 'empty'
          ? 'Model mengakhiri giliran tanpa laporan'
          : `Batas ${turn} putaran tercapai`;

    const abortedResult = () => ({
      success: false,
      output: `[delegate_task] Subagent ${roleConfig.name} dibatalkan oleh sinyal pengguna.`,
      role,
      turns: turn,
    });
    if (options.signal?.aborted) {
      emitProgress('aborted', turn);
      return abortedResult();
    }

    // Selamatkan temuan yang sudah ada lewat satu giliran tanpa tool.
    const partialReport = await attemptWrapUpReport(reasonText);

    if (options.signal?.aborted) {
      emitProgress('aborted', turn);
      return abortedResult();
    }

    if (partialReport) {
      emitProgress('failed', turn);
      return {
        success: false,
        partial: true,
        output:
          `${roleConfig.emoji} ⚠️ [Laporan Parsial Subagent ${roleConfig.name} - ${roleConfig.title}]\n` +
          `${reasonText}; pekerjaan mungkin belum tuntas.\n\n${partialReport}\n\n` +
          '[delegate_task] Status: GAGAL PARSIAL — jangan anggap tugas ini selesai; ' +
          'periksa bagian yang belum tuntas sebelum melanjutkan.',
        role,
        turns: turn,
      };
    }

    emitProgress('failed', turn);
    const cause =
      stop === 'tool_budget'
        ? `melebihi batas ${MAX_TOOL_CALLS} panggilan tool tanpa laporan akhir`
        : stop === 'empty'
          ? 'mengakhiri giliran tanpa laporan akhir'
          : `mencapai batas ${turn} putaran tanpa laporan akhir`;
    return {
      success: false,
      output: `[delegate_task] Status: GAGAL — Subagent ${roleConfig.name} ${cause}. Pekerjaan mungkin belum selesai.`,
      role,
      turns: turn,
    };
  }

  emitProgress('completed', turn);
  return {
    success: true,
    output: `${roleConfig.emoji} [Laporan Subagent ${roleConfig.name} - ${roleConfig.title}]:\n\n${finalReport}`,
    role,
    turns: turn,
  };
}

/**
 * Menjalankan fungsi async untuk tiap item dengan batas konkurensi.
 * Hasil dikembalikan sesuai urutan input.
 */
async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await fn(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/**
 * Titik masuk `delegate_task`: satu tugas, atau beberapa tugas PARALEL dalam
 * satu panggilan. Setiap subagent tetap terisolasi (histori & tool sendiri);
 * yang dibagikan hanya sinyal pembatalan dan kredensial model.
 *
 * Mode paralel: maksimum 6 tugas, 3 berjalan bersamaan.
 *
 * @param {Object} args
 * @param {string} [args.role] - Peran untuk mode tunggal
 * @param {string} [args.task] - Tugas untuk mode tunggal
 * @param {Array<{role:string, task:string, context?:string, max_turns?:number}>} [args.tasks]
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function handleDelegateTask(args = {}, options = {}) {
  const tasks = Array.isArray(args?.tasks) ? args.tasks.filter(Boolean) : null;
  if (!tasks || tasks.length === 0) {
    return runSingleDelegate(args, options);
  }

  if (tasks.length > MAX_PARALLEL_TASKS) {
    return {
      success: false,
      output: `[delegate_task] Terlalu banyak tugas paralel (${tasks.length}). Maksimum ${MAX_PARALLEL_TASKS} tugas.`,
      results: [],
    };
  }

  // Resolve kredensial sekali saja untuk semua subagent paralel. Handler
  // progres (eksplisit atau global) diteruskan ke setiap subagent.
  const progressFn = options.onProgress || subagentProgressHandler;
  let sharedOptions = progressFn ? { ...options, onProgress: progressFn } : options;
  if (!options.completionFn && !options.credentials) {
    try {
      sharedOptions = { ...sharedOptions, credentials: await resolveActiveCredentials() };
    } catch (err) {
      return {
        success: false,
        output: `[delegate_task] Kredensial model tidak tersedia untuk subagent paralel: ${err.message}`,
        results: [],
      };
    }
  }

  const startedAt = Date.now();
  const results = await runWithConcurrency(
    tasks,
    PARALLEL_CONCURRENCY,
    async (taskArgs) => {
      try {
        return await runSingleDelegate(taskArgs || {}, sharedOptions);
      } catch (err) {
        return {
          success: false,
          role: taskArgs?.role,
          turns: 0,
          output: `[delegate_task] Subagent ${taskArgs?.role || 'unknown'} gagal: ${err.message}`,
        };
      }
    }
  );

  const sections = results.map((result, index) => {
    const roleName = result?.role || tasks[index]?.role || 'subagent';
    const roleConfig = SUBAGENT_ROLES[roleName];
    const emoji = roleConfig?.emoji || '🤖';
    return `### ${index + 1}. ${emoji} ${roleName}\n${result?.output || '(tanpa laporan)'}`;
  });

  const failed = results.filter((result) => !result?.success).length;
  const summary =
    `[delegate_task] ${results.length} subagent paralel selesai dalam ` +
    `${((Date.now() - startedAt) / 1000).toFixed(1)}s — ` +
    `${results.length - failed} sukses, ${failed} gagal (konkurensi ${PARALLEL_CONCURRENCY}).`;

  return {
    success: failed === 0,
    output: `${summary}\n\n${sections.join('\n\n')}`,
    results,
    mode: 'parallel',
    turns: results.reduce((sum, result) => sum + (Number(result?.turns) || 0), 0),
  };
}
