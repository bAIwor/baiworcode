import chalk from 'chalk';
import { resolveActiveCredentials } from '../auth/resolve.js';
import { conversationSession } from './conversation.js';
import { streamChatCompletion } from './client.js';
import { TOOL_DEFINITIONS, executeTool } from '../tools/index.js';
import { todoStore, resetTodoStore } from '../tools/todoTool.js';
import { renderTimeline, renderTodoChecklist, formatTodoProgress } from './timeline.js';
import { LiveActivity } from './liveActivity.js';
import { classifyCommand } from '../tools/sandbox.js';
import { getContextUsage, formatContextIndicator, formatContextWarning } from './context.js';

export { conversationSession };

let activeAbortController = null;
let isStreamingActive = false;

/**
 * Kode transport yang menandakan masalah jaringan/waktu habis — bukan kesalahan
 * kredensial atau permintaan. Dipakai untuk memberi pesan yang lebih ramah
 * ketimbang menampilkan "fetch failed" mentah dari runtime.
 */
const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_RST',
]);

const TIMEOUT_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

export function isNetworkError(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError') return true;
  const code = err.code || err.cause?.code;
  return NETWORK_ERROR_CODES.has(code);
}

function networkErrorCode(err) {
  return err?.code || err?.cause?.code || null;
}

/**
 * Membatalkan proses streaming yang sedang berlangsung jika ada.
 * Mengembalikan true jika ada streaming yang berhasil dibatalkan.
 */
export function abortCurrentChat() {
  if (isStreamingActive && activeAbortController) {
    activeAbortController.abort();
    return true;
  }
  return false;
}

/**
 * Mengosongkan riwayat percakapan.
 *
 * Daftar tugas ikut direset karena ia bagian dari konteks sesi: tanpa itu,
 * checklist dari pekerjaan sebelumnya akan muncul lagi pada `todo_list`
 * pertama di sesi berikutnya dan menyesatkan model.
 */
export function resetConversation() {
  conversationSession.reset();
  resetTodoStore();
  console.log(chalk.green('\n  ✓ Riwayat percakapan telah direset.\n'));
}

/**
 * Menangani prompt chat dari pengguna dan mengirimkan ke LLM aktif secara streaming.
 * Mendukung Agentic Execution Loop dengan pemanggilan tools (Tahap 3B).
 *
 * @param {string} promptText
 */
export async function handleUserChat(promptText) {
  const query = (promptText || '').trim();
  if (!query) return;

  // 1. Ambil kredensial provider aktif
  let credentials;
  try {
    credentials = await resolveActiveCredentials();
  } catch (err) {
    console.log(chalk.yellow(`\n  ⚠️  ${err.message}`));
    console.log(chalk.gray(`     Ketik ${chalk.cyan('/model')} untuk mengatur model atau ${chalk.cyan('/login')} untuk login provider.\n`));
    return;
  }

  // 2. Tambahkan pesan user ke memori sesi
  conversationSession.addUserMessage(query);

  // 3. Setup Indikator Berpikir (Thinking Spinner)
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIdx = 0;
  let spinnerInterval = null;

  /**
   * Menghapus baris spinner memakai carriage return.
   * Hanya berguna di terminal sungguhan — saat output dialihkan (pipe/redirect),
   * `\r` tidak menimpa apa pun sehingga escape code-nya justru mengotori berkas.
   */
  const clearSpinnerLine = (suffix = '') => {
    if (process.stdout.isTTY) process.stdout.write(`\r\x1b[K${suffix}`);
  };

  const startThinkingSpinner = (msg = 'bAIwor sedang berpikir...') => {
    stopThinkingSpinner();
    // Animasi spinner bergantung pada carriage return untuk menimpa baris
    // sebelumnya. Bila stdout bukan TTY (mis. `baiworcode "prompt" > hasil.txt`),
    // animasi dilewati agar ribuan frame tidak membanjiri keluaran.
    if (!process.stdout.isTTY) return;
    process.stdout.write(`\n  ${chalk.cyan(spinnerFrames[0])} ${chalk.dim(msg)}`);
    spinnerInterval = setInterval(() => {
      frameIdx = (frameIdx + 1) % spinnerFrames.length;
      process.stdout.write(`\r  ${chalk.cyan(spinnerFrames[frameIdx])} ${chalk.dim(msg)}`);
    }, 80);
  };

  const stopThinkingSpinner = () => {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
  };

  // Blok aktivitas tool yang digambar ulang di tempat: tiap langkah muncul
  // begitu selesai, sementara langkah yang sedang berjalan berputar. Di luar
  // TTY ia nonaktif dan pohon dicetak sekali di akhir sebagai gantinya.
  const live = new LiveActivity({
    stream: process.stdout,
    useColor: Boolean(process.stdout.isTTY),
  });

  /**
   * Sebagian `run_command` meminta persetujuan pengguna sebelum dieksekusi.
   * Prompt itu mencetak ke stdout, jadi blok aktivitas harus disembunyikan
   * dulu agar hitungan baris tidak melenceng dan tampilan tidak rusak.
   */
  const toolMayPrompt = (fnName, args) => {
    if (fnName !== 'run_command' || !args || !args.command) return false;
    return classifyCommand(String(args.command), { workspace: process.cwd() }).decision === 'confirm';
  };

  // 4. Inisialisasi AbortController & pasang listener SIGINT
  const controller = new AbortController();
  activeAbortController = controller;
  isStreamingActive = true;

  const sigintHandler = () => {
    if (activeAbortController) {
      activeAbortController.abort();
    }
  };

  process.on('SIGINT', sigintHandler);

  // 5. Agentic Loop (Maksimal 10 putaran interaksi model-tool)
  const MAX_AGENT_TURNS = 10;
  let currentTurn = 0;
  let hasFirstTurnSucceeded = false;
  let completedNaturally = false;

  try {
    while (currentTurn < MAX_AGENT_TURNS) {
      currentTurn++;
      let hasFirstTokenArrived = false;
      let isReasoningActive = false;

      // Pastikan riwayat muat dalam context window SEBELUM request dikirim.
      // Pemangkasan lama berbasis jumlah pesan bisa membiarkan permintaan lolos
      // ke provider padahal isinya jauh melampaui jendela konteks.
      const trimResult = conversationSession.trimToTokenBudget(undefined, {
        model: credentials.model,
      });
      if (trimResult.trimmed) {
        const warn = formatContextWarning(
          getContextUsage(conversationSession.getMessages(), { model: credentials.model }),
          { useColor: Boolean(process.stdout.isTTY) }
        );
        if (warn) process.stdout.write(`\n  ${warn}\n`);
      }

      const spinnerText =
        currentTurn === 1 ? 'bAIwor sedang berpikir...' : 'bAIwor sedang menganalisis hasil tool...';
      startThinkingSpinner(spinnerText);

      const result = await streamChatCompletion({
        credentials,
        messages: conversationSession.getMessages(),
        tools: TOOL_DEFINITIONS,
        signal: controller.signal,
        onStart: () => {
          stopThinkingSpinner();
          hasFirstTokenArrived = true;
          // Bersihkan baris spinner dan buat baris baru untuk output jawaban
          clearSpinnerLine('\n');
        },
        onReasoning: (chunk) => {
          if (!isReasoningActive) {
            isReasoningActive = true;
            process.stdout.write(chalk.dim.gray('💭 Thinking: '));
          }
          process.stdout.write(chalk.dim.gray(chunk));
        },
        onDelta: (chunk) => {
          if (isReasoningActive) {
            isReasoningActive = false;
            process.stdout.write('\n\n');
          }
          process.stdout.write(chunk);
        },
      });

      stopThinkingSpinner();
      hasFirstTurnSucceeded = true;

      // Cek apakah model meminta pemanggilan tool (Function Calling)
      if (result.tool_calls && Array.isArray(result.tool_calls) && result.tool_calls.length > 0) {
        // Simpan pesan asisten beserta tool_calls ke histori
        conversationSession.addAssistantMessage(result.content || '', result.tool_calls);

        process.stdout.write('\n');

        // Kumpulkan aktivitas tool satu putaran ini. Di TTY blok digambar
        // ulang secara langsung (langkah muncul satu per satu); di luar TTY
        // ia dikumpulkan dulu lalu dicetak sekali di akhir.
        const turnEvents = [];

        // Eksekusi setiap tool yang diminta oleh model
        for (const tc of result.tool_calls) {
          const fnName = tc.function?.name || 'unknown_tool';
          const rawArgs = tc.function?.arguments || '{}';

          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(rawArgs);
          } catch {
            parsedArgs = { raw: rawArgs };
          }

          const shouldSuspend = toolMayPrompt(fnName, parsedArgs);
          const liveIndex = live.addTool(fnName, parsedArgs);
          if (shouldSuspend) live.suspend();

          // Eksekusi tool handler sambil mengukur durasi
          const startedAt = Date.now();
          const toolResult = await executeTool(fnName, rawArgs, { signal: controller.signal });
          const durationMs = Date.now() - startedAt;

          if (shouldSuspend) live.resume();

          // `todo_list` mengembalikan JSON untuk dibaca model, bukan untuk
          // mata pengguna. Di sini ia diganti checklist sungguhan supaya
          // progres ini benar-benar terlihat oleh manusia.
          const todoItems = fnName === 'todo_list' && toolResult.success ? todoStore.read() : [];
          const todoDetail = renderTodoChecklist(todoItems, {
            useColor: Boolean(process.stdout.isTTY),
          });

          const event = {
            name: fnName,
            args: parsedArgs,
            durationMs,
            output: toolResult.output,
            success: toolResult.success,
            detail: todoDetail || undefined,
            extraMeta: todoDetail ? formatTodoProgress(todoItems) : undefined,
          };
          turnEvents.push(event);
          live.settleTool(liveIndex, event);

          // Simpan hasil eksekusi tool ke memori sesi dengan role: 'tool'
          conversationSession.addToolResult(tc.id, toolResult.output, fnName);
        }

        if (live.enabled) {
          // Blok sudah tampil lengkap di layar; cukup beri jarak satu baris.
          live.commit();
          process.stdout.write('\n');
        } else {
          const block = renderTimeline(turnEvents, { useColor: false });
          if (block) process.stdout.write(`${block}\n\n`);
        }

        // Lanjut ke giliran berikutnya agar LLM memproses hasil tool
        continue;
      }

      // Jika tidak ada tool calls, berarti respons akhir (final answer) sudah selesai
      conversationSession.addAssistantMessage(result.content || '');
      process.stdout.write('\n\n');

      // Tampilkan sisa konteks sebagai penanda giliran berikutnya.
      const usage = getContextUsage(conversationSession.getMessages(), {
        model: credentials.model,
      });
      process.stdout.write(
        `  ${formatContextIndicator(usage, { useColor: Boolean(process.stdout.isTTY) })}\n\n`
      );

      completedNaturally = true;
      break;
    }

    // Jika loop keluar karena mencapai batas putaran tanpa final answer (A1)
    if (!completedNaturally) {
      console.log(chalk.yellow(`\n  ⚠️  Batas ${MAX_AGENT_TURNS} putaran tool tercapai tanpa jawaban akhir.`));
      console.log(chalk.gray('     Model terus meminta pemanggilan tool tanpa menyimpulkan. Coba persempit atau perjelas permintaan Anda.\n'));
      conversationSession.addAssistantMessage(
        '[Sistem] Batas putaran tool tercapai sebelum jawaban akhir diberikan.'
      );
    }
  } catch (err) {
    stopThinkingSpinner();
    // Hentikan animasi; biarkan blok terakhir tetap terlihat sebagai jejak.
    live.commit();

    if (err.name === 'AbortError') {
      clearSpinnerLine();
      process.stdout.write(chalk.yellow('\n  ⏹ [Dibatalkan oleh pengguna]\n\n'));
      // Jika sudah ada respons sebagian sebelum dibatalkan, simpan agar histori tetap utuh
      if (err.partialContent && err.partialContent.trim()) {
        conversationSession.addAssistantMessage(err.partialContent.trim() + ' [Dibatalkan]');
      }
      return;
    }

    // Bersihkan baris spinner sebelum cetak pesan error
    clearSpinnerLine('\n');

    // Tangani HTTP Error secara ramah
    if (err.status === 401 || err.status === 403) {
      console.log(chalk.red.bold(`  ❌ Autentikasi Gagal (${err.status}): Kredensial tidak valid atau token telah kedaluwarsa.`));
      console.log(chalk.gray(`     Provider : ${credentials.provider} (${credentials.type})`));
      console.log(chalk.gray(`     Solusi   : Ketik ${chalk.cyan('/model')} untuk memeriksa API Key atau ${chalk.cyan('/login')} untuk login ulang.\n`));
    } else if (err.status === 429) {
      console.log(chalk.yellow.bold(`  ⏳ Rate Limit (${err.status}): Kuota atau batas kecepatan request provider tercapai.`));
      console.log(chalk.gray('     Silakan tunggu beberapa saat atau ganti model/provider lain via /model.\n'));
    } else if (err.status >= 500) {
      console.log(chalk.red.bold(`  ⚠️  Server Provider Error (${err.status}): Layanan AI sedang mengalami gangguan.`));
      console.log(chalk.gray(`     Detail : ${err.message}`));
      console.log(chalk.gray('     Silakan coba beberapa saat lagi.\n'));
    } else if (isNetworkError(err)) {
      const code = networkErrorCode(err);
      const isTimeout = err.name === 'TimeoutError' || TIMEOUT_ERROR_CODES.has(code);
      const label = isTimeout
        ? 'Koneksi ke provider habis waktu (timeout).'
        : 'Tidak dapat terhubung ke endpoint AI.';
      console.log(chalk.red.bold(`  🌐 Masalah Jaringan: ${label}`));
      console.log(chalk.gray(`     Endpoint : ${err.url || credentials.baseUrl}`));
      console.log(chalk.gray(`     Provider : ${credentials.provider} (${credentials.type})`));
      if (code) console.log(chalk.gray(`     Kode     : ${code}`));
      console.log(chalk.gray('     Periksa koneksi internet atau URL endpoint lewat /model, lalu coba lagi.\n'));
    } else {
      console.log(chalk.red.bold('  ⚠️  Gagal memproses pesan:'));
      console.log(chalk.red(`     ${err.message}`));
      if (err.cause) {
        console.log(chalk.dim(`     Detail   : ${err.cause.message || err.cause}`));
      }
      console.log();
    }

    // Rollback pesan user terakhir hanya jika gagal di awal sebelum ada balasan asisten
    if (!hasFirstTurnSucceeded) {
      conversationSession.removeLastUserMessage();
    }
  } finally {
    stopThinkingSpinner();
    live.stop();
    isStreamingActive = false;
    activeAbortController = null;
    process.removeListener('SIGINT', sigintHandler);
  }
}
