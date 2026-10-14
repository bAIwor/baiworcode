import chalk from 'chalk';
import { resolveActiveCredentials } from '../auth/resolve.js';
import { conversationSession } from './conversation.js';
import { streamChatCompletion } from './client.js';

export { conversationSession };

let activeAbortController = null;
let isStreamingActive = false;

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
 */
export function resetConversation() {
  conversationSession.reset();
  console.log(chalk.green('\n  ✓ Riwayat percakapan telah direset.\n'));
}

/**
 * Menangani prompt chat dari pengguna dan mengirimkan ke LLM aktif secara streaming.
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
  let hasFirstTokenArrived = false;
  let isReasoningActive = false;

  const startThinkingSpinner = () => {
    process.stdout.write(`\n  ${chalk.cyan(spinnerFrames[0])} ${chalk.dim('bAIwor sedang berpikir...')}`);
    spinnerInterval = setInterval(() => {
      frameIdx = (frameIdx + 1) % spinnerFrames.length;
      process.stdout.write(`\r  ${chalk.cyan(spinnerFrames[frameIdx])} ${chalk.dim('bAIwor sedang berpikir...')}`);
    }, 80);
  };

  const stopThinkingSpinner = () => {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
  };

  startThinkingSpinner();

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

  try {
    const result = await streamChatCompletion({
      credentials,
      messages: conversationSession.getMessages(),
      signal: controller.signal,
      onStart: () => {
        stopThinkingSpinner();
        hasFirstTokenArrived = true;
        // Bersihkan baris spinner dan buat baris baru untuk output jawaban
        process.stdout.write('\r\x1b[K\n');
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

    // Simpan respons lengkap asisten ke histori
    conversationSession.addAssistantMessage(result.content);
    conversationSession.trim(40);

    process.stdout.write('\n\n');
  } catch (err) {
    stopThinkingSpinner();

    if (err.name === 'AbortError') {
      process.stdout.write('\r\x1b[K');
      process.stdout.write(chalk.yellow('\n  ⏹ [Dibatalkan oleh pengguna]\n\n'));
      // Jika sudah ada respons sebagian sebelum dibatalkan, simpan agar histori tetap utuh
      if (err.partialContent && err.partialContent.trim()) {
        conversationSession.addAssistantMessage(err.partialContent.trim() + ' [Dibatalkan]');
      }
      return;
    }

    // Bersihkan baris spinner sebelum cetak pesan error
    process.stdout.write('\r\x1b[K\n');

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
    } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      console.log(chalk.red.bold('  🌐 Masalah Jaringan: Tidak dapat terhubung ke endpoint AI.'));
      console.log(chalk.gray(`     Endpoint : ${err.url || credentials.baseUrl}`));
      console.log(chalk.gray('     Periksa koneksi internet Anda atau periksa URL endpoint di menu /model.\n'));
    } else {
      console.log(chalk.red.bold('  ⚠️  Gagal memproses pesan:'));
      console.log(chalk.red(`     ${err.message}\n`));
    }

    // Rollback pesan user terakhir agar tidak mengotori histori dengan prompt yang gagal
    if (conversationSession.messages.length > 0) {
      const last = conversationSession.messages[conversationSession.messages.length - 1];
      if (last.role === 'user') {
        conversationSession.messages.pop();
      }
    }
  } finally {
    stopThinkingSpinner();
    isStreamingActive = false;
    activeAbortController = null;
    process.removeListener('SIGINT', sigintHandler);
  }
}
