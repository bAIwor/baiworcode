import path from 'node:path';
import chalk from 'chalk';
import { theme, palette } from '../theme.js';
import { resolveActiveCredentials } from '../auth/resolve.js';
import { conversationSession } from './conversation.js';
import { streamChatCompletion } from './client.js';
import { getDefinitions, executeTool } from '../tools/index.js';
import { processMultimodalPrompt } from './multimodal.js';
import { todoStore, resetTodoStore } from '../tools/todoTool.js';
import {
  summarizeTodos,
  shouldInjectTodoReminder,
  getTodoReminderInterval,
  buildTodoReminder,
  shouldInjectPlanningNudge,
  getPlanNudgeThreshold,
  buildPlanningReminder,
  buildTodoTurnEndReminder,
} from './todoReminder.js';
import { renderTimelineByMode, renderTodoChecklist, formatTodoProgress } from './timeline.js';
import { LiveActivity } from './liveActivity.js';
import { AnswerStyler } from './answerStyle.js';
import { sanitizeTerminalText } from './wrapText.js';
import { createOutputWriter } from './outputWriter.js';
import { classifyCommand } from '../tools/sandbox.js';
import { resolveSafePath } from '../tools/handlers.js';
import { setSubagentProgressHandler, MAX_PARALLEL_TASKS } from '../tools/subagentTool.js';
import { getContextUsage, formatContextWarning } from './context.js';
import { autoCompactConversation } from './compact.js';
import { parseDeliverAssetsContent, renderDeliverableCard } from './deliverables.js';
import { getTimelineMode, getPermissionMode } from '../config.js';
import {
  PLAN_SYSTEM_INSTRUCTION,
  filterToolsForAgentMode,
  isToolBlockedInPlanMode,
  planModeBlockMessage,
} from './planMode.js';
import { beginTurnSnapshot, commitTurnSnapshot } from '../tools/snapshot.js';
import {
  runSelfHealingDiagnostics,
  buildAutoRepairPrompt,
  buildDiagnosticWarningMessage,
} from './selfHealing.js';
import {
  selectPresenter,
  formatPresenterBadge,
  formatHandoffLine,
  getLastPresenter,
  getWorkPhaseLabel,
} from './presenter.js';
import { setActivePresenter } from '../statusLine.js';
import { TOOL_ACTORS } from '../agents/punakawan.js';

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
 * @returns {Promise<{ok:boolean, aborted:boolean}>}
 */
export async function handleUserChat(promptText) {
  const query = (promptText || '').trim();
  if (!query) return { ok: true, aborted: false };

  // Mulai snapshotting berkas untuk putaran ini (/undo support)
  beginTurnSnapshot();

  // 0. Buang daftar tugas yang sudah tuntas (semua item completed/cancelled)
  // di awal giliran baru agar widget tidak terus menampilkan mis. "0/3".
  todoStore.clearSettled();

  // 1. Ambil kredensial provider aktif
  let credentials;
  try {
    credentials = await resolveActiveCredentials();
  } catch (err) {
    console.log(chalk.yellow(`\n  ⚠️  ${err.message}`));
    console.log(chalk.gray(`     Ketik ${chalk.cyan('/model')} untuk mengatur model atau provider.\n`));
    return { ok: false, aborted: false };
  }

  // 2. Selaraskan system prompt dengan provider & model aktif
  conversationSession.refreshSystemPrompt(credentials);

  // 3. Proses lampiran gambar (multi-modal) jika ada (@gambar atau /image)
  const { content, images, errors } = processMultimodalPrompt(query);
  if (errors.length > 0) {
    for (const errMsg of errors) {
      console.log(chalk.yellow(`  ⚠️  [Gambar] ${errMsg}`));
    }
  }
  if (images.length > 0) {
    const names = images.map((img) => path.basename(img.path)).join(', ');
    console.log(chalk.cyan(`  📸 Melampirkan ${images.length} gambar ke prompt: ${chalk.bold(names)}`));
  }
  conversationSession.addUserMessage(content);

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

  const startThinkingSpinner = (msg = 'Punakawan sedang berpikir...') => {
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
   * Sebagian tool meminta persetujuan pengguna sebelum dieksekusi.
   * Prompt itu mencetak ke stdout, jadi blok aktivitas harus disembunyikan
   * dulu agar hitungan baris tidak melenceng dan tampilan tidak rusak.
   * Gerbang approval sebenarnya hidup di tools/handlers.js — fungsi ini hanya
   * memperkirakan apakah prompt itu akan muncul, mengikuti permissionMode:
   *   safe → file & perintah bertanya; auto → hanya perintah; plan → hanya
   *   perintah confirm; yolo → tidak pernah (deny ditolak diam-diam).
   */
  const toolMayPrompt = (fnName, args) => {
    if (fnName === 'ask_user') return true;
    const mode = getPermissionMode();
    if (mode === 'yolo') return false;
    if (fnName === 'run_command' && args?.command) {
      let ws = process.cwd();
      if (args.cwd) {
        try {
          ws = resolveSafePath(args.cwd);
        } catch {
          ws = process.cwd();
        }
      }
      return classifyCommand(String(args.command), { workspace: ws }).decision === 'confirm';
    }
    // File tools hanya bertanya di mode safe (auto/yolo langsung jalan,
    // plan diblokir keras oleh penjaga mode — tidak ada prompt).
    const isFileTool = ['write_file', 'edit_file', 'patch_file'].includes(fnName);
    return isFileTool && mode === 'safe';
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

  // Rotasi Punakawan: seluruh tool yang dipanggil pada giliran pengguna ini
  // menentukan anggota mana yang menyampaikan jawaban akhir.
  const turnToolNames = [];
  let turnPresenter = null;
  let presenterBadgePrinted = false;

  // Mode izin dibaca saat giliran dimulai. Peralihan yang terjadi di tengah
  // giliran (lewat prompt) tidak mengubah aturan main yang sedang berjalan.
  const permissionMode = getPermissionMode();
  const agentMode = permissionMode === 'plan' ? 'plan' : 'build';

  // Penegakan perencanaan (adaptasi aturan `todowrite` mcode): hitung tool yang
  // sudah dijalankan pada giliran ini, lalu tagih model menyusun `todo_list`
  // bila ia menumpuk banyak tool tanpa rencana apa pun.
  const planningNudgeThreshold = getPlanNudgeThreshold();
  let toolCallsThisTurn = 0;
  let lastPlanNudgeAt = 0;
  // Sekali per giliran pengguna: cegah model menutup giliran dengan todo aktif.
  let todoTurnEndNudgeUsed = false;

  // Self-Healing Diagnostics: lacak berkas yang dimodifikasi dan jumlah retry.
  // Otomatis mati secara bawaan — diagnostik hanya berjalan bila model memanggil
  // tool `diagnostics` atau pengguna memintanya. Set BAIWOR_SELF_HEALING=1
  // untuk mengaktifkan pemeriksaan cepat (lint/typecheck) setelah berkas diubah.
  const SELF_HEALING_ENABLED = /^(1|true|on|yes)$/i.test(process.env.BAIWOR_SELF_HEALING || '');
  const FILE_MODIFYING_TOOLS = ['write_file', 'edit_file', 'patch_file'];
  const MAX_DIAGNOSTICS_RETRIES = 2;
  let diagnosticsRetryCount = 0;
  let modifiedFilesThisTurn = [];

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
    let inDeliverTag = false;
    let deliverTagBuffer = '';
    let hasPrintedAssistantHeader = false;

    const ensureAssistantHeader = () => {
      if (!hasPrintedAssistantHeader) {
        hasPrintedAssistantHeader = true;
        // Header ini menandai aplikasi (bAIwor Code), bukan karakter yang
        // menyampaikan jawaban; penyampai ditentukan oleh badge Punakawan.
        const header = isTTY
          ? chalk.hex(palette.gold).bold('✦ bAIwor Code') + '\n\n'
          : '✦ bAIwor Code\n\n';
        process.stdout.write(header);
      }
    };

    startThinkingSpinner(spinnerText);
    try {
      const result = await streamChatCompletion({
        credentials,
        messages,
        tools,
        signal: controller.signal,
        onStart: () => {
          stopThinkingSpinner();
          clearSpinnerLine();
          writer.reset();
        },
        onReasoning: (chunk) => {
          if (!isReasoningActive) {
            isReasoningActive = true;
            process.stdout.write(theme.thinking('💭 Thinking: '));
          }
          process.stdout.write(chalk.dim.gray(writer.wrapReasoning(sanitizeTerminalText(chunk))));
          printed = true;
        },
        onDelta: (chunk) => {
          if (isReasoningActive) {
            isReasoningActive = false;
            process.stdout.write(chalk.dim.gray(writer.wrapReasoning('\n')));
            process.stdout.write('\n');
          }

          // Model/provider adalah sumber tidak tepercaya: jangan pernah
          // menulis escape ANSI/OSC mentah ke terminal.
          let text = sanitizeTerminalText(chunk);
          if (!inDeliverTag) {
            const startIdx = text.toLowerCase().indexOf('<deliver-assets');
            if (startIdx !== -1) {
              const before = text.slice(0, startIdx);
              deliverTagBuffer = text.slice(startIdx);
              inDeliverTag = true;
              text = before;
            }
          } else {
            deliverTagBuffer += text;
            text = '';
            const endIdx = deliverTagBuffer.toLowerCase().indexOf('</deliver-assets>');
            if (endIdx !== -1) {
              inDeliverTag = false;
              text = deliverTagBuffer.slice(endIdx + '</deliver-assets>'.length);
              deliverTagBuffer = '';
            }
          }

          if (!text) return;

          ensureAssistantHeader();

          try {
            const styled = styler.push(text);
            if (styled) {
              writeStyled(styled);
              printed = true;
            }
          } catch {
            writeStyled(text);
            printed = true;
          }
        },
      });
      if (inDeliverTag && deliverTagBuffer) {
        try {
          const styled = styler.push(deliverTagBuffer);
          if (styled) writeStyled(styled);
        } catch {
          writeStyled(deliverTagBuffer);
        }
      }
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
   * Menetapkan penyampai jawaban giliran ini (rotasi Punakawan) dan mencetak
   * badge penutup sekali saja. Dipanggil saat jawaban akhir selesai — baik
   * jawaban natural maupun kesimpulan paksa dari requestFinalAnswer.
   * Bila penyampai berganti dari giliran sebelumnya, baris serah terima 🔄
   * dicetak lebih dulu agar pergantian anggota terlihat sebagai koordinasi tim.
   */
  const noteTurnPresenter = () => {
    if (!turnPresenter) {
      const previous = getLastPresenter();
      turnPresenter = selectPresenter({ toolNames: turnToolNames });
      setActivePresenter(turnPresenter);
      if (
        previous &&
        turnPresenter &&
        previous !== turnPresenter &&
        process.stdout.isTTY
      ) {
        const handoff = formatHandoffLine(previous, turnPresenter);
        if (handoff) process.stdout.write(handoff + '\n');
      }
    }
    if (!presenterBadgePrinted && turnPresenter && process.stdout.isTTY) {
      presenterBadgePrinted = true;
      process.stdout.write(formatPresenterBadge(turnPresenter) + '\n');
    }
    return turnPresenter;
  };

  /**
   * Giliran penutup: mengirim riwayat tanpa definisi tool agar model menuliskan
   * kesimpulan, bukan memanggil tool lagi. Hasilnya tetap sebuah jawaban akhir,
   * jadi kerja yang sudah dilakukan tidak berakhir tanpa keputusan.
   */
  const requestFinalAnswer = async (customReason) => {
    const reason =
      customReason ||
      (stuckLoop
        ? 'Model mengulang langkah yang sama tanpa menyimpulkan'
        : `Batas ${MAX_AGENT_TURNS} putaran tool tercapai`);
    process.stdout.write(chalk.yellow(`\n  ⚠️  ${reason}. Meminta kesimpulan akhir…\n`));

    // Dikirim sebagai `user` (bukan `system` di tengah riwayat) agar diterima
    // luas oleh endpoint OpenAI-compatible yang berbeda-beda.
    const messages = [
      ...conversationSession.getMessages(),
      { role: 'user', content: WRAPUP_INSTRUCTION },
    ];

    let finalText = '';
    let wrap = null;
    try {
      wrap = await runModelTurn({
        messages,
        tools: [],
        spinnerText: '👑 semAIr menyusun kesimpulan akhir...',
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
      noteTurnPresenter();
      return;
    }

    console.log(
      chalk.gray('     Model tetap tidak memberi kesimpulan. Coba persempit atau perjelas permintaan Anda.\n')
    );
    conversationSession.addAssistantMessage(
      '[Sistem] Model menyelesaikan giliran tanpa memberikan laporan akhir.'
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

    const outbound = extra.length > 0 ? [...base, ...extra] : base;

    // Mode Plan: instruksi arsitek ditempel ke system prompt HANYA untuk
    // permintaan ini — riwayat yang tersimpan tetap bersih sehingga instruksi
    // tidak menumpuk saat pengguna kembali ke mode Build.
    if (agentMode !== 'plan') return outbound;
    return outbound.map((m, i) =>
      i === 0 && m.role === 'system' ? { ...m, content: `${m.content}\n\n${PLAN_SYSTEM_INSTRUCTION}` } : m
    );
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
            chalk.cyan(`\n  ⚡ [Auto-Compact] Konteks percakapan mencapai ${autoCompactRes.percentBefore}% (~${autoCompactRes.tokensBefore} token).\n     Rangkuman dibuat otomatis oleh 👑 semAIr (hemat ${autoCompactRes.savedTokens} token). Snapshot tersimpan.\n\n`)
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
        // Daftar tool diambil dari registry (bukan konstanta statis) supaya
        // tool MCP yang terhubung saat runtime ikut dikirim sebagai
        // function-calling ke provider. Sebelumnya tool MCP hanya disebut
        // di system prompt sehingga model tidak pernah bisa memanggilnya.
        tools: filterToolsForAgentMode(getDefinitions(), agentMode),
        // Fase spinner mengikuti progres kerja giliran (rancang → telusur →
        // bangun → uji) berdasarkan tool terakhir yang dipakai, sehingga
        // keempat Punakawan terlihat bergantian sepanjang tugas besar.
        spinnerText: getWorkPhaseLabel(turnToolNames),
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
        // Normalisasi ID tool call SEBELUM pesan assistant disimpan.
        // Beberapa provider tidak mengirim `id`; ID kosong membuat hasil tool
        // tidak bisa dipasangkan dan permintaan berikutnya ditolak 400.
        result.tool_calls.forEach((tc, idx) => {
          if (!tc.id) tc.id = `call_${idx}`;
        });

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
          // Catat niat pemanggilan (termasuk yang gagal/diblokir) — jenis
          // pekerjaan giliran ini menentukan penyampai jawabannya.
          turnToolNames.push(fnName);

          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(rawArgs);
          } catch {
            parsedArgs = { raw: rawArgs };
          }

          const shouldSuspend = toolMayPrompt(fnName, parsedArgs);
          // Atribusi aktor mengikuti peta tool → Punakawan; tool eksternal
          // (mis. MCP) dieksekusi oleh agen utama bAIwor.
          const toolActor = TOOL_ACTORS[fnName] || 'bAIwor';
          const liveIndex = live.addTool(fnName, parsedArgs, { actor: toolActor });
          if (shouldSuspend) live.suspend();

          // Penjaga mode Plan: tool tulis sudah tidak dikirim ke model di mode
          // ini, tapi model masih bisa memanggilnya dari riwayat percakapan
          // lama. Eksekusinya ditolak tegas — bukan sekadar diimbau di prompt.
          const blockedInPlan = agentMode === 'plan' && isToolBlockedInPlanMode(fnName);

          // delegate_task paralel: tampilkan pohon aktivitas Punakawan Squad
          // hidup di bawah node tool selama subagent berjalan.
          const isParallelDelegate =
            !blockedInPlan &&
            fnName === 'delegate_task' &&
            Array.isArray(parsedArgs.tasks) &&
            parsedArgs.tasks.length > 0;
          let restoreProgressHandler = null;
          if (isParallelDelegate) {
            const squadTasks = parsedArgs.tasks.slice(0, MAX_PARALLEL_TASKS).map((task) => ({
              role: String(task?.role || 'subagent'),
              task: String(task?.task || '').trim(),
              turn: 0,
              status: 'queued',
            }));
            live.setSquad(liveIndex, squadTasks);
            restoreProgressHandler = setSubagentProgressHandler((progress) => {
              const entry = squadTasks.find(
                (task) => task.role === progress.role && task.task === progress.task
              );
              if (!entry) return;
              entry.status = progress.status;
              if (Number.isFinite(progress.turn) && progress.turn >= 0) entry.turn = progress.turn;
              live.setSquad(liveIndex, squadTasks);
            });
          }

          // Eksekusi tool handler sambil mengukur durasi
          const startedAt = Date.now();
          let toolResult;
          try {
            toolResult = blockedInPlan
              ? { success: false, output: planModeBlockMessage(fnName) }
              : await executeTool(fnName, rawArgs, { signal: controller.signal });
          } finally {
            if (restoreProgressHandler !== null) {
              setSubagentProgressHandler(restoreProgressHandler);
            }
            if (isParallelDelegate) live.setSquad(liveIndex, null);
          }
          const durationMs = Date.now() - startedAt;
          toolCallsThisTurn += 1;

          // Self-Healing: lacak berkas yang berhasil dimodifikasi oleh tool modifikasi
          if (
            SELF_HEALING_ENABLED &&
            toolResult.success &&
            FILE_MODIFYING_TOOLS.includes(fnName) &&
            parsedArgs.file_path
          ) {
            modifiedFilesThisTurn.push(parsedArgs.file_path);
          }

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

          // Tool modifikasi berkas menyertakan visual diff berwarna
          const isDiffTool = Boolean(toolResult.diff && toolResult.success);
          const diffDetail = isDiffTool ? toolResult.diff : undefined;

          const event = {
            name: fnName,
            actor: toolActor,
            args: parsedArgs,
            durationMs,
            output: toolResult.output,
            success: toolResult.success,
            detail: todoDetail || diffDetail || undefined,
            extraMeta: todoDetail
              ? formatTodoProgress(todoItems)
              : (toolResult.diffStats || undefined),
          };
          turnEvents.push(event);
          live.settleTool(liveIndex, event);

          // Simpan hasil eksekusi tool ke memori sesi dengan role: 'tool'.
          // ID sudah dinormalisasi di atas (disintesis bila provider tidak
          // mengirimnya), jadi hasil tool tidak pernah terbuang.
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

        // Self-Healing Diagnostics: jika ada berkas yang dimodifikasi, jalankan
        // pemeriksaan otomatis sebelum lanjut ke giliran berikutnya
        if (SELF_HEALING_ENABLED && modifiedFilesThisTurn.length > 0) {
          const diagResult = await runSelfHealingDiagnostics(modifiedFilesThisTurn, {
            signal: controller.signal,
          });

          if (!diagResult.passed) {
            if (diagnosticsRetryCount < MAX_DIAGNOSTICS_RETRIES) {
              // Inject pesan auto-repair ke model
              const repairPrompt = buildAutoRepairPrompt(
                diagnosticsRetryCount,
                diagResult.output,
                diagResult.errors
              );
              conversationSession.addUserMessage(repairPrompt);
              diagnosticsRetryCount++;

              // Reset modified files untuk retry berikutnya
              modifiedFilesThisTurn = [];

              process.stdout.write(
                chalk.cyan(
                  `\n  🔧 [Self-Healing] Diagnostik gagal (retry ${diagnosticsRetryCount}/${MAX_DIAGNOSTICS_RETRIES}). Meminta model memperbaiki error...\n`
                )
              );

              // Lanjut ke giliran berikutnya agar model bisa auto-repair
              continue;
            } else {
              // Retry habis: inject peringatan ke final answer nanti
              const warningMsg = buildDiagnosticWarningMessage(
                diagResult.output,
                diagResult.errors
              );
              process.stdout.write(chalk.yellow(`\n  ${warningMsg}\n`));

              // Reset agar tidak trigger lagi di giliran berikutnya
              modifiedFilesThisTurn = [];
              diagnosticsRetryCount = 0;
            }
          } else {
            // Diagnostik lulus: reset counter untuk turn berikutnya
            diagnosticsRetryCount = 0;
            modifiedFilesThisTurn = [];
          }
        }

        // Lanjut ke giliran berikutnya agar LLM memproses hasil tool
        continue;
      }

      // Jika tidak ada tool calls, berarti respons akhir (final answer) sudah selesai.
      // Namun bila todo masih aktif, beri SATU teguran per giliran: model harus
      // melanjutkan pekerjaan atau menurunkan `in_progress` menjadi `pending`
      // bila menunggu keputusan pengguna — agar daftar tidak menggantung.
      const sisaTodo = summarizeTodos(todoStore.read());
      if (sisaTodo.active > 0 && !todoTurnEndNudgeUsed) {
        todoTurnEndNudgeUsed = true;
        conversationSession.addAssistantMessage(
          result.content || '',
          null,
          result.reasoning || undefined
        );
        conversationSession.addUserMessage(buildTodoTurnEndReminder(sisaTodo));
        continue;
      }

      const finalContent = (result.content || '').trim();
      if (!finalContent) {
        // Giliran berakhir tanpa teks apa pun. Jangan tutup diam-diam: minta
        // laporan kesimpulan sekali agar pengguna tidak ditinggalkan tanpa kabar.
        await requestFinalAnswer('Model mengakhiri giliran tanpa laporan');
        completedNaturally = true;
        break;
      }

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

      noteTurnPresenter();

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
      // Simpan respons sebagian TANPA tool_calls: tool call yang tidak punya
      // pasangan `role:tool` akan membuat provider menolak request berikutnya.
      if (err.partialContent && err.partialContent.trim()) {
        conversationSession.addAssistantMessage(
          err.partialContent.trim() + ' [Dibatalkan]',
          null,
          err.partialReasoning || undefined
        );
      }
      return { ok: false, aborted: true };
    }

    // Bersihkan baris spinner sebelum cetak pesan error
    clearSpinnerLine('\n');

    // Tangani HTTP Error secara ramah
    if (err.status === 401 || err.status === 403) {
      console.log(chalk.red.bold(`  ❌ Autentikasi Gagal (${err.status}): Kredensial tidak valid atau kedaluwarsa.`));
      console.log(chalk.gray(`     Provider : ${credentials.provider} (${credentials.type})`));
      console.log(chalk.gray(`     Solusi   : Ketik ${chalk.cyan('/model')} untuk memeriksa API Key.\n`));
    } else if (err.status === 429) {
      console.log(theme.warning.bold('  ⏳ Hmmm kena limit! Ok deh ganti /model\n'));
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

    // Respons parsial (mis. stream macet) sudah tampil di layar; simpan tanpa
    // tool_calls agar pengguna tidak kehilangan jawaban yang sudah dilihat.
    if (err.partialContent && String(err.partialContent).trim()) {
      conversationSession.addAssistantMessage(
        String(err.partialContent).trim() + ' [Terputus]',
        null,
        err.partialReasoning || undefined
      );
    }

    // Rollback pesan user terakhir hanya jika gagal di awal sebelum ada balasan asisten
    if (!hasFirstTurnSucceeded) {
      conversationSession.removeLastUserMessage();
    }
    return { ok: false, aborted: false };
  } finally {
    commitTurnSnapshot();
    stopThinkingSpinner();
    live.stop();
    isStreamingActive = false;
    activeAbortController = null;
    process.removeListener('SIGINT', sigintHandler);
  }

  return { ok: true, aborted: false, presenter: turnPresenter };
}
