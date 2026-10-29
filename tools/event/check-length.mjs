#!/usr/bin/env node
/**
 * Memeriksa panjang tweet terhadap batas X (280 karakter).
 *
 * X menghitung URL sebagai 23 karakter berapa pun panjang aslinya (t.co),
 * jadi penghitungan di sini memakai aturan yang sama.
 *
 *   node tools/event/check-length.mjs docs/event/post
 */

import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'docs/event/post';
const LIMIT = 280;

function tweetLength(text) {
  return text.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length;
}

let failed = 0;

for (const file of fs.readdirSync(dir).sort()) {
  if (!file.endsWith('.txt')) continue;
  /* Discord tidak punya limit 280 — file submission dilewati. */
  if (file.startsWith('discord-')) {
    const len = fs.readFileSync(path.join(dir, file), 'utf8').trim().length;
    console.log(`SKIP  ${file}  ${len} karakter (limit Discord 2000)`);
    continue;
  }
  const full = path.join(dir, file);
  const raw = fs.readFileSync(full, 'utf8');

  if (file.startsWith('thread-')) {
    const parts = raw
      .split(/^--- TWEET \d+ ---$/m)
      .map((p) => p.trim())
      .filter(Boolean);
    parts.forEach((part, idx) => {
      const len = tweetLength(part);
      const ok = len <= LIMIT;
      if (!ok) failed += 1;
      console.log(`${ok ? 'OK  ' : 'FAIL'}  ${file} #${idx + 2}  ${len}/${LIMIT}`);
    });
  } else {
    const len = tweetLength(raw.trim());
    const ok = len <= LIMIT;
    if (!ok) failed += 1;
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${file}  ${len}/${LIMIT}`);
  }
}

console.log(failed === 0 ? '\nSemua tweet muat dalam 280 karakter.' : `\n${failed} tweet terlalu panjang.`);
process.exit(failed === 0 ? 0 : 1);
