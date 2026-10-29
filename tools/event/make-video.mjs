#!/usr/bin/env node
/**
 * Merakit rangkaian frame PNG menjadi video MP4 (H.264) memakai ffmpeg.
 *
 *   node make-video.mjs --frames tools/event/out/demo --out docs/media/demo.mp4 \
 *        [--fps 5] [--width 1920] [--height 1080]
 *
 * Butuh `ffmpeg-static` (dipasang terpisah, di luar repo):
 *   npm install ffmpeg-static --prefix "$HOME/.baiwor/pty-tools"
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
}

const framesDir = path.resolve(flags.frames || 'tools/event/out/demo');
const outFile = path.resolve(flags.out || 'docs/media/demo.mp4');
const fps = Number(flags.fps || 5);
const width = Number(flags.width || 1920);
const height = Number(flags.height || 1080);

const require = createRequire('C:/Users/Wijang/.baiwor/pty-tools/');
let ffmpegPath;
try {
  ffmpegPath = require('ffmpeg-static');
} catch {
  console.error('ffmpeg-static belum terpasang. Jalankan:');
  console.error('  npm install ffmpeg-static --prefix "$HOME/.baiwor/pty-tools"');
  process.exit(3);
}
if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
  console.error('Binary ffmpeg tidak ditemukan di', ffmpegPath);
  process.exit(3);
}

const frames = fs
  .readdirSync(framesDir)
  .filter((f) => f.endsWith('.png'))
  .sort();
if (!frames.length) {
  console.error('Tidak ada frame PNG di', framesDir);
  process.exit(2);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });

/* Skala ke lebar target, lalu pad ke rasio 16:9 dengan warna latar yang sama
   dengan background terminal — supaya tidak ada pita hitam yang menyala. */
const vf = [
  `scale=${width}:-2`,
  `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0d1117`,
  'fps=30',
  'format=yuv420p',
].join(',');

const args = [
  '-y',
  '-framerate', String(fps),
  '-i', path.join(framesDir, 'frame-%04d.png'),
  '-vf', vf,
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', '20',
  '-movflags', '+faststart',
  outFile,
];

console.log(`[make-video] ${frames.length} frame @ ${fps}fps -> ${outFile}`);
const res = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
if (!fs.existsSync(outFile)) {
  console.error('ffmpeg gagal:\n', (res.stderr || '').split('\n').slice(-15).join('\n'));
  process.exit(4);
}
console.log(
  `[make-video] selesai — ${(fs.statSync(outFile).size / 1024 / 1024).toFixed(2)} MB`
);
