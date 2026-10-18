/**
 * Placeholder `reasoning_content` untuk pesan asisten lama yang belum punya.
 *
 * WAJIB non-kosong. Uji langsung ke API Reflection (Beam-1.0-501B-A23B)
 * membuktikan:
 *   - field tidak ada        -> 400 missing_required_parameter
 *   - reasoning_content: ''  -> 400 (dianggap tetap "missing")
 *   - reasoning_content: ' ' -> 200 OK
 *
 * Modul ini sengaja TANPA dependensi apa pun, supaya bisa dipakai bersama oleh
 * `conversation.js` dan `client.js` tanpa memicu circular import
 * (client -> conversation -> systemPrompt -> tools -> subagentTool -> client).
 */
export const REASONING_CONTENT_PLACEHOLDER = ' ';
