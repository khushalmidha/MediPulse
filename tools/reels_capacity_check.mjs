// Local Docker only; full API/outbox with disposable synthetic Mongo/Redis targets.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const uri = new URL(process.env.DATABASE_URL || 'http://invalid');
assert.equal(uri.protocol, 'mongodb:');
assert.equal(uri.hostname, 'mongo');
assert.match(uri.pathname, /^\/medipulse_test_capacity_[a-f0-9]+$/);
assert.equal(uri.username, '');
assert.equal(uri.password, '');
assert.match(process.env.REDIS_URL || '', /^redis:\/\/capacity-redis-[a-f0-9]+:6379\/15$/);
assert.equal(process.platform, 'linux');
const seconds = Number(process.env.CAPACITY_VIDEO_SECONDS || 299);
assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 299);
Object.assign(process.env, {
  NODE_ENV: 'production', TOKEN_KEY: 'synthetic-capacity-only-signing-key', USE_REAL_REDIS: 'true',
  KAFKA_BROKERS: '', KAFKA_CREATE_TOPICS: 'false', MAIL_DELIVERY: 'disabled',
  GEMINI_API_KEY: '', HF_TOKEN: '', CLIENT_URLS: 'http://localhost:15173',
  REELS_ENABLED: 'true', ENTERPRISE_PILOT_ENABLED: 'false',
  REELS_MEDIA_ROOT: '/tmp/reels-capacity', REELS_EMBEDDING_ALLOW_DOWNLOAD: 'false',
  API_PROBE_URL: 'http://127.0.0.1:8080/health/live',
});
const require = createRequire('/app/package.json');
const mongoose = require('mongoose'), jwt = require('jsonwebtoken');
const User = (await import('/app/model/user.js')).default;
const Doctor = (await import('/app/model/doctor.js')).default;
const AuthSession = (await import('/app/model/authSession.js')).default;
const { Reel } = await import('/app/model/reel.js');
const { applyReelsSchema } = await import('/app/scripts/reelsSchema.js');
const boot = spawnSync(process.execPath, ['scripts/bootstrapQueues.js'], { cwd: '/app', env: process.env, timeout: 90000, encoding: 'utf8' });
assert.equal(boot.status, 0, 'Isolated empty schema bootstrap failed');
await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false });
await applyReelsSchema();
const actors = {};
for (const kind of ['patient', 'author', 'reviewer']) {
  const role = kind === 'patient' ? 'user' : 'doctor';
  const data = { firstName: 'Synthetic', lastName: kind, email: `${kind}@capacity.invalid`, password: 'Synthetic-password-only', gender: 'other' };
  const principal = await (role === 'user' ? User : Doctor).create({ ...data, ...(role === 'doctor' ? { experience: { years: 1, expertise: 'Education' }, credentialVerification: { status: 'verified' } } : {}) });
  const sid = randomUUID();
  await AuthSession.create({ _id: sid, principalId: principal._id, kind: role, csrfToken: 'capacity-csrf', expiresAt: new Date(Date.now() + 3600000) });
  actors[kind] = { id: String(principal._id), token: jwt.sign({ id: String(principal._id), sid, role }, process.env.TOKEN_KEY) };
}
process.env.REELS_REVIEWER_DOCTOR_IDS = actors.reviewer.id;
let api, timer, sampling = false;
const observations = [], failures = [];
async function request(route, { kind = 'patient', method = 'GET', body, raw = false, headers = {} } = {}) {
  return fetch('http://127.0.0.1:8080' + route, { method, signal: AbortSignal.timeout(15000), headers: {
    Cookie: `token=${actors[kind].token}`, Origin: 'http://localhost:15173', 'X-CSRF-Token': 'capacity-csrf',
    'Content-Type': raw ? 'video/mp4' : 'application/json', ...headers,
  }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
}
async function json(route, options) {
  const response = await request(route, options); assert.ok(response.ok, `Synthetic ${route} failed: ${response.status}`); return response.json();
}
try {
  api = spawn(process.execPath, ['index.js'], { cwd: '/app', env: process.env, stdio: 'ignore' });
  const readyDeadline = Date.now() + 60000;
  for (;;) {
    try { if ((await request('/health/ready')).ok) break; } catch { /* Wait for local API. */ }
    if (Date.now() > readyDeadline) throw Error('Full API readiness did not pass');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await fs.mkdir(process.env.REELS_MEDIA_ROOT, { recursive: true });
  const source = '/tmp/capacity-source.mp4';
  const generated = spawnSync('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-b:v', '800k', '-maxrate', '1000k', '-bufsize', '2000k', '-c:a', 'aac', '-b:a', '64k', '-threads', '2', source], { timeout: 180000 });
  assert.equal(generated.status, 0, 'Synthetic source generation failed');
  console.log(JSON.stringify({ phase: 'full-api-ready-and-source-generated', videoSeconds: seconds, sourceBytes: (await fs.stat(source)).size }));
  timer = setInterval(async () => {
    if (sampling) return; sampling = true;
    try {
      for (const route of ['/health/live', '/api/reels/feed', '/verify']) {
        const start = performance.now();
        try {
          const response = await request(route); await response.arrayBuffer();
          observations.push({ route, ms: performance.now() - start, status: response.status });
          if (!response.ok) failures.push({ route, status: response.status });
        } catch { failures.push({ route, status: 'timeout-or-network' }); }
      }
    } finally { sampling = false; }
  }, 1000);
  const started = performance.now();
  const created = await json('/api/reels/', { kind: 'author', method: 'POST', body: { title: 'Synthetic capacity education', caption: 'Synthetic public teaching metadata. '.repeat(50), topics: ['heart health'], language: 'en', educationalOnly: true, privacyConfirmed: true, thumbnailSeconds: 1, idempotencyKey: randomUUID() } });
  let bytes = await fs.readFile(source);
  const upload = await json(`/api/reels/${created.reel.id}/upload`, { kind: 'author', method: 'PUT', body: bytes, raw: true, headers: { 'Idempotency-Key': randomUUID() } });
  bytes = null; global.gc?.();
  let current = upload.reel;
  const deadline = Date.now() + 600000;
  while (current.mediaStatus !== 'ready') {
    if (current.mediaStatus === 'failed') throw Error('Actual API/outbox processing failed');
    if (Date.now() > deadline) throw Error('Processing capacity deadline exceeded');
    await new Promise(resolve => setTimeout(resolve, 1000));
    current = (await json('/api/reels/mine', { kind: 'author' })).items.find(row => row.id === current.id);
  }
  const processingSeconds = (performance.now() - started) / 1000;
  const submitted = await json(`/api/reels/${current.id}/submit`, { kind: 'author', method: 'POST', body: { version: current.version } });
  const published = await json(`/api/reels/${current.id}/moderate`, { kind: 'reviewer', method: 'POST', body: { version: submitted.reel.version, decision: 'publish', reason: 'Synthetic capacity exercise only' } });
  const manifest = await request(published.reel.playbackUrl); assert.equal(manifest.status, 200);
  assert.match(await manifest.text(), /#EXTM3U/);
  const variantUrl = published.reel.playbackUrl.replace('master.m3u8', '360p/index.m3u8');
  const variant = await request(variantUrl); assert.equal(variant.status, 200);
  const segment = (await variant.text()).split('\n').find(line => line.endsWith('.ts'));
  const segmentResponse = await request(variantUrl.replace('index.m3u8', segment)); assert.equal(segmentResponse.status, 200); await segmentResponse.arrayBuffer();
  const stored = await Reel.findById(current.id).select('+embedding').lean(); assert.equal(stored.embedding.length, 384);
  clearInterval(timer); while (sampling) await new Promise(resolve => setTimeout(resolve, 100));
  const latencies = observations.map(row => row.ms).sort((a, b) => a - b);
  const result = {
    scenario: 'Full API + actual outbox/HF/FFmpeg + authenticated HTTP probes; Redis separate capped sidecar',
    videoSeconds: seconds, processingSeconds: Math.round(processingSeconds * 100) / 100,
    backendContainerPeakMiB: Math.round(Number(await fs.readFile('/sys/fs/cgroup/memory.peak', 'utf8')) / 1048576),
    backendContainerMemoryCapMiB: Math.round(Number(await fs.readFile('/sys/fs/cgroup/memory.max', 'utf8')) / 1048576),
    httpSamples: observations.length, httpFailures: failures.length,
    p95Ms: Math.round(latencies[Math.floor(latencies.length * .95)] || 0), maxMs: Math.round(latencies.at(-1) || 0),
    independentPublishAndAuthenticatedHls: true, actualEmbeddingDimension: stored.embedding.length,
    limitations: 'Local Docker; Mongo outside memory cap like Atlas. Host OS/Caddy and burst-credit depletion not simulated. Single video and light synthetic API traffic; not AWS/device acceptance.',
  };
  console.log(JSON.stringify(result));
  assert.equal(failures.length, 0, 'Synthetic API failures during processing');
} finally {
  clearInterval(timer);
  if (api) {
    api.kill('SIGTERM');
    await Promise.race([new Promise(resolve => api.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 12000))]);
    if (api.exitCode === null) api.kill('SIGKILL');
  }
  // Drop only this explicitly validated, disposable local test database.
  assert.equal(mongoose.connection.db.databaseName, uri.pathname.slice(1));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
