/**
 * Penentuan mode peluncuran perintah `baiworcode mcp`.
 *
 * Perintah ini punya dua wajah:
 *  1. Server MCP stdio — dipakai klien MCP eksternal (stdio transport).
 *  2. Pengelolaan server MCP — daftar/tool/tambah/hapus/kunci/refresh.
 *
 * Klien stdio selalu menutup stdin DAN stdout dengan pipe. Karena itu
 * kombinasi "stdin bukan TTY + stdout bukan TTY" dipakai sebagai penanda
 * klien. Tanpa penanda ini, `baiworcode mcp` yang dijalankan dari script atau
 * CI (stdin di-pipe, stdout masih terminal) menggantung menunggu EOF
 * seolah-olah menjadi server stdio.
 */

/**
 * @typedef {'serve' | 'manage'} McpLaunchMode
 */

/**
 * @param {Object} options
 * @param {boolean} [options.wantsServe=false] opsi --serve atau subperintah serve/server
 * @param {string|null|undefined} [options.action] subperintah yang diketik pengguna
 * @param {boolean} [options.stdinIsTty=true]
 * @param {boolean} [options.stdoutIsTty=true]
 * @param {boolean} [options.wasSlashMcp=false] perintah dipanggil sebagai `/mcp`
 * @returns {McpLaunchMode}
 */
export function resolveMcpLaunchMode({
  wantsServe = false,
  action = null,
  stdinIsTty = true,
  stdoutIsTty = true,
  wasSlashMcp = false,
} = {}) {
  const hasSubcommand = Boolean(action && String(action).trim());
  const explicitServe =
    Boolean(wantsServe) || action === 'serve' || action === 'server';
  const looksLikeMcpClient = !stdinIsTty && !stdoutIsTty;

  // Permintaan eksplisit selalu menang: `--serve`, `mcp serve`, `mcp server`.
  if (explicitServe) return 'serve';

  // `/mcp` yang diketik di shell CLI selalu bermaksud mengelola, bukan
  // menjadi server stdio.
  if (wasSlashMcp) return 'manage';

  // Klien MCP eksternal memanggil tanpa subperintah.
  if (!hasSubcommand && looksLikeMcpClient) return 'serve';

  return 'manage';
}
