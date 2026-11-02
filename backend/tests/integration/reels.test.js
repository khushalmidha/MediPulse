import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localTestTargets } from '../../util/testTargets.js';
import User from '../../model/user.js';
import Doctor from '../../model/doctor.js';
import AuthSession from '../../model/authSession.js';
import OutboxJob from '../../model/outboxJob.js';
import { Reel, ReelReaction, ReelSignal, ReelPlayback, ReelComment, ReelAudit } from '../../model/reel.js';
import { applyReelsSchema, inspectReelsSchema } from '../../scripts/reelsSchema.js';
import { assertReelsReady, finalizeUpload } from '../../services/reelService.js';
import { processReelJob } from '../../services/reelProcessing.js';
import { runOutboxBatch } from '../../services/outbox.js';
import { closeRedis } from '../../services/redis.js';
import router from '../../routes/reels.js';

const uri = new URL(localTestTargets().mongo); uri.pathname = `/medipulse_test_reels_${crypto.randomBytes(8).toString('hex')}`;
const ids = Object.fromEntries(['patient', 'otherPatient', 'author', 'reviewer', 'unverified', 'otherDoctor'].map(k => [k, new mongoose.Types.ObjectId()]));
const sessions = {}, author = () => sessions.author;
let origin, server, root, video;
const metadata = () => ({ title: 'Exercise and heart health', caption: 'Educational explanation, not individual medical advice.', topics: ['heart health'], language: 'en', privacyConfirmed: true, educationalOnly: true, idempotencyKey: crypto.randomUUID() });
async function request(url, { role = 'patient', method = 'GET', body, csrf = true, token, headers = {} } = {}) {
  const response = await fetch(origin + '/api/reels' + url, { method, headers: { Cookie: `token=${token || sessions[role].token}`, Origin: 'http://localhost:5173', ...(csrf ? { 'X-CSRF-Token': 'reels-test-csrf' } : {}), 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  const type = response.headers.get('content-type') || '';
  return { status: response.status, data: type.includes('json') ? await response.json() : await response.text() };
}
async function create(role = 'author', fields = {}) { const result = await request('/', { role, method: 'POST', body: { ...metadata(), ...fields } }); assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data.reel; }
const vector = () => [1, ...new Array(383).fill(0)];
const fixtureAdapters = {
  embed: async () => ({ vector: vector(), dimension: 384, model: 'fixture-only-semantic-model', revision: 'test' }),
  transcode: async (id, source, thumbnail, job) => {
    const outputDirectory = path.join(root, id, 'jobs', job); await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(path.join(outputDirectory, 'master.m3u8'), '#EXTM3U\n');
    await fs.writeFile(path.join(outputDirectory, 'thumbnail.jpg'), 'fixture');
    return { outputDirectory, duration: 2, width: 360, height: 640 };
  },
};
before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  assert.ok((await inspectReelsSchema()).some(x => x.missing.length)); await assert.rejects(assertReelsReady(), /migration/);
  await applyReelsSchema(); await OutboxJob.createIndexes(); await AuthSession.createIndexes();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'reels-integration-')); process.env.REELS_MEDIA_ROOT = root;
  process.env.REELS_REVIEWER_DOCTOR_IDS = `${ids.author},${ids.reviewer}`;
  for (const [name, id] of Object.entries(ids)) {
    const role = name.endsWith('Patient') || name === 'patient' ? 'user' : 'doctor';
    const details = { _id: id, firstName: `Synthetic ${name}`, email: `${name}@reels.example.test`, password: 'Isolated-test-password', gender: 'other' };
    if (role === 'doctor') await Doctor.create({ ...details, experience: { years: 5, expertise: 'Education' }, credentialVerification: { status: name === 'unverified' ? 'pending' : 'verified' } }); else await User.create(details);
    const sid = crypto.randomUUID(); await AuthSession.create({ _id: sid, principalId: id, kind: role, csrfToken: 'reels-test-csrf', expiresAt: new Date(Date.now() + 3600000) });
    sessions[name] = { token: jwt.sign({ id: String(id), sid, role }, process.env.TOKEN_KEY), sid };
  }
  const app = express(); app.use(cookieParser()); app.use(express.json()); app.use('/api/reels', router);
  app.use((error, req, res, next) => { if (res.headersSent) return next(error); res.status(error.status || 500).json({ message: error.status ? error.message : 'Server error' }); });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
  const binary = (await import('ffmpeg-static')).default, file = path.join(root, 'source.mp4');
  const made = spawnSync(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=360x640:r=1', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file], { timeout: 30000 });
  assert.equal(made.status, 0, made.stderr?.toString()); video = await fs.readFile(file);
});
after(async () => { if (server) { server.close(); await once(server, 'close'); } if (mongoose.connection.db?.databaseName === uri.pathname.slice(1)) await mongoose.connection.dropDatabase(); await mongoose.disconnect(); await closeRedis(); if (root) await fs.rm(root, { recursive: true, force: true }); });

test('real reels router, upload, review, engagement and personalization boundaries', async t => {
  let reel;
  await t.test('cookie CSRF, verified identity and required attestation are enforced', async () => {
    assert.equal((await request('/', { method: 'POST', body: metadata() })).status, 403);
    assert.equal((await request('/', { role: 'unverified', method: 'POST', body: metadata() })).status, 403);
    assert.equal((await request('/', { role: 'author', method: 'POST', body: metadata(), csrf: false })).status, 403);
    assert.equal((await request('/', { role: 'author', method: 'POST', body: { ...metadata(), privacyConfirmed: false } })).status, 400);
  });
  await t.test('concurrent creation has one outcome and changed-command replay conflicts', async () => {
    const body = metadata(), results = await Promise.all([request('/', { role: 'author', method: 'POST', body }), request('/', { role: 'author', method: 'POST', body })]);
    assert.equal(results[0].status, 201); assert.equal(results[1].status, 201); assert.equal(results[0].data.reel.id, results[1].data.reel.id); reel = results[0].data.reel;
    assert.equal(await Reel.countDocuments({ doctorId: ids.author, creationKey: body.idempotencyKey }), 1);
    assert.equal((await request('/', { role: 'author', method: 'POST', body: { ...body, caption: 'Changed content' } })).status, 409);
  });
  await t.test('draft/owner privacy, upload content validation and duration-first queueing', async () => {
    assert.equal((await request(`/${reel.id}`, { role: 'otherDoctor', method: 'PATCH', body: { ...metadata(), version: 0 } })).status, 404);
    assert.equal((await request(`/${reel.id}/submit`, { role: 'author', method: 'POST', body: { version: 0 } })).status, 409);
    const uploadKey = crypto.randomUUID();
    assert.equal((await request(`/${reel.id}/upload`, { role: 'author', method: 'PUT', body: Buffer.from('not a video'), headers: { 'Content-Type': 'video/mp4', 'Idempotency-Key': uploadKey } })).status, 415);
    const uploaded = await request(`/${reel.id}/upload`, { role: 'author', method: 'PUT', body: video, headers: { 'Content-Type': 'video/mp4', 'Idempotency-Key': uploadKey } });
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data)); assert.equal(uploaded.data.reel.mediaStatus, 'queued'); reel = uploaded.data.reel;
    const replay = await request(`/${reel.id}/upload`, { role: 'author', method: 'PUT', body: video, headers: { 'Content-Type': 'video/mp4', 'Idempotency-Key': uploadKey } }); assert.equal(replay.status, 200); assert.equal(replay.data.replay, true);
    assert.equal(await OutboxJob.countDocuments({ kind: 'reels.process' }), 1);
    const result = await runOutboxBatch(job => processReelJob(job, process.env.REELS_REAL_MEDIA_TESTS === 'true' ? undefined : fixtureAdapters), { limit: 1 });
    assert.equal(result.delivered, 1); const mine = await request('/mine', { role: 'author' }); reel = mine.data.items.find(x => x.id === reel.id); assert.equal(reel.mediaStatus, 'ready');
  });
  await t.test('only independent approved reviewers publish the exact processed version', async () => {
    const submitted = await request(`/${reel.id}/submit`, { role: 'author', method: 'POST', body: { version: reel.version } }); assert.equal(submitted.status, 200); reel = submitted.data.reel;
    assert.equal((await request(`/${reel.id}/moderate`, { role: 'author', method: 'POST', body: { version: reel.version, decision: 'publish' } })).status, 403);
    assert.equal((await request(`/${reel.id}/moderate`, { role: 'otherDoctor', method: 'POST', body: { version: reel.version, decision: 'publish' } })).status, 403);
    assert.equal((await request(`/${reel.id}/moderate`, { role: 'reviewer', method: 'POST', body: { version: 0, decision: 'publish' } })).status, 409);
    const published = await request(`/${reel.id}/moderate`, { role: 'reviewer', method: 'POST', body: { version: reel.version, decision: 'publish', reason: 'Synthetic educational media reviewed' } }); assert.equal(published.status, 200); reel = published.data.reel;
    assert.equal((await request('/feed')).data.items[0].id, reel.id);
    const media = await request(reel.playbackUrl.replace('/api/reels', '')); assert.equal(media.status, 200); assert.match(media.data, /#EXTM3U/);
    assert.equal((await request(`/media/${reel.id}/${reel.playbackUrl.split('/')[5]}/originals/source.mp4`)).status, 404);
  });
  await t.test('reactions are explicit, retry safe and cannot double increment counts', async () => {
    const results = await Promise.all(new Array(3).fill(null).map(() => request(`/${reel.id}/reactions`, { method: 'POST', body: { kind: 'like', active: true } })));
    assert.ok(results.every(x => x.status === 200)); assert.equal(await ReelReaction.countDocuments({ reelId: reel.id, kind: 'like' }), 1); assert.equal((await Reel.findById(reel.id)).counts.likes, 1);
    await request(`/${reel.id}/reactions`, { method: 'POST', body: { kind: 'like', active: false } }); await request(`/${reel.id}/reactions`, { method: 'POST', body: { kind: 'like', active: false } }); assert.equal((await Reel.findById(reel.id)).counts.likes, 0);
  });
  await t.test('comments have command identity and no reporter/principal leakage', async () => {
    const body = { text: 'Useful educational explanation.', idempotencyKey: crypto.randomUUID() };
    assert.equal((await request(`/${reel.id}/comments`, { method: 'POST', body })).status, 201); assert.equal((await request(`/${reel.id}/comments`, { method: 'POST', body })).status, 201);
    assert.equal(await ReelComment.countDocuments({ reelId: reel.id }), 1);
    const list = await request(`/${reel.id}/comments`); assert.equal(list.data.items.length, 1); assert.ok(!('actorKey' in list.data.items[0]));
    assert.equal((await request(`/${reel.id}/comments`, { method: 'POST', body: { ...body, text: 'Changed' } })).status, 409);
  });
  await t.test('watch events are actor bound, sequential, idempotent and wall-clock capped', async () => {
    const begun = await request(`/${reel.id}/playback`, { method: 'POST', body: {} }), sessionId = begun.data.sessionId;
    const body = { eventId: crypto.randomUUID(), sessionId, sequence: 1, type: 'watch', watchMs: 15000 };
    assert.equal((await request(`/${reel.id}/events`, { role: 'otherPatient', method: 'POST', body })).status, 409);
    const credited = await request(`/${reel.id}/events`, { method: 'POST', body }); assert.equal(credited.status, 200); assert.ok(credited.data.creditedWatchMs < 15000);
    assert.equal((await request(`/${reel.id}/events`, { method: 'POST', body })).data.replay, true); assert.equal(await ReelSignal.countDocuments({}), 0);
    await request('/preferences', { method: 'POST', body: { personalizationEnabled: true, topics: ['heart health'] } });
    await ReelPlayback.updateOne({ _id: sessionId }, { $set: { lastEventAt: new Date(Date.now() - 5000) } });
    assert.equal((await request(`/${reel.id}/events`, { method: 'POST', body: { ...body, eventId: crypto.randomUUID(), sequence: 2, watchMs: 2000 } })).status, 200);
    assert.equal(await ReelSignal.countDocuments({}), 1);
    await request('/preferences', { method: 'POST', body: { personalizationEnabled: false, resetHistory: true } }); assert.equal(await ReelSignal.countDocuments({}), 0);
  });
  await t.test('following/saved/report filters and author verification apply to current data', async () => {
    assert.equal((await request('/feed?mode=following')).data.items.length, 0);
    await request(`/doctors/${ids.author}/follow`, { method: 'POST', body: { active: true } }); assert.equal((await request('/feed?mode=following')).data.items.length, 1);
    await request(`/${reel.id}/reactions`, { method: 'POST', body: { kind: 'save', active: true } }); assert.equal((await request('/feed?saved=true')).data.items.length, 1);
    await Doctor.updateOne({ _id: ids.author }, { $set: { 'credentialVerification.status': 'rejected' } }); assert.equal((await request('/feed')).data.items.length, 0);
    await Doctor.updateOne({ _id: ids.author }, { $set: { 'credentialVerification.status': 'verified' } });
    await request(`/${reel.id}/report`, { method: 'POST', body: { reason: 'patient_privacy', details: 'Synthetic test report' } }); assert.equal((await request('/feed')).data.items.length, 0);
    assert.equal((await request('/reports', { role: 'author' })).status, 200); // Explicit configured reviewer, not ordinary author privilege.
    assert.equal((await request('/reports', { role: 'otherDoctor' })).status, 403);
  });
  await t.test('published edits revoke public access and require a new processed version/review', async () => {
    const edited = await request(`/${reel.id}`, { role: 'author', method: 'PATCH', body: { ...metadata(), version: reel.version } }); assert.equal(edited.status, 200); assert.equal(edited.data.reel.status, 'draft');
    assert.equal((await request(reel.playbackUrl.replace('/api/reels', ''))).status, 404); assert.ok(await ReelAudit.countDocuments({ reelId: reel.id }) >= 4);
    await AuthSession.updateOne({ _id: author().sid }, { $set: { revokedAt: new Date() } }); assert.equal((await request('/mine', { role: 'author' })).status, 401);
  });
});

test('worker/upload leases, retry recovery and cursor tampering use actual persistence', async t => {
  const auth = { id: String(ids.otherDoctor), role: 'doctor' };
  const fixture = async () => {
    const reel = await create('otherDoctor');
    await Reel.updateOne({ _id: reel.id }, { $set: { mediaStatus: 'queued', sourcePath: path.join(root, 'source.mp4') } });
    const job = await OutboxJob.create({ _id: crypto.randomUUID(), kind: 'reels.process', state: 'processing', payload: { reelId: reel.id, version: 0 }, leaseToken: crypto.randomUUID(), leaseUntil: new Date(Date.now() + 60000) });
    return { reel, job };
  };
  await t.test('expired workers do not start or alter media state', async () => {
    const { reel, job } = await fixture(); await OutboxJob.updateOne({ _id: job._id }, { $set: { leaseUntil: new Date(0) } });
    assert.equal((await processReelJob(job, fixtureAdapters)).skipped, true); assert.equal((await Reel.findById(reel.id)).mediaStatus, 'queued');
  });
  await t.test('reclaimed success/failure paths cannot overwrite a successor', async () => {
    for (const fail of [false, true]) {
      const { reel, job } = await fixture(), successor = crypto.randomUUID();
      const dependencies = { ...fixtureAdapters, transcode: async (...args) => {
        const result = await fixtureAdapters.transcode(...args);
        await OutboxJob.updateOne({ _id: job._id }, { $set: { leaseToken: 'new-worker' } });
        await Reel.updateOne({ _id: reel.id }, { $set: { mediaStatus: 'ready', mediaJobId: successor } });
        if (fail) throw new Error('Synthetic stale failure'); return result;
      } };
      if (fail) await assert.rejects(processReelJob(job, dependencies), /processing failed/); else assert.equal((await processReelJob(job, dependencies)).skipped, true);
      const current = await Reel.findById(reel.id); assert.equal(current.mediaStatus, 'ready'); assert.equal(current.mediaJobId, successor);
    }
  });
  await t.test('a committed output replays without another model or transcode call', async () => {
    const { reel, job } = await fixture();
    assert.equal((await processReelJob(job, fixtureAdapters)).processed, true);
    const replay = await processReelJob(job, { embed: () => { throw new Error('Must not re-embed'); } });
    assert.equal(replay.replay, true); assert.equal((await Reel.findById(reel.id)).mediaStatus, 'ready');
  });
  await t.test('expired upload attempt cannot finalize a reclaimed upload with the same command key', async () => {
    const reel = await create('otherDoctor'), key = crypto.randomUUID();
    await Reel.updateOne({ _id: reel.id }, { $set: { mediaStatus: 'uploading', uploadKey: key, uploadToken: 'successor' } });
    await assert.rejects(finalizeUpload(auth, { _id: reel.id }, { path: 'stale', sha256: 'stale' }, key, 'old-attempt'), error => error.status === 409);
    const current = await Reel.findById(reel.id); assert.equal(current.mediaStatus, 'uploading'); assert.equal(current.uploadToken, 'successor');
  });
  await t.test('invalid feed cursors never become trusted snapshot queries', async () => {
    assert.equal((await request('/feed?cursor=forged.invalid')).status, 400);
    assert.equal((await request('/feed?cursor=' + encodeURIComponent('a.' + 'é'.repeat(43)))).status, 400);
    assert.equal((await request('/preferences', { method: 'POST', body: [] })).status, 400);
  });
});
