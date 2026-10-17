#!/usr/bin/env bash
# ==============================================================================
# bAIwor Code — One-Line Installer untuk Linux & macOS (Bash)
# Website: https://baiwor.my.id | Repository: https://github.com/bAIwor/baiworcode
# ==============================================================================

set -e

# Warna output terminal
BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

echo ""
echo -e "${GRAY}  ================================================================${NC}"
echo -e "${YELLOW}${BOLD}     bAIwor Code — Asisten Coding AI Punakawan Banyumasan          ${NC}"
echo -e "${BOLD}     'Jiwa Punakawan, Pikiran AI, Guardian Banyumas'              ${NC}"
echo -e "${GRAY}  ================================================================${NC}"
echo ""

# 1. Periksa Node.js
echo -e "${CYAN}  [1/3] Memeriksa lingkungan Node.js...${NC}"

if ! command -v node >/dev/null 2>&1; then
    echo -e "${YELLOW}  ⚠️  Node.js belum terpasang di sistem Anda.${NC}"
    echo -e "${GRAY}      bAIwor Code membutuhkan Node.js versi 18 atau lebih baru.${NC}"
    echo -e "${CYAN}      Silakan pasang Node.js melalui nvm atau https://nodejs.org${NC}"
    exit 1
fi

NODE_VER=$(node -v | tr -d 'v')
MAJOR_VER=$(echo "$NODE_VER" | cut -d'.' -f1)

if [ "$MAJOR_VER" -lt 18 ]; then
    echo -e "${YELLOW}  ⚠️  Versi Node.js Anda (v$NODE_VER) terlalu lawas.${NC}"
    echo -e "${GRAY}      bAIwor Code membutuhkan minimal Node.js versi 18 atau lebih baru.${NC}"
    exit 1
fi

echo -e "${GREEN}  ✓ Node.js terdeteksi: v$NODE_VER${NC}"

# 2. Pasang secara Global
echo -e "${CYAN}  [2/3] Memasang bAIwor Code secara global...${NC}"

if [ -f "./package.json" ] && [ -f "./bin/baiwor.js" ]; then
    echo -e "${GRAY}  Terdeteksi repositori lokal. Menjalankan npm link...${NC}"
    if ! npm link --force >/dev/null 2>&1; then
        echo -e "${YELLOW}  ⚠️  'npm link' gagal. Coba jalankan manual: npm link --force${NC}"
        exit 1
    fi
else
    echo -e "${GRAY}  Memasang paket dari npm/GitHub...${NC}"
    if ! npm install -g baiworcode >/dev/null 2>&1; then
        # Fallback ke GitHub jika belum dirilis di registry npm publik
        echo -e "${YELLOW}  Paket belum tersedia di registry npm publik. Beralih memasang dari GitHub...${NC}"
        if ! npm install -g git+https://github.com/bAIwor/baiworcode.git >/dev/null 2>&1; then
            echo -e "${YELLOW}  ⚠️  Pemasangan gagal.${NC}"
            echo -e "${GRAY}      Pastikan koneksi internet stabil dan 'git' sudah terpasang.${NC}"
            echo -e "${CYAN}      Alternatif: npm install -g https://github.com/bAIwor/baiworcode/tarball/main${NC}"
            exit 1
        fi
    fi
fi

# 3. Verifikasi
echo -e "${CYAN}  [3/3] Memverifikasi pemasangan bAIwor CLI...${NC}"

INSTALLED_VER=$(baiwor --version 2>/dev/null || baiworcode --version 2>/dev/null || true)

echo ""
if [ -n "$INSTALLED_VER" ]; then
    echo -e "${GRAY}  ================================================================${NC}"
    echo -e "${GREEN}${BOLD}    🎉 Sugeng! bAIwor Code v$INSTALLED_VER berhasil terpasang!     ${NC}"
    echo -e "${GRAY}  ================================================================${NC}"
    echo ""
    echo -e "${YELLOW}${BOLD}  Cara Memulai:${NC}"
    echo -e "${GRAY}    Ketik salah satu perintah berikut di terminal Anda:${NC}"
    echo ""
    echo -e "    ${CYAN}baiwor${NC}              ${GRAY}-> Masuk ke mode interaktif Punakawan (REPL)${NC}"
    echo -e "    ${CYAN}baiwor model${NC}        ${GRAY}-> Pilih model (👑 Agentik AI ⭐, Gemini, StepFun, dll)${NC}"
    echo -e "    ${CYAN}baiwor status${NC}       ${GRAY}-> Cek status login, provider aktif, dan latency${NC}"
    echo -e "    ${CYAN}baiwor \"prompt...\"${NC}  ${GRAY}-> Tanya langsung atau suruh coding otomatis${NC}"
    echo ""
    echo -e "${GRAY}  Dokumentasi & Dukungan: https://baiwor.my.id${NC}"
    echo ""
else
    echo -e "${YELLOW}  ⚠️  Pemasangan selesai, namun binary 'baiwor' belum terbaca di PATH.${NC}"
    echo -e "${GRAY}      Pastikan direktori global npm Anda ada di dalam $PATH.${NC}"
    echo ""
fi
