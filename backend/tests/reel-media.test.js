import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { mediaRoot, safeReelDirectory, receiveVideo, validateProbeMetadata, durationFromWebmPackets, cleanupReelJob } from '../services/reelMedia.js';
import { reelEmbeddingText } from '../services/reelEmbedding.js';

const reelId = 'a'.repeat(24);
test('media storage rejects traversal and requires configured absolute root', async () => {
  const previous = process.env.REELS_MEDIA_ROOT;
  process.env.REELS_MEDIA_ROOT = 'relative';
  assert.throws(mediaRoot, /absolute/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-media-'));
  process.env.REELS_MEDIA_ROOT = root;
  try {
    for (const id of ['../escape', 'a'.repeat(23), 'A'.repeat(24), `${reelId}/../x`]) assert.throws(() => safeReelDirectory(id), /Invalid/);
    assert.equal(safeReelDirectory(reelId), path.join(root, reelId));
    await assert.rejects(cleanupReelJob(reelId, '../escape'), /Invalid/);
  } finally { if (previous === undefined) delete process.env.REELS_MEDIA_ROOT; else process.env.REELS_MEDIA_ROOT = previous; await fs.rm(root, { recursive: true, force: true }); }
});

test('upload bounds, magic, exclusive original writes and failed partial cleanup', async () => {
  const previous = process.env.REELS_MEDIA_ROOT;
  const max = process.env.REELS_MAX_UPLOAD_BYTES;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-upload-'));
  process.env.REELS_MEDIA_ROOT = root; process.env.REELS_MAX_UPLOAD_BYTES = '32';
  const request = (buffer, headers = {}) => Object.assign(Readable.from([buffer]), { headers: { 'content-type': 'video/mp4', ...headers } });
  const mp4 = Buffer.from('0000ftypisom00000000');
  try {
    await assert.rejects(receiveVideo(request(mp4, { 'content-length': '33' }), reelId, randomUUID()), /byte limit/);
    await assert.rejects(receiveVideo(request(Buffer.alloc(33)), reelId, randomUUID()), /byte limit/);
    await assert.rejects(receiveVideo(request(Buffer.from('not video')), reelId, randomUUID()), /genuine/);
    const uploadId = randomUUID();
    const accepted = await receiveVideo(request(mp4), reelId, uploadId);
    assert.equal(accepted.bytes, mp4.length); assert.equal(accepted.sha256.length, 64);
    await assert.rejects(receiveVideo(request(mp4), reelId, uploadId), { code: 'EEXIST' });
    assert.deepEqual(await fs.readFile(accepted.path), mp4);
    assert.deepEqual(await fs.readdir(path.dirname(accepted.path)), [`${uploadId}.mp4`]);
    const broken = new Readable({ read() { this.push(mp4); this.destroy(new Error('client aborted')); } });
    broken.headers = { 'content-type': 'video/mp4' };
    await assert.rejects(receiveVideo(broken, reelId, randomUUID()), /client aborted/);
    assert.deepEqual(await fs.readdir(path.dirname(accepted.path)), [`${uploadId}.mp4`]);
  } finally { if (previous === undefined) delete process.env.REELS_MEDIA_ROOT; else process.env.REELS_MEDIA_ROOT = previous; if (max === undefined) delete process.env.REELS_MAX_UPLOAD_BYTES; else process.env.REELS_MAX_UPLOAD_BYTES = max; await fs.rm(root, { recursive: true, force: true }); }
});

test('probe rejects missing streams, duration and decoded dimension bombs', () => {
  const metadata = { streams: [{ codec_type: 'video', width: 1280, height: 720 }], format: { duration: '30', format_name: 'mov,mp4' } };
  assert.deepEqual(validateProbeMetadata(metadata), { width: 1280, height: 720, duration: 30 });
  for (const duration of ['Infinity', 'NaN', '0', '-1', '301']) assert.throws(() => validateProbeMetadata({ ...metadata, format: { ...metadata.format, duration } }), /duration/);
  assert.throws(() => validateProbeMetadata({ ...metadata, streams: [{ codec_type: 'audio' }] }), /dimensions/);
  assert.throws(() => validateProbeMetadata({ ...metadata, streams: [{ codec_type: 'video', width: 100000, height: 100000 }] }), /dimensions/);
  assert.throws(() => validateProbeMetadata({ ...metadata, format: { duration: '10', format_name: 'hls' } }), /container/);
});

test('embedding accepts bounded public multilingual metadata only', () => {
  assert.equal(reelEmbeddingText({ title: 'हृदय स्वास्थ्य', topics: ['prevention'], language: 'hi' }), 'हृदय स्वास्थ्य\nprevention\nhi');
  assert.throws(() => reelEmbeddingText({ caption: 'x'.repeat(4001) }), /limits/);
  assert.throws(() => reelEmbeddingText({ topics: [1] }), /Invalid/);
  assert.throws(() => reelEmbeddingText({}), /empty/);
});

test('WebM duration uses complete packet timestamps and real packet durations only', () => {
  const packets = [{ pts_time: '0.033', duration_time: '0.033' }, { pts_time: '0.066', duration_time: '0.034' }];
  assert.equal(durationFromWebmPackets(packets, 2), 0.1);
  // Out-of-order PTS is valid; duration is the furthest actual frame end.
  assert.equal(durationFromWebmPackets([...packets].reverse(), 2), 0.1);
  assert.equal(durationFromWebmPackets([{ pts_time: '0', duration_time: 'N/A' }, { pts_time: '.05', duration_time: '0' }], 2), .1);
  assert.throws(() => durationFromWebmPackets(packets, 3), /Incomplete/);
  assert.throws(() => durationFromWebmPackets([], 0), /Incomplete/);
  for (const packet of [
    { pts_time: undefined, duration_time: '0.033' }, { pts_time: '', duration_time: '0.033' },
    { pts_time: '0', duration_time: undefined }, { pts_time: '0', duration_time: '0' },
    { pts_time: '-0.01', duration_time: '0.033' }, { pts_time: 'NaN', duration_time: '0.033' },
    { pts_time: '0', duration_time: 'Infinity' }, { pts_time: '0', duration_time: '-1' },
    { pts_time: '299.99', duration_time: '0.033' },
  ]) assert.throws(() => durationFromWebmPackets([packet], 1), /timing|duration/);
  assert.equal(durationFromWebmPackets([{ pts_time: '299', duration_time: '1' }], 1), 300);
});
