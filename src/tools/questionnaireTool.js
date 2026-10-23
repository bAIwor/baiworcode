import * as p from '@clack/prompts';

let customQuestionnaireHandler = null;

/**
 * Menyimpan custom handler pertanyaan untuk keperluan pengujian otomatis (mock).
 *
 * @param {Function|null} handler - (args) => Promise<{ success: boolean, output: string, answer?: any }>
 */
export function setQuestionnaireHandler(handler) {
  customQuestionnaireHandler = handler;
}

/**
 * Mengembalikan handler pertanyaan ke perilaku standar.
 */
export function resetQuestionnaireHandler() {
  customQuestionnaireHandler = null;
}

/**
 * Menampilkan widget pertanyaan interaktif pilihan ganda di terminal pengguna.
 *
 * @param {Object} args
 * @param {string} args.question - Pertanyaan yang diajukan ke pengguna
 * @param {Array<string>} args.options - Daftar opsi jawaban
 * @param {boolean} [args.multi_select=false] - Apakah pengguna boleh memilih lebih dari satu opsi
 * @param {string} [args.default_option] - Opsi default terpilih
 * @param {Object} [runtimeOptions] - Opsi runtime sistem
 * @returns {Promise<{ success: boolean, output: string, answer?: any }>}
 */
export async function handleAskUser(args = {}, runtimeOptions = {}) {
  const { question, options, multi_select = false, default_option = null } = args || {};

  if (!question || typeof question !== 'string' || !question.trim()) {
    return {
      success: false,
      output: '[ask_user] Parameter "question" wajib diisi dengan teks pertanyaan yang jelas.',
    };
  }

  if (!Array.isArray(options) || options.length === 0) {
    return {
      success: false,
      output: '[ask_user] Parameter "options" harus berupa array berisi minimal 1 pilihan jawaban.',
    };
  }

  // Gunakan mock handler jika disetel (misal dalam unit test)
  if (customQuestionnaireHandler) {
    return await customQuestionnaireHandler(args, runtimeOptions);
  }

  // Terminal tidak interaktif (non-TTY, pipe, atau CI): tidak ada manusia yang
  // bisa menjawab. Sebelumnya tool memalsukan jawaban (default_option atau
  // options[0]) dan melaporkan success:true, sehingga keputusan arsitek
  // diambil diam-diam atas nama pengguna. Sekarang: TOLAK, kecuali operator
  // opting-in eksplisit lewat env BAIWOR_ASK_USER_AUTO=1.
  if (!process.stdin.isTTY) {
    const autoAllowed = String(process.env.BAIWOR_ASK_USER_AUTO || '').toLowerCase() === '1';
    if (!autoAllowed) {
      return {
        success: false,
        output:
          '[ask_user] Pertanyaan tidak dapat dijawab: sesi berjalan dalam mode non-TTY sehingga tidak ada ' +
          'manusia yang bisa memilih. Set env BAIWOR_ASK_USER_AUTO=1 bila memang ingin jawaban ' +
          'otomatis memakai opsi default.',
        answer: undefined,
      };
    }
    const fallbackAnswer = default_option || options[0];
    return {
      success: true,
      output: `[ask_user - Mode Non-TTY] Otomatis memilih opsi: "${fallbackAnswer}".`,
      answer: fallbackAnswer,
    };
  }

  try {
    console.log();
    const formattedOptions = options.map((opt) => ({
      value: String(opt),
      label: String(opt),
    }));

    let answer;
    if (multi_select) {
      answer = await p.multiselect({
        message: question.trim(),
        options: formattedOptions,
        initialValues: default_option ? [default_option] : undefined,
      });
    } else {
      answer = await p.select({
        message: question.trim(),
        options: formattedOptions,
        initialValue: default_option || options[0],
      });
    }

    if (p.isCancel(answer)) {
      return {
        success: false,
        output: 'Pengguna membatalkan pengisian jawaban (pertanyaan dilewati).',
      };
    }

    const answerStr = Array.isArray(answer) ? answer.join(', ') : String(answer);
    return {
      success: true,
      output: `Jawaban pengguna: "${answerStr}"`,
      answer,
    };
  } catch (err) {
    return {
      success: false,
      output: `[ask_user] Gagal menampilkan kuesioner interaktif: ${err.message}`,
    };
  }
}
