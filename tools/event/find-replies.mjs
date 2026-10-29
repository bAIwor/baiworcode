#!/usr/bin/env node
/**
 * Cari tweet-tweet balasan dari sebuah tweet root dengan menyapu ID Snowflake.
 *
 * X memberi ID tweet dari timestamp, jadi ID tweet yang dibuat tak lama setelah
 * root bisa diprediksi. Sapuan ini hanya untuk memeriksa apakah thread sudah
 * ada — bukan untuk mengunduh apa pun.
 *
 *   node tools/event/find-replies.mjs <rootStatusId> [user] [maxSeconds]
 */

const rootId = process.argv[2];
const user = process.argv[3] || 'web3myid';
const maxSeconds = Number(process.argv[4] || 300);

if (!rootId) {
  console.error('Usage: node find-replies.mjs <rootStatusId> [user] [maxSeconds]');
  process.exit(2);
}

const SNOWFLAKE_PER_SECOND = 4194304;
const base = BigInt(rootId);
const hits = [];

const offsets = [];
for (let s = 2; s <= maxSeconds; s += 2) offsets.push(s);

async function probe(seconds) {
  const id = (base + BigInt(seconds) * BigInt(SNOWFLAKE_PER_SECOND)).toString();
  try {
    const res = await fetch(`https://api.fxtwitter.com/${user}/status/${id}`);
    const json = await res.json();
    if (json.code === 200 && json.tweet) {
      return {
        seconds,
        id,
        text: json.tweet.text,
        replyingTo: json.tweet.replying_to_status,
        likes: json.tweet.likes,
        retweets: json.tweet.retweets,
        media: json.tweet.media
          ? [
              ...(json.tweet.media.photos || []).map((p) => 'photo'),
              ...(json.tweet.media.videos || []).map(() => 'video'),
            ]
          : [],
      };
    }
  } catch {
    /* ID tidak ada */
  }
  return null;
}

const CONCURRENCY = 16;
let index = 0;

async function worker() {
  while (index < offsets.length) {
    const s = offsets[index];
    index += 1;
    const hit = await probe(s);
    if (hit) hits.push(hit);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

hits.sort((a, b) => a.seconds - b.seconds);
if (!hits.length) {
  console.log(`Tidak ada balasan yang terdeteksi dalam ${maxSeconds} detik setelah root.`);
  process.exit(0);
}

for (const h of hits) {
  console.log(`\n=== +${h.seconds}s · id ${h.id} · reply-to ${h.replyingTo || '-'} · ${h.likes} likes`);
  console.log(h.text);
  if (h.media.length) console.log(`media: ${h.media.join(', ')}`);
}
