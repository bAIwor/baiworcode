/**
 * Definisi Tools / Functions berstandar OpenAI-compatible untuk bAIwor Code.
 * Didesain untuk model reasoning & coding (Agentik, StepFun, Google Gemini, dll).
 */

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Membaca isi file di dalam workspace pengguna. Kembalikan teks file dengan nomor baris untuk mempermudah analisis.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Jalur path relatif atau absolut menuju file yang ingin dibaca (misal: "src/index.js", "package.json").',
          },
          offset: {
            type: 'integer',
            description: 'Nomor baris awal untuk mulai membaca (1-indexed). Default: 1.',
          },
          limit: {
            type: 'integer',
            description: 'Jumlah maksimum baris yang ingin dibaca. Default: 200 baris.',
          },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Membuat file baru atau menulis ulang isi file secara lengkap. Gunakan untuk membuat file baru atau penggantian menyeluruh.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Jalur path file yang akan ditulis (misal: "src/utils/math.js").',
          },
          content: {
            type: 'string',
            description: 'Seluruh isi kode atau teks yang akan dituliskan ke dalam file.',
          },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Mengganti potongan kode atau teks tertentu dalam file yang sudah ada (search and replace). Sangat efisien untuk refactoring atau bug-fixing tanpa menulis ulang seluruh file.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Jalur path file yang akan diedit.',
          },
          old_content: {
            type: 'string',
            description: 'Potongan teks atau kode asli yang persis ingin diganti (harus unik di dalam file).',
          },
          new_content: {
            type: 'string',
            description: 'Potongan kode atau teks baru penggantinya.',
          },
        },
        required: ['file_path', 'old_content', 'new_content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'Melihat daftar berkas dan folder di dalam direktori kerja. Mengabaikan node_modules dan .git secara otomatis.',
      parameters: {
        type: 'object',
        properties: {
          dir_path: {
            type: 'string',
            description: 'Jalur path direktori yang ingin dilihat (default: "." untuk direktori aktif saat ini).',
          },
          recursive: {
            type: 'boolean',
            description: 'Apakah melihat sub-direktori secara rekursif. Default: false.',
          },
          max_depth: {
            type: 'integer',
            description: 'Kedalaman maksimum penelusuran jika recursive=true. Default: 2.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Mengeksekusi perintah shell / terminal di komputer pengguna (misal: "npm test", "git status", "node script.js").',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Perintah terminal yang akan dijalankan.',
          },
          cwd: {
            type: 'string',
            description: 'Direktori kerja tempat perintah dijalankan (opsional, default ke folder aktif pengguna).',
          },
        },
        required: ['command'],
      },
    },
  },
];
