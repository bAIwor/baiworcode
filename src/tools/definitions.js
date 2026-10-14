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
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Mencari teks/fungsi di seluruh berkas proyek (target "content") atau mencari nama berkas dengan pola glob (target "files"). Gunakan tool ini alih-alih membuka berkas satu per satu — jauh lebih cepat dan hemat konteks.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Pola regex untuk pencarian isi berkas (misal: "function handleUserChat"), atau pola glob untuk pencarian nama berkas (misal: "*.test.js").',
          },
          target: {
            type: 'string',
            enum: ['content', 'files'],
            description: '"content" mencari di dalam isi berkas, "files" mencari berdasarkan nama berkas. Default: content.',
          },
          path: {
            type: 'string',
            description: 'Direktori atau berkas awal pencarian (default: "." untuk direktori aktif).',
          },
          file_glob: {
            type: 'string',
            description: 'Filter nama berkas saat target="content" (misal: "*.js"). Opsional.',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'todo_list',
      description: 'Menyusun dan memperbarui daftar tugas untuk pekerjaan multi-langkah (3 langkah atau lebih). Panggil tanpa parameter untuk membaca daftar saat ini. Urutan daftar menunjukkan prioritas, dan hanya SATU item boleh berstatus in_progress. Tandai sebuah tugas selesai hanya setelah pekerjaannya benar-benar terverifikasi, bukan sekadar niat.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'Daftar tugas yang ditulis. Kosongkan parameter ini untuk sekadar membaca daftar.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'ID unik singkat, misal "1", "2".' },
                content: { type: 'string', description: 'Deskripsi tugas.' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
                parent: { type: 'string', description: 'Opsional: id item lain untuk menjadikan ini sub-tugas.' },
              },
              required: ['id', 'content', 'status'],
            },
          },
          merge: {
            type: 'boolean',
            description: 'true: perbarui item yang sudah ada berdasarkan id dan tambahkan yang baru. false (default): ganti seluruh daftar dengan rencana baru.',
          },
        },
      },
    },
  },
];
