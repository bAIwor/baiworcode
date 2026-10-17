# ==============================================================================
# bAIwor Code - One-Line Installer untuk Windows (PowerShell)
# Website: https://baiwor.my.id | Repository: https://github.com/bAIwor/baiworcode
# ==============================================================================

$ErrorActionPreference = "Stop"

function Write-BaworHeader {
    Write-Host ""
    Write-Host "  ================================================================" -ForegroundColor DarkGray
    Write-Host "     bAIwor Code - Asisten Coding AI Punakawan Banyumasan          " -ForegroundColor Yellow
    Write-Host "     'Jiwa Punakawan, Pikiran AI, Guardian Banyumas'              " -ForegroundColor White
    Write-Host "  ================================================================" -ForegroundColor DarkGray
    Write-Host ""
}

Write-BaworHeader

# 1. Periksa Node.js
Write-Host "  [1/3] Memeriksa lingkungan Node.js..." -ForegroundColor Cyan

$nodeInstalled = $false
try {
    $nodeVersion = (& node -v) 2>$null
    if ($nodeVersion) {
        $nodeInstalled = $true
    }
} catch {
    $nodeInstalled = $false
}

if (-not $nodeInstalled) {
    Write-Host "  [!] Node.js belum terpasang di komputer Anda." -ForegroundColor Yellow
    Write-Host "      bAIwor Code membutuhkan Node.js (versi 18 atau lebih baru)." -ForegroundColor Gray
    Write-Host ""
    
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        $ans = Read-Host "  Apakah Anda ingin menginstall Node.js sekarang via winget? (Y/n)"
        if ($ans -eq "" -or $ans -match "^[Yy]") {
            Write-Host "  Memasang Node.js LTS via winget..." -ForegroundColor Cyan
            & winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
            Write-Host "  [OK] Node.js berhasil dipasang! Silakan buka terminal baru lalu jalankan installer ini kembali." -ForegroundColor Green
            exit 0
        }
    }
    
    Write-Host "  Silakan unduh dan pasang Node.js LTS dari: https://nodejs.org" -ForegroundColor Cyan
    exit 1
}

# Periksa versi minimal Node.js (>= 18)
$cleanVer = $nodeVersion.TrimStart("v")
$majorVer = [int]($cleanVer.Split(".")[0])
if ($majorVer -lt 18) {
    Write-Host "  [!] Versi Node.js Anda ($nodeVersion) terlalu lawas." -ForegroundColor Yellow
    Write-Host "      bAIwor Code membutuhkan minimal Node.js versi 18 atau lebih baru." -ForegroundColor Gray
    Write-Host "      Silakan update Node.js dari: https://nodejs.org" -ForegroundColor Cyan
    exit 1
}

Write-Host "  [OK] Node.js terdeteksi: $nodeVersion" -ForegroundColor Green

# 2. Pasang / Tautkan bAIwor Code secara Global
Write-Host "  [2/3] Memasang bAIwor Code secara global..." -ForegroundColor Cyan

$isLocalRepo = (Test-Path "package.json") -and (Test-Path "bin\baiwor.js")

if ($isLocalRepo) {
    Write-Host "  Terdeteksi repositori lokal. Menjalankan npm link..." -ForegroundColor Gray
    & npm link --force | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [!] 'npm link' gagal. Coba jalankan manual: npm link --force" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "  Memasang paket bAIwor Code..." -ForegroundColor Gray

    # PENTING: di PowerShell, try/catch TIDAK menangkap kegagalan perintah native
    # (non-zero exit code) — hanya menangkap error cmdlet. Karena itu pengecekan
    # dilakukan lewat $LASTEXITCODE, bukan try/catch.
    & npm install -g baiworcode --loglevel=error
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Paket belum tersedia di registry npm publik. Beralih memasang dari GitHub..." -ForegroundColor Yellow
        & npm install -g git+https://github.com/bAIwor/baiworcode.git --loglevel=error
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [!] Pemasangan gagal." -ForegroundColor Red
            Write-Host "      Pastikan koneksi internet stabil dan 'git' sudah terpasang." -ForegroundColor Gray
            Write-Host "      Alternatif: npm install -g https://github.com/bAIwor/baiworcode/tarball/main" -ForegroundColor Cyan
            exit 1
        }
    }
}

# 3. Verifikasi Pemasangan
Write-Host "  [3/3] Memverifikasi pemasangan bAIwor CLI..." -ForegroundColor Cyan

# Memakai Get-Command (bukan try/catch) supaya tidak bergantung pada semantik
# penangkapan error perintah native.
$installedVer = $null
foreach ($cmdName in @('baiwor', 'baiworcode')) {
    if (Get-Command $cmdName -ErrorAction SilentlyContinue) {
        $candidate = (& $cmdName --version) 2>$null
        if ($candidate) {
            $installedVer = $candidate
            break
        }
    }
}

Write-Host ""
if ($installedVer) {
    Write-Host "  ================================================================" -ForegroundColor DarkGray
    Write-Host "    [OK] Sugeng! bAIwor Code v$installedVer berhasil terpasang!   " -ForegroundColor Green
    Write-Host "  ================================================================" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Cara Memulai:" -ForegroundColor Yellow
    Write-Host "    Ketik salah satu perintah berikut di terminal Anda:" -ForegroundColor Gray
    Write-Host ""
    Write-Host "    baiwor              " -NoNewline -ForegroundColor Cyan
    Write-Host "-> Masuk ke mode interaktif Punakawan (REPL)" -ForegroundColor Gray
    Write-Host "    baiwor model        " -NoNewline -ForegroundColor Cyan
    Write-Host "-> Pilih model (Agentik AI, Gemini, StepFun, dll)" -ForegroundColor Gray
    Write-Host "    baiwor status       " -NoNewline -ForegroundColor Cyan
    Write-Host "-> Cek status login, provider aktif, dan latency" -ForegroundColor Gray
    Write-Host "    baiwor [instruksi]  " -NoNewline -ForegroundColor Cyan
    Write-Host "-> Tanya langsung atau suruh coding otomatis" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Dokumentasi & Website: https://baiwor.my.id" -ForegroundColor DarkGray
    Write-Host ""
} else {
    Write-Host "  [!] Pemasangan selesai, namun binary baiwor belum terbaca di PATH saat ini." -ForegroundColor Yellow
    Write-Host "      Coba tutup terminal ini dan buka jendela terminal PowerShell yang baru." -ForegroundColor Gray
    Write-Host "      Lalu ketik: baiwor" -ForegroundColor Cyan
    Write-Host ""
}
