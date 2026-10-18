import chalk from 'chalk';
import { resolveActiveCredentials } from '../auth/resolve.js';
import { conversationSession } from './conversation.js';
import { streamChatCompletion } from './client.js';
import { TOOL_DEFINITIONS, executeTool } from '../tools/index.js';
import { todoStore, resetTodoStore } from '../tools/todoTool.js';
import {
  summarizeTodos,
  shouldInjectTodoReminder,
  getTodoReminderInterval,
  buildTodoReminder,
  shouldInjectPlanningNudge,
  getPlanNudgeThreshold,
  buildPlanningReminder,
} from './todoReminder.js';
import { renderTimelineByMode, renderTodoChecklist, formatTodoProgress } from './timeline.js';
import { LiveActivity } from './liveActivity.js';
import { AnswerStyler } from './answerStyle.js';
import { createOutputWriter } from './outputWriter.js';
import { classifyCommand } from '../tools/sandbox.js';
import { getContextUsage, formatContextWarning } from './context.js';
import { autoCompactConversation } from './compact.js';
import { parseDeliverAssetsContent, renderDeliverableCard } from './deliverables.js';
import { getTimelineMode } from '../config.js';

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

/**
 * Batas putaran model-tool dalam satu permintaan. Dibuat sangat lega (100)
 * agar bAIwor bebas menuntaskan tugas besar tanpa dipotong paksa di tengah jalan.
 * Pengaman utama adalah deteksi perulangan macet (stuckLoop).
 */
const MAX_AGENT_TURNS = 100;

/**
 * Berapa kali rangkaian tool yang persis sama boleh terulang sebelum dianggap
 * macet. Model yang mengulang panggilan identik terus-menerus tidak akan
 * menyimpulkan sendiri, jadi lebih baik dihentikan dan ditarik kesimpulannya.
 */
const MAX_REPEATED_TOOL_CALLS = 3;

/**
 * Perintah penutup yang dikirim tanpa definisi tool saat batas putaran
 * tercapai — memaksa model menuliskan jawaban akhir, bukan memanggil tool lagi.
 */
const WRAPUP_INSTRUCTION =
  '[Sistem] Batas pemanggilan tool sudah tercapai. JANGAN memanggil tool lagi. ' +
  'Berdasarkan hasil tool yang sudah ada, tuliskan jawaban akhir terbaik untuk ' +
  'pengguna sekarang — ringkas apa yang sudah kamu kerjakan dan langkah lanjutan ' +
  'bila perlu. Jawab dalam bahasa yang sama dengan pesan pengguna.';

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

  // 0. Buang daftar tugas yang sudah tuntas (semua item completed/cancelled)
  // di awal giliran baru agar widget tidak terus menampilkan mis. "0/3".
  todoStore.clearSettled();

  // 1. Ambil kredensial provider aktif
  let credentials;
  try {
    credentials = await resolveActiveCredentials();
  } catch (err) {
    console.log(chalk.yellow(`\n  ⚠️  ${err.message}`));
    console.log(chalk.gray(`     Ketik ${chalk.cyan('/model')} untuk mengatur model atau ${chalk.cyan('/login')} untuk login provider.\n`));
    return;
  }

  // 2. Selaraskan system prompt dengan provider & model aktif
  conversationSession.refreshSystemPrompt(credentials);

  // 3. Tambahkan pesan user ke memori sesi
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
  const timelineMode = getTimelineMode();
  const live = new LiveActivity({
    stream: process.stdout,
    useColor: Boolean(process.stdout.isTTY),
    // Mode tampilan dipakai apa adanya dari konfigurasi (/timeline), supaya
    // pilihan pengguna bertahan antar-sesi dan antar-giliran.
    mode: timelineMode,
  });

  /**
   * Sebagian `run_command` meminta persetujuan pengguna sebelum dieksekusi.
   * Prompt itu mencetak ke stdout, jadi blok aktivitas harus disembunyikan
   * dulu agar hitungan baris tidak melenceng dan tampilan tidak rusak.
   */
  const toolMayPrompt = (fnName, args) => {
    if (fnName === 'ask_user') return true;
    if (fnName !== 'run_command' || !args || !args.command) return false;
    return classifyCommand(String(args.command), { workspace: process.cwd() }).decision === 'confirm';
  };

  // 4. Inisialisasi AbortController & pasang listener SIGINT + ESC
  const controller = new AbortController();
  activeAbortController = controller;
  isStreamingActive = true;

  let lastSigintTime = 0;
  const sigintHandler = () => {
    const now = Date.now();
    if (now - lastSigintTime < 1000) {
      process.stdout.write(chalk.red('\n\n  Keluar paksa (SIGINT ganda).\n\n'));
      process.exit(130);
    }
    lastSigintTime = now;
    if (activeAbortController) {
      activeAbortController.abort();
    }
  };

  process.on('SIGINT', sigintHandler);

  // 5. Agentic Loop (maksimal MAX_AGENT_TURNS putaran interaksi model-tool)
  let currentTurn = 0;
  let hasFirstTurnSucceeded = false;
  let completedNaturally = false;
  let stuckLoop = false;
  const toolSignatureCounts = new Map();

  // Penegakan perencanaan (adaptasi aturan `todowrite` mcode): hitung tool yang
  // sudah dijalankan pada giliran ini, lalu tagih model menyusun `todo_list`
  // bila ia menumpuk banyak tool tanpa rencana apa pun.
  const planningNudgeThreshold = getPlanNudgeThreshold();
  let toolCallsThisTurn = 0;
  let lastPlanNudgeAt = 0;

  /** Sidik jari rangkaian tool satu putaran (nama + argumen), urutan diabaikan. */
  const toolCallSignature = (calls) =>
    calls
      .map((tc) => `${tc.function?.name || '?'}(${tc.function?.arguments || ''})`)
      .sort()
      .join('|');

  /**
   * Menjalankan satu giliran streaming ke provider, lengkap dengan spinner dan
   * penanganan token yang seragam. Dipakai baik untuk giliran normal maupun
   * giliran kesimpulan akhir (yang dikirim tanpa definisi tool).
   */
  const runModelTurn = async ({ messages, tools, spinnerText }) => {
    const isTTY = Boolean(process.stdout.isTTY);
    // Indentasi 2 spasi pada keluaran AI agar selaras dengan elemen UI lain
    // (banner, status line, timeline tool) yang semuanya memakai indentasi 2 spasi.
    // Hanya diterapkan di TTY; di luar TTY (pipe/redirect) tidak ada indentasi agar
    // keluaran berkas tetap bersih.
    const INDENT = isTTY ? '  ' : '';
    const columns = process.stdout.columns || 80;

    /**
     * Penulis keluaran yang membungkus baris panjang secara sadar.
     *
     * Dulu cukup menambahkan indent pada newline eksplisit. Itu bekerja untuk
     * baris pendek, tapi begitu sebuah baris melewati lebar terminal, terminal
     * membungkusnya sendiri ke kolom 0 — tanpa indentasi. Hasilnya baris kedua
     * (dan seterusnya) mepet kiri sementara baris pertama terindentasi rapi.
     *
     * Penulis ini memotong baris di batas kata dan memberi setiap baris
     * lanjutan *hanging indent* sejajar dengan isi baris pertama, sehingga
     * seluruh blok jawaban tetap berkolom.
     *
     * Blok kode sengaja dilewati: isinya harus tetap utuh apa adanya.
     */
    const writer = createOutputWriter({
      out: process.stdout,
      indent: INDENT,
      width: Math.max(20, columns - INDENT.length),
    });

    const writeStyled = (text) => {
      if (!text) return;
      if (styler.inCodeBlock) {
        writer.writeVerbatim(text);
        return;
      }
      writer.write(text);
    };
    let isReasoningActive = false;
    // Menandai apakah giliran ini benar-benar mencetak sesuatu (thinking atau
    // teks jawaban) ke layar. Dipakai pemanggil untuk memutuskan perlu-tidaknya
    // memberi newline pemisah sebelum blok tool berikutnya.
    let printed = false;
    // Pewarna markdown hanya untuk tampilan; riwayat percakapan tetap teks mentah.
    const styler = new AnswerStyler({ useColor: isTTY });
    startThinkingSpinner(spinnerText);
    try {
      const result = await streamChatCompletion({
        credentials,
        messages,
        tools,
        signal: controller.signal,
        onStart: () => {
          stopThinkingSpinner();
          // Bersihkan baris spinner TANPA pindah baris: keluaran berikutnya
          // (thinking/jawaban) langsung ditulis di baris spinner tadi, sehingga
          // tidak menyisakan baris kosong ekstra. Dulu di sini diberi '\n'
          // sehingga menambah satu baris kosong lagi sebelum jawaban.
          //
          // Indentasi awal TIDAK dicetak di sini: writer sudah menambahkan
          // indentasi sendiri pada setiap baris.
          clearSpinnerLine();
          writer.reset();
        },
        onReasoning: (chunk) => {
          if (!isReasoningActive) {
            isReasoningActive = true;
            process.stdout.write(chalk.dim.gray('💭 Thinking:'));
          }
          process.stdout.write(chalk.dim.gray(writer.wrapReasoning(chunk)));
          printed = true;
        },
        onDelta: (chunk) => {
          if (isReasoningActive) {
            isReasoningActive = false;
            // Tuntaskan sisa baris reasoning yang masih tertahan di buffer
            // (dengan warna redup yang sama), lalu beri TEPAT satu baris kosong
            // sebelum jawaban. Dulu di sini ditulis dua newline ('\n\n')
            // padahal baris reasoning terakhir sudah berakhir newline, sehingga
            // muncul dua baris kosong dan jarak thinking→jawaban terlihat
            // terlalu jauh. Satu newline sudah cukup.
            process.stdout.write(chalk.dim.gray(writer.wrapReasoning('\n')));
            process.stdout.write('\n');
          }
          try {
            const styled = styler.push(chunk);
            if (styled) {
              writeStyled(styled);
              printed = true;
            }
          } catch {
            writeStyled(chunk);
            printed = true;
          }
        },
      });
      const flushed = styler.flush();
      if (flushed) {
        writeStyled(flushed);
      }
      writer.flush();
      return { ...(result || {}), printed };
    } finally {
      stopThinkingSpinner();
    }
  };

  /**
   * Giliran penutup: mengirim riwayat tanpa definisi tool agar model menuliskan
   * kesimpulan, bukan memanggil tool lagi. Hasilnya tetap sebuah jawaban akhir,
   * jadi kerja yang sudah dilakukan tidak berakhir tanpa keputusan.
   */
  const requestFinalAnswer = async () => {
    const reason = stuckLoop
      ? 'Model mengulang langkah yang sama tanpa menyimpulkan'
      : `Batas ${MAX_AGENT_TURNS} putaran tool tercapai`;
    process.stdout.write(chalk.yellow(`\n  ⚠️  ${reason}. Meminta kesimpulan akhir…\n`));

    // Dikirim sebagai `user` (bukan `system` di tengah riwayat) agar diterima
    // luas oleh endpoint OpenAI-compatible yang berbeda-beda.
    const messages = [
      ...conversationSession.getMessages(),
      { role: 'user', content: WRAPUP_INSTRUCTION },
    ];

    let finalText = '';
    try {
      const wrap = await runModelTurn({
        messages,
        tools: [],
        spinnerText: 'semAIr sedang menyusun kesimpulan akhir...',
      });
      finalText = (wrap?.content || '').trim();
    } catch (err) {
      if (err.name === 'AbortError') throw err; // biarkan catch luar menangani pembatalan
      // Kegagalan giliran penutup tidak boleh menutupi hasil kerja yang sudah ada.
      clearSpinnerLine('\n');
      console.log(chalk.gray(`     (Gagal meminta kesimpulan: ${err.message})\n`));
    }

    if (finalText) {
      conversationSession.addAssistantMessage(finalText, null, wrap?.reasoning || undefined);
      process.stdout.write('\n\n');
      return;
    }

    console.log(
      chalk.gray('     Model tetap tidak memberi kesimpulan. Coba persempit atau perjelas permintaan Anda.\n')
    );
    conversationSession.addAssistantMessage(
      '[Sistem] Batas putaran tool tercapai sebelum jawaban akhir diberikan.'
    );
  };

  /**
   * Menyusun daftar pesan yang dikirim ke model untuk satu putaran.
   *
   * Riwayat percakapan bisa ditambah pengingat SEMENTARA (tidak ikut disimpan ke
   * riwayat), dikirim sebagai pesan `user` mengikuti pola yang sudah dipakai
   * `requestFinalAnswer` agar diterima luas oleh endpoint OpenAI-compatible:
   *
   *   1. `<planning-reminder>` — model menumpuk tool tanpa pernah menyusun rencana.
   *   2. `<task-completion-reminder>` — masih ada item todo aktif dan intervalnya tiba.
   */
  const buildOutboundMessages = () => {
    const base = conversationSession.getMessages();
    const extra = [];
    const stats = summarizeTodos(todoStore.read());

    if (
      stats.total === 0 &&
      shouldInjectPlanningNudge({
        toolCalls: toolCallsThisTurn,
        lastNudgeAt: lastPlanNudgeAt,
        threshold: planningNudgeThreshold,
      })
    ) {
      extra.push({
        role: 'user',
        content: buildPlanningReminder({ toolCalls: toolCallsThisTurn }),
      });
      lastPlanNudgeAt = toolCallsThisTurn;
    }

    if (stats.active > 0 && shouldInjectTodoReminder(currentTurn, getTodoReminderInterval())) {
      extra.push({ role: 'user', content: buildTodoReminder(stats) });
    }

    return extra.length > 0 ? [...base, ...extra] : base;
  };

  try {
    while (currentTurn < MAX_AGENT_TURNS) {
      currentTurn++;

      // Pemadatan otomatis (auto-compact) jika konteks mencapai ambang batas (>= 80%)
      try {
        const autoCompactRes = await autoCompactConversation(conversationSession, {
          model: credentials.model,
        });
        if (autoCompactRes.triggered) {
          process.stdout.write(
            chalk.cyan(`\n  ⚡ [Auto-Compact] Konteks percakapan mencapai ${autoCompactRes.percentBefore}% (~${autoCompactRes.tokensBefore} token).\n     Rangkuman dibuat otomatis (hemat ${autoCompactRes.savedTokens} token). Snapshot tersimpan.\n\n`)
          );
        }
      } catch {}

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

      const result = await runModelTurn({
        messages: buildOutboundMessages(),
        tools: TOOL_DEFINITIONS,
        spinnerText:
          currentTurn === 1
            ? 'semAIr sedang merancang strategi...'
            : 'bAIwor sedang menimbang & mengolah hasil tool...',
      });
      // Giliran pertama sudah terbukti berjalan → mulai simpan sesi SECARA
      // INKREMENTAL. Sejak titik ini setiap pesan (assistant/tool) ditulis ke
      // disk, sehingga kemajuan giliran panjang terlihat dan tidak hilang bila
      // proses dibatalkan. Sengaja baru di sini: bila request pertama gagal,
      // rollback pesan user tidak meninggalkan jejak setengah jadi.
      // Hanya sekali per giliran — pemanggilan berulang akan mereset status
      // "sudah mulai" dan menulis ulang seluruh berkas tiap putaran.
      if (!hasFirstTurnSucceeded) {
        hasFirstTurnSucceeded = true;
        conversationSession.enableIncrementalSave({
          model: credentials.model,
          provider: credentials.provider,
        });
      }

      // Cek apakah model meminta pemanggilan tool (Function Calling)
      if (result.tool_calls && Array.isArray(result.tool_calls) && result.tool_calls.length > 0) {
        // Simpan pesan asisten beserta tool_calls dan reasoning ke histori
        conversationSession.addAssistantMessage(
          result.content || '',
          result.tool_calls,
          result.reasoning || undefined
        );

        // Jarak antara uraian naratif dan blok tool. Di TTY, bila giliran ini
        // tidak mencetak teks/thinking sama sekali, baris spinner tadi sudah
        // dipakai ulang sebagai baris pertama blok — newline tambahan justru
        // menyisakan baris kosong ganda. Di luar TTY (tanpa spinner) newline
        // tetap diperlukan agar blok tidak menempel pada keluaran sebelumnya.
        if (result.printed || !live.enabled) process.stdout.write('\n');

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
          toolCallsThisTurn += 1;

          if (shouldSuspend) live.resume();

          // `todo_list` mengembalikan JSON untuk dibaca model, bukan untuk
          // mata pengguna. Di sini ia diganti checklist sungguhan supaya
          // progres ini benar-benar terlihat oleh manusia.
          const isTodoTool = fnName === 'todo_list' && toolResult.success;
          const todoItems = isTodoTool ? todoStore.read() : [];
          const todoDetail = isTodoTool
            ? renderTodoChecklist(todoItems, {
                useColor: Boolean(process.stdout.isTTY),
              })
            : undefined;

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
          // Blok sudah tampil lengkap di layar. Jarak satu baris sebelum giliran
          // berikutnya disediakan oleh spinner (newline pembuka di
          // startThinkingSpinner) — jadi JANGAN tambah newline di sini agar
          // tidak muncul baris kosong ganda antara blok tool dan thinking.
          live.commit();
        } else {
          const block = renderTimelineByMode(turnEvents, { mode: timelineMode, useColor: false });
          if (block) process.stdout.write(`${block}\n\n`);
        }

        // Deteksi rangkaian tool yang persis sama berulang-ulang — tanda model
        // macet dan tidak akan menyimpulkan sendiri.
        const signature = toolCallSignature(result.tool_calls);
        const seen = (toolSignatureCounts.get(signature) || 0) + 1;
        toolSignatureCounts.set(signature, seen);
        if (seen >= MAX_REPEATED_TOOL_CALLS) stuckLoop = true;

        if (stuckLoop) break;

        // Lanjut ke giliran berikutnya agar LLM memproses hasil tool
        continue;
      }

      // Jika tidak ada tool calls, berarti respons akhir (final answer) sudah selesai
      conversationSession.addAssistantMessage(
        result.content || '',
        null,
        result.reasoning || undefined
      );

      // Jika model menyertakan penanda <deliver-assets>, render kartu deliverable terminal
      if (result.content && /<deliver-assets>[\s\S]*?<\/deliver-assets>/i.test(result.content)) {
        const match = result.content.match(/<deliver-assets>([\s\S]*?)<\/deliver-assets>/i);
        const items = parseDeliverAssetsContent(match ? match[1] : '');
        if (items.length > 0) {
          const card = renderDeliverableCard(items, { useColor: Boolean(process.stdout.isTTY) });
          process.stdout.write(`\n${card}\n`);
        }
      }

      process.stdout.write('\n\n');

      completedNaturally = true;
      break;
    }

    // Loop berhenti tanpa jawaban akhir — entah karena batas putaran tercapai
    // atau karena rangkaian tool yang sama terulang. Tarik satu giliran
    // kesimpulan tanpa definisi tool supaya pengguna tetap mendapat jawaban.
    if (!completedNaturally) {
      await requestFinalAnswer();
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
        conversationSession.addAssistantMessage(
          err.partialContent.trim() + ' [Dibatalkan]',
          err.partialToolCalls || null,
          err.partialReasoning || undefined
        );
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
