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
      description: 'Mengganti potongan kode atau teks tertentu dalam file yang sudah ada (search and replace). Sangat efisien untuk refactoring atau bug-fixing tanpa menulis ulang seluruh file. Pencocokan toleran terhadap perbedaan indentasi/spasi ujung. Untuk banyak perubahan sekaligus, gunakan parameter "edits".',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Jalur path file yang akan diedit.',
          },
          old_content: {
            type: 'string',
            description: 'Potongan teks atau kode asli yang ingin diganti. Tidak wajib unik bila replace_all=true.',
          },
          new_content: {
            type: 'string',
            description: 'Potongan kode atau teks baru penggantinya.',
          },
          replace_all: {
            type: 'boolean',
            description: 'true: ganti SEMUA kemunculan old_content, bukan hanya yang unik. Default: false.',
          },
          edits: {
            type: 'array',
            description: 'Banyak perubahan sekaligus, diterapkan berurutan secara atomik (semua berhasil atau tidak ada yang ditulis). Bila diisi, old_content/new_content tingkat atas diabaikan.',
            items: {
              type: 'object',
              properties: {
                old_content: { type: 'string', description: 'Teks asli yang diganti.' },
                new_content: { type: 'string', description: 'Teks pengganti.' },
                replace_all: { type: 'boolean', description: 'Ganti semua kemunculan untuk edit ini.' },
              },
              required: ['old_content', 'new_content'],
            },
          },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_file',
      description: 'Menerapkan unified diff (format patch "git diff") ke sebuah file. Blok konteks dicari ulang sehingga patch tetap berlaku walau nomor baris bergeser. Cocok untuk menerapkan beberapa perubahan sekaligus dari sebuah diff.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Jalur file yang akan dipatch.' },
          patch: {
            type: 'string',
            description: 'Isi unified diff. Contoh:\n@@ -1,3 +1,3 @@\n baris konteks\n-baris lama\n+baris baru\n baris konteks lain',
          },
        },
        required: ['file_path', 'patch'],
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
      description: 'Mengeksekusi perintah shell / terminal di komputer pengguna (misal: "npm test", "git status", "node script.js"). Mendukung eksekusi asinkron di latar belakang (run_in_background: true) dan pemantauan status tugas via task_id.',
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
          run_in_background: {
            type: 'boolean',
            description: 'Jalankan perintah di latar belakang secara asinkron tanpa memblokir giliran, mengembalikan task_id. Default: false.',
          },
          task_id: {
            type: 'string',
            description: 'ID task latar belakang yang ingin diperiksa atau dihentikan.',
          },
          action: {
            type: 'string',
            enum: ['run', 'status', 'stop', 'list'],
            description: 'Aksi task: "run" (default), "status" (cek output task), "stop" (batalkan task), atau "list" (daftar semua task).',
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
  {
    type: 'function',
    function: {
      name: 'webfetch',
      description: 'Mengambil isi sebuah URL (http/https) dan mengembalikannya sebagai teks yang sudah dibersihkan. Didukung TinyFish Fetch API (bila dikonfigurasi) untuk rendering JavaScript & bypass anti-bot, dengan fallback ke fetch standar. Gunakan untuk membaca dokumentasi, catatan rilis, pesan galat, atau halaman API.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL lengkap yang ingin diambil (misal: "https://nodejs.org/api/fs.html").',
          },
          max_chars: {
            type: 'integer',
            description: 'Batas maksimum karakter yang dikembalikan. Default: 20000.',
          },
          raw: {
            type: 'boolean',
            description: 'true: kembalikan isi mentah apa adanya (tanpa mengubah HTML jadi teks). Default: false.',
          },
          purpose: {
            type: 'string',
            description: 'Tujuan atau konteks pengambilan halaman untuk optimasi ekstraksi TinyFish. Opsional.',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'websearch',
      description: 'Mencari informasi terbaru di web (didukung TinyFish Search API bila ada key, atau DuckDuckGo bawaan) dan mengembalikan daftar judul, URL, dan ringkasan. Pakai untuk menemukan dokumentasi, solusi galat, atau rilis paket terbaru.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Kata kunci pencarian (misal: "nodejs fetch timeout abortcontroller").',
          },
          max_results: {
            type: 'integer',
            description: 'Jumlah maksimum hasil (1-10). Default: 5.',
          },
          location: {
            type: 'string',
            description: 'Kode negara untuk target geo pencarian (misal: "ID", "US"). Opsional.',
          },
          language: {
            type: 'string',
            description: 'Kode bahasa hasil pencarian (misal: "id", "en"). Opsional.',
          },
          include_domains: {
            type: 'string',
            description: 'Domain yang dibatasi, dipisahkan koma (misal: "github.com,nodejs.org"). Opsional.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'webautomate',
      description: 'Menjalankan otomasi browser (Web Agent TinyFish / Mako) untuk menyelesaikan tugas interaktif pada situs target (misal: ekstraksi data dinamis, mengisi formulir, navigasi multi-langkah).',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL situs target yang akan dijelajahi oleh browser (misal: "https://news.ycombinator.com").',
          },
          goal: {
            type: 'string',
            description: 'Tujuan atau tugas spesifik dalam bahasa alami (misal: "Ambil judul dan link dari 3 artikel teratas").',
          },
          browser_profile: {
            type: 'string',
            enum: ['lite', 'stealth'],
            description: 'Profil browser: "lite" untuk kecepatan, "stealth" bila situs memiliki proteksi bot ketat. Default: "lite".',
          },
        },
        required: ['url', 'goal'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'diagnostics',
      description: 'Menjalankan pemeriksaan mutu proyek (script lint/typecheck/check pada package.json, atau tsc/eslint bila terdeteksi) dan mengembalikan hasilnya. Panggil SEBELUM menyatakan tugas selesai untuk memastikan tidak ada galat tipe atau pelanggaran lint.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Direktori proyek yang diperiksa (default: "." untuk direktori aktif).',
          },
          commands: {
            type: 'array',
            description: 'Override: daftar perintah yang dijalankan berurutan. Bila kosong, perintah dideteksi otomatis.',
            items: { type: 'string' },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delegate_task',
      description: 'Mendelegasikan investigasi atau verifikasi ke subagent Punakawan terisolasi (pAItruk untuk eksplorasi/pencarian read-only, gAIreng untuk audit/uji/lint). Subagent berjalan di loop konteks terpisah dan hanya mengembalikan laporan sintesis sehingga konteks utama tetap bersih.',
      parameters: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            enum: ['pAItruk', 'gAIreng', 'bAIwor'],
            description: 'Peran subagent: "pAItruk" (Scout/Read-only: read_file, search_files, list_directory, webfetch, websearch), "gAIreng" (Auditor: test, lint, diagnostics, read_file), atau "bAIwor" (Worker: sub-tugas kode terarah).',
          },
          task: {
            type: 'string',
            description: 'Instruksi spesifik yang harus dikerjakan oleh subagent.',
          },
          context: {
            type: 'string',
            description: 'Informasi atau konteks tambahan yang relevan untuk membantu subagent.',
          },
          max_turns: {
            type: 'integer',
            description: 'Batas maksimum putaran LLM-tool subagent (default: 8, max: 20).',
          },
        },
        required: ['role', 'task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Mengajukan pertanyaan interaktif dengan pilihan jawaban kepada pengguna ketika membutuhkan konfirmasi arsitektur, pemilihan library, preferensi teknis, atau klarifikasi sebelum melanjutkan pekerjaan.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Teks pertanyaan yang diajukan ke pengguna (misal: "Pilih skema state management yang diinginkan:").',
          },
          options: {
            type: 'array',
            description: 'Daftar pilihan jawaban yang dapat dipilih oleh pengguna.',
            items: { type: 'string' },
          },
          multi_select: {
            type: 'boolean',
            description: 'true: izinkan pengguna memilih lebih dari satu opsi (checkbox). Default: false.',
          },
          default_option: {
            type: 'string',
            description: 'Pilihan default yang direkomendasikan sistem.',
          },
        },
        required: ['question', 'options'],
      },
    },
  },
];
