import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { probeVideo, processVideo } from '../services/reelMedia.js';
import { embedReelText } from '../services/reelEmbedding.js';
import { cosine } from '../services/reelRanking.js';

const enabled = process.env.REELS_REAL_MEDIA_TESTS === 'true';
test('real FFprobe rejects >5 minutes; FFmpeg produces playable adaptive HLS and JPEG', { skip: !enabled, timeout: 120000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medipulse-real-reels-'));
  const old = process.env.REELS_MEDIA_ROOT; process.env.REELS_MEDIA_ROOT = root;
  const id = 'c'.repeat(24), originals = path.join(root, id, 'originals'); await fs.mkdir(originals, { recursive: true });
  try {
    const binary = process.env.REELS_FFMPEG_PATH || (await import('ffmpeg-static')).default;
    const make = (filename, seconds, size) => {
      const result = spawnSync(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=teal:s=${size}:r=1`, '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', filename], { timeout: 60000 });
      assert.equal(result.status, 0, result.stderr?.toString());
    };
    const short = path.join(originals, 'short.mp4'), long = path.join(originals, 'long.mp4');
    make(short, 2, '360x640'); make(long, 301, '16x16');
    assert.equal((await probeVideo(short)).duration, 2);
    await assert.rejects(probeVideo(long), /duration/);
    const output = await processVideo(id, short, .5);
    const master = await fs.readFile(path.join(output.outputDirectory, 'master.m3u8'), 'utf8');
    assert.match(master, /360p\/index.m3u8/); assert.match(master, /640p\/index.m3u8/);
    assert.ok((await fs.stat(path.join(output.outputDirectory, 'thumbnail.jpg'))).size > 100);
    const playlist = await fs.readFile(path.join(output.outputDirectory, '360p/index.m3u8'), 'utf8');
    assert.match(playlist, /#EXT-X-ENDLIST/); assert.match(playlist, /segment_00000.ts/);
    assert.ok((await fs.stat(path.join(output.outputDirectory, '360p/segment_00000.ts'))).size > 0);
  } finally { if (old === undefined) delete process.env.REELS_MEDIA_ROOT; else process.env.REELS_MEDIA_ROOT = old; await fs.rm(root, { recursive: true, force: true }); }
});
test('actual pinned multilingual HF embeddings are normalized and related across Hindi/English', { skip: !enabled, timeout: 180000 }, async () => {
  const texts = ['Heart health: regular exercise helps prevent cardiovascular disease.', 'हृदय स्वास्थ्य: नियमित व्यायाम से दिल की बीमारियों की रोकथाम।', 'Dental care: brush your teeth twice a day.'];
  const vectors = [];
  for (const title of texts) { const result = await embedReelText({ title, language: 'en' }); assert.equal(result.dimension, 384); vectors.push(result.vector); }
  assert.ok(Math.abs(Math.hypot(...vectors[0]) - 1) < .01);
  assert.ok(cosine(vectors[0], vectors[1]) > cosine(vectors[0], vectors[2]), 'Related Hindi/English examples should be closer than this dental example');
});
