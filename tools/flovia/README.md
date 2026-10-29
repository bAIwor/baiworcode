# Tooling Flovia (MCP)

Flovia menyediakan satu MCP server resmi: `https://api.flovia.dev/mcp`.
Alat ini memeriksa koneksi Flovia tanpa pernah mencetak nilai API key.

## Isi

| Berkas | Fungsi |
| --- | --- |
| `key.mjs` | Resolver key Flovia dari beberapa sumber (env, registry, `~/.baiwor/config.json`) + sidik jari SHA-256. |
| `doctor.mjs` | Cek key, autentikasi, daftar tool MCP, dan kuota (`flovia_status`). |
| `mcp-probe.mjs` | Klien MCP minimal untuk `tools/list` dan `tools/call` apa pun. |

## Sumber key (urutan prioritas)

1. `process.env.FLOVIA_KEY`
2. `HKCU\Environment:FLOVIA_KEY` (dipasang lewat `setx` / `SetEnvironmentVariable`)
3. `HKLM\Environment:FLOVIA_KEY`
4. `~/.baiwor/config.json` → `mcpServers.flovia.headers.Authorization`
5. `~/.flovia/*`

Nilai key **tidak pernah** dicetak. Yang ditampilkan hanya sumber, panjang, dan
sidik jari SHA-256 16 hex (cukup untuk membandingkan, tidak bisa dibalik).

## Pemakaian

```bash
# Cek key + auth + kuota + daftar tool
node tools/flovia/doctor.mjs

# Panggil tool tertentu
node tools/flovia/doctor.mjs --call flovia_status
node tools/flovia/doctor.mjs --call flovia_x '{"action":"counts","post_id":"2115933790493348065"}'
```

## Memasang key baru

1. Buka `https://console.flovia.dev/auth/` → **Confirm registration** di halaman yang tampil.
2. Tab **API Key** → **Create API key** (key yang terbit saat periode test tidak aktif).
3. Simpan di environment — jangan tempel ke chat, Issue, atau repo:

```powershell
[Environment]::SetEnvironmentVariable('FLOVIA_KEY', 'flv_...', 'User')
```

4. Verifikasi:

```bash
node tools/flovia/doctor.mjs
```

## Integrasi di bAIwor Code

`src/mcp/client.js` mendaftarkan Flovia **otomatis** sebagai remote MCP saat
`FLOVIA_KEY` (env) atau `floviaApiKey` (`~/.baiwor/config.json`) tersedia —
pola yang sama dengan TinyFish, Tavily, dan Firecrawl. Entri manual di
`mcpServers.flovia` tetap menang bila memang dibuat manual.

Tool Flovia lalu tersedia sebagai `mcp_flovia_<tool>` di dalam CLI, misalnya
`mcp_flovia_flovia_x` (data X), `mcp_flovia_flovia_nansen`, dan
`mcp_flovia_flovia_openai`.

## Batasan Flovia yang perlu diingat

- **Read-only untuk X**: bisa search, ambil satu post, quote post, dan post
  sebuah akun sejak sebuah ID — **tidak bisa menulis/posting**.
- Cakupan data X: **7 hari terakhir**, **satu halaman per panggilan**, dan
  tidak semua reply ikut.
- Kuota gratis: jendela **5 jam** dan **mingguan**; satu panggilan besar bisa
  menghabiskan jendela mingguan.
- Semua tool Flovia memakai satu kuota yang sama dengan Exa, Firecrawl,
  CoinGecko, Nansen, QuickNode, Zerion, dan OpenAI.
