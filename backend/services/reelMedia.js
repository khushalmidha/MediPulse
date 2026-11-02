import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const limit = (name, fallback, ceiling) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0 || value > ceiling) throw new Error(`Invalid ${name}`);
  return value;
};
const invalid = (message, status = 400) => Object.assign(new Error(message), { status, statusCode: status });
export function mediaRoot() {
  const configured = process.env.REELS_MEDIA_ROOT || (process.env.NODE_ENV === 'test' ? path.join(os.tmpdir(), 'medipulse-reels-test') : '');
  if (!configured || !path.isAbsolute(configured)) throw new Error('REELS_MEDIA_ROOT must be an absolute private storage directory');
  return path.resolve(configured);
}
function contained(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
export function safeReelDirectory(reelId) {
  if (typeof reelId !== 'string' || !/^[a-f\d]{24}$/.test(reelId)) throw invalid('Invalid reel ID');
  const directory = path.resolve(mediaRoot(), reelId);
  if (!contained(mediaRoot(), directory)) throw invalid('Invalid media path');
  return directory;
}
// Reject symlinks/junctions throughout storage, including configured parent directories.
async function checked(target, { directory = false } = {}) {
  const resolved = path.resolve(target);
  const root = mediaRoot();
  if (resolved !== root && !contained(root, resolved)) throw invalid('Media path escapes storage');
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw invalid('Symbolic links are forbidden in media storage');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (directory) { await fs.mkdir(resolved, { recursive: true, mode: 0o700 }); await checked(resolved); }
  return resolved;
}
function magicType(buffer) {
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && buffer.includes(Buffer.from('webm'))) return 'video/webm';
  throw invalid('Only genuine MP4 or WebM uploads are supported', 415);
}
export async function receiveVideo(req, reelId, uploadId) {
  if (!UUID.test(uploadId || '')) throw invalid('Invalid upload ID');
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!['video/mp4', 'video/webm'].includes(mime)) throw invalid('Content-Type must be video/mp4 or video/webm', 415);
  const max = limit('REELS_MAX_UPLOAD_BYTES', 200 * 1024 * 1024, 1024 * 1024 * 1024);
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(String(declared)) || Number(declared) > max)) throw invalid('Upload exceeds byte limit', 413);
  const directory = await checked(path.join(safeReelDirectory(reelId), 'originals'), { directory: true });
  const temporary = path.join(directory, `${uploadId}.part`);
  const destination = path.join(directory, `${uploadId}${mime === 'video/mp4' ? '.mp4' : '.webm'}`);
  const hash = createHash('sha256');
  let bytes = 0; let header = Buffer.alloc(0); let created = false;
  const file = await fs.open(temporary, 'wx', 0o600); created = true;
  try {
    const meter = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > max) return callback(invalid('Upload exceeds byte limit', 413));
      if (header.length < 4096) header = Buffer.concat([header, chunk.subarray(0, 4096 - header.length)]);
      hash.update(chunk); callback(null, chunk);
    } });
    await pipeline(req, meter, file.createWriteStream());
    if (!bytes || magicType(header) !== mime) throw invalid('Video content does not match Content-Type', 415);
    // link is exclusive, unlike rename, so retrying an upload ID cannot overwrite an original.
    await fs.link(temporary, destination);
    await fs.unlink(temporary);
    return { path: destination, sha256: hash.digest('hex'), bytes };
  } catch (error) {
    await file.close().catch(() => {});
    if (created) await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}
async function executable(kind) {
  const override = process.env[`REELS_${kind.toUpperCase()}_PATH`];
  if (override) {
    if (!path.isAbsolute(override)) throw new Error(`REELS_${kind.toUpperCase()}_PATH must be absolute`);
    return override;
  }
  const module = await import(`${kind}-static`);
  return kind === 'ffprobe' ? module.default.path : module.default;
}
async function directorySize(directory) {
  let total = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Unexpected output symlink');
    total += entry.isDirectory() ? await directorySize(filename) : (await fs.stat(filename)).size;
  }
  return total;
}
async function run(kind, args, outputDirectory) {
  const binary = await executable(kind);
  const timeout = limit('REELS_PROCESS_TIMEOUT_MS', 180000, 600000);
  const maxOutput = limit('REELS_MAX_OUTPUT_BYTES', 512 * 1024 * 1024, 1024 * 1024 * 1024);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let failure;
    const stop = error => { failure ||= error; child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop(new Error(`${kind} timed out`)), timeout);
    let checking = false;
    const monitor = outputDirectory && setInterval(async () => {
      if (checking) return; checking = true;
      try { if (await directorySize(outputDirectory) > maxOutput) stop(new Error('Processed media exceeds byte limit')); }
      catch (error) { stop(error); } finally { checking = false; }
    }, 250);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 1024 * 1024) stop(new Error('Excessive process output')); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      clearTimeout(timer); if (monitor) clearInterval(monitor);
      if (failure || code !== 0) reject(failure || new Error(`${kind} failed: ${stderr}`)); else resolve(stdout);
    });
  });
}
export function validateProbeMetadata(metadata) {
  const video = metadata.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const width = Number(video?.width); const height = Number(video?.height);
  const duration = Number(metadata.format?.duration);
  if (!video || !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 3840 || height > 3840 || width * height > 8294400) throw invalid('Video dimensions are unsupported');
  if (!Number.isFinite(duration) || duration <= 0 || duration > 300) throw invalid('Video duration must be between 0 and 300 seconds');
  const formats = String(metadata.format?.format_name || '').split(',');
  if (!formats.some(format => ['mov', 'mp4', 'webm'].includes(format))) throw invalid('Unsupported video container');
  return { duration, width, height };
}
export function durationFromWebmPackets(packets, expectedCount) {
  if (!Array.isArray(packets) || !packets.length || !Number.isSafeInteger(expectedCount) || expectedCount !== packets.length) throw invalid('Incomplete WebM video timeline');
  const times = packets.map(packet => Number(packet.pts_time));
  if (times.some(time => !Number.isFinite(time) || time < 0)) throw invalid('Invalid WebM packet timing');
  // MediaRecorder may omit packet durations. Bound the terminal frame using the
  // largest actually observed positive inter-frame interval, not a client FPS.
  const ordered = [...times].sort((a, b) => a - b);
  const observedInterval = ordered.reduce((max, time, i) => Math.max(max, i ? time - ordered[i - 1] : 0), 0);
  let end = 0;
  for (const packet of packets) {
    // Missing durations cannot be inferred from a nominal FPS or a client value.
    const numeric = value => (typeof value === 'string' && value.trim() !== '') || typeof value === 'number';
    if (!numeric(packet.pts_time)) throw invalid('Incomplete WebM packet timing');
    const timestamp = Number(packet.pts_time), given = Number(packet.duration_time);
    const absent = packet.duration_time === undefined || packet.duration_time === null || packet.duration_time === 'N/A' || packet.duration_time === '';
    if (!absent && (!Number.isFinite(given) || given < 0)) throw invalid('Invalid WebM packet timing');
    const duration = numeric(packet.duration_time) && Number.isFinite(given) && given > 0 ? given : observedInterval;
    if (!Number.isFinite(timestamp) || timestamp < 0 || !Number.isFinite(duration) || duration <= 0) throw invalid('Invalid WebM packet timing');
    end = Math.max(end, timestamp + duration);
    if (!Number.isFinite(end) || end > 300) throw invalid('Video duration must be between 0 and 300 seconds');
  }
  if (end <= 0) throw invalid('Invalid WebM video duration');
  return end;
}
export async function probeVideo(inputPath) {
  if (!path.isAbsolute(inputPath) || !(await fs.lstat(inputPath)).isFile()) throw invalid('Expected a local video file');
  const file = await fs.open(inputPath, 'r');
  try { const buffer = Buffer.alloc(4096); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0); magicType(buffer.subarray(0, bytesRead)); }
  finally { await file.close(); }
  const common = ['-v', 'error', '-max_alloc', '268435456', '-max_pixels', '8294400', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm'];
  const output = await run('ffprobe', [...common, '-show_format', '-show_streams', '-of', 'json', inputPath]);
  const metadata = JSON.parse(output);
  const formats = String(metadata.format?.format_name || '').split(',');
  const rawDuration = metadata.format?.duration;
  const missingDuration = rawDuration === undefined || rawDuration === null || rawDuration === '' || !Number.isFinite(Number(rawDuration));
  if (missingDuration && formats.some(format => ['matroska', 'webm'].includes(format))) {
    // Validate dimensions/container before inspecting any packet timeline.
    validateProbeMetadata({ ...metadata, format: { ...metadata.format, duration: 1 } });
    const timeline = await run('ffprobe', [...common, '-select_streams', 'v:0', '-read_intervals', '%+301', '-show_packets', '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', inputPath]);
    const packets = timeline.trim() ? timeline.trim().split(/\r?\n/).map(line => {
      const fields = line.split(',');
      if (fields.length !== 2) throw invalid('Invalid WebM packet timing');
      return { pts_time: fields[0], duration_time: fields[1] };
    }) : [];
    // The interval can terminate at a timestamp discontinuity. A bounded full
    // count verifies EOF rather than silently accepting a truncated estimate.
    const counted = await run('ffprobe', [...common, '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'json', inputPath]);
    const counts = JSON.parse(counted).streams;
    const count = counts?.length === 1 ? Number(counts[0].nb_read_packets) : NaN;
    metadata.format.duration = durationFromWebmPackets(packets, count);
  }
  return validateProbeMetadata(metadata);
}
export async function processVideo(reelId, inputPath, thumbnailSeconds = 0, jobId = randomUUID()) {
  if (!UUID.test(jobId || '')) throw invalid('Invalid processing job ID');
  const reelDirectory = safeReelDirectory(reelId);
  if (!contained(reelDirectory, path.resolve(inputPath))) throw invalid('Input does not belong to reel');
  await checked(inputPath);
  const metadata = await probeVideo(inputPath);
  const jobs = await checked(path.join(reelDirectory, 'jobs'), { directory: true });
  const outputDirectory = path.join(jobs, jobId);
  await fs.mkdir(outputDirectory, { mode: 0o700 });
  const common = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-max_alloc', '268435456', '-max_pixels', '8294400', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm', '-threads', '2', '-i', inputPath];
  try {
    const heights = [...new Set([Math.min(360, metadata.height), Math.min(720, metadata.height)].map(height => Math.floor(height / 2) * 2))];
    const variants = [];
    for (const height of heights) {
      const name = `${height}p`; const directory = path.join(outputDirectory, name); await fs.mkdir(directory);
      const bitrate = height <= 360 ? 800000 : 2400000;
      await run('ffmpeg', [...common, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-t', String(metadata.duration), '-vf', `scale=-2:${height},setsar=1`, '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2', '-pix_fmt', 'yuv420p', '-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate * 2), '-r', '30', '-g', '120', '-keyint_min', '120', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '96000', '-ac', '2', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_filename', path.join(directory, 'segment_%05d.ts'), path.join(directory, 'index.m3u8')], outputDirectory);
      variants.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bitrate + 128000}\n${name}/index.m3u8`);
    }
    const seconds = Number(thumbnailSeconds);
    if (!Number.isFinite(seconds)) throw invalid('Invalid thumbnail time');
    const timestamp = Math.min(Math.max(seconds, 0), Math.max(metadata.duration - 0.05, 0));
    await run('ffmpeg', [...common, '-ss', String(timestamp), '-map', '0:v:0', '-frames:v', '1', '-vf', `scale=-2:${Math.min(720, metadata.height)}`, '-threads', '2', '-q:v', '3', path.join(outputDirectory, 'thumbnail.jpg')], outputDirectory);
    await fs.writeFile(path.join(outputDirectory, 'master.m3u8'), `#EXTM3U\n#EXT-X-VERSION:3\n${variants.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
    if (await directorySize(outputDirectory) > limit('REELS_MAX_OUTPUT_BYTES', 512 * 1024 * 1024, 1024 * 1024 * 1024)) throw new Error('Processed media exceeds byte limit');
    return { ...metadata, outputDirectory, masterFile: 'master.m3u8', thumbnailFile: 'thumbnail.jpg' };
  } catch (error) { await cleanupReelJob(reelId, jobId); throw error; }
}
export async function cleanupReelJob(reelId, jobId) {
  if (!UUID.test(jobId || '')) throw invalid('Invalid processing job ID');
  const target = await checked(path.join(safeReelDirectory(reelId), 'jobs', jobId));
  await fs.rm(target, { recursive: true, force: true });
}
export async function cleanupReelDirectory(reelId) {
  const target = await checked(safeReelDirectory(reelId));
  await fs.rm(target, { recursive: true, force: true });
}
