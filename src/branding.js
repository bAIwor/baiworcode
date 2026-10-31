/**
 * Identitas resmi bAIwor Code.
 *
 * Semua nama, versi, tautan, dan User-Agent dikumpulkan di satu tempat supaya
 * branding baiwor.my.id konsisten di seluruh aplikasi. Sebelumnya versi dan
 * User-Agent ditulis ulang di banyak berkas, sehingga satu perubahan versi
 * berisiko meninggalkan sisa yang basi.
 */

export const APP_NAME = 'bAIwor Code';
export const APP_SLUG = 'baiworcode';
export const VERSION = '1.0.0-beta.8';

/** Situs resmi & kanal bonus token/credit. */
export const WEBSITE = 'https://baiwor.my.id';
export const BONUS_WEBSITE = 'https://agentik.my.id';

/** User-Agent untuk panggilan API (OpenAI-compatible). */
export const USER_AGENT = `${APP_NAME.replace(/\s+/g, '-')}/${VERSION}`;
export const CLI_USER_AGENT = `bAIwor-cli/${VERSION}`;

/** Tagline resmi (filosofi Punakawan Banyumasan). */
export const TAGLINE = 'Saka Bawor dadi bAIwor — Jiwa Punakawan, Pikiran AI, Guardian Banyumas';

/** Nama badan hukum di balik bAIwor Code (tampil di banner & pesan keluar). */
export const COMPANY = 'PT. bAIwor Agentic Indonesia';
