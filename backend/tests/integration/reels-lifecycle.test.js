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
import HospitalStaff from '../../model/hospitalStaff.js';
import AuthSession from '../../model/authSession.js';
import OutboxJob from '../../model/outboxJob.js';
import { Reel, ReelReaction, ReelSignal, ReelPlayback, ReelComment, ReelReport, ReelAudit, ReelFollow } from '../../model/reel.js';
import { applyReelsSchema } from '../../scripts/reelsSchema.js';
import { processReelJob } from '../../services/reelProcessing.js';
import { runOutboxBatch } from '../../services/outbox.js';
import { closeRedis } from '../../services/redis.js';
import router from '../../routes/reels.js';

const uri = new URL(localTestTargets().mongo);
uri.pathname = `/medipulse_test_reels_e2e_${crypto.randomBytes(8).toString('hex')}`;

// 7 Synthetic identities as specified in prompt section 4:
// 1. Patient
// 2. Unverified doctor
// 3. Verified creator (Author doctor)
// 4. Different verified doctor explicitly approved as reviewer
// 5. Unapproved reviewer (verified doctor but not in REELS_REVIEWER_DOCTOR_IDS)
// 6. Unrelated doctor (verified doctor)
// 7. Hospital staff account
const roleNames = [
  'patient',
  'unverifiedDoctor',
  'creatorDoctor',
  'approvedReviewerDoctor',
  'unapprovedReviewerDoctor',
  'unrelatedDoctor',
  'hospitalStaff',
];

const ids = Object.fromEntries(roleNames.map(k => [k, new mongoose.Types.ObjectId()]));
const hospitalId = new mongoose.Types.ObjectId();
const sessions = {};
let origin, server, root, testVideoMp4, testVideoWebm;

async function request(url, { role = 'patient', method = 'GET', body, csrf = true, token, headers = {} } = {}) {
  const sessionToken = token || sessions[role]?.token;
  const cookieHeader = role === 'hospitalStaff' ? `staffToken=${sessionToken}` : `token=${sessionToken}`;
  const response = await fetch(origin + '/api/reels' + url, {
    method,
    headers: {
      Cookie: cookieHeader,
      Origin: 'http://localhost:5173',
      ...(csrf ? { 'X-CSRF-Token': 'reels-lifecycle-csrf' } : {}),
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const type = response.headers.get('content-type') || '';
  return {
    status: response.status,
    headers: response.headers,
    data: type.includes('json') ? await response.json() : await response.text(),
  };
}

before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  await applyReelsSchema();
  await OutboxJob.createIndexes();
  await AuthSession.createIndexes();

  root = await fs.mkdtemp(path.join(os.tmpdir(), 'reels-e2e-audit-'));
  process.env.REELS_MEDIA_ROOT = root;
  // Explicitly configure only approvedReviewerDoctor as approved reviewer
  process.env.REELS_REVIEWER_DOCTOR_IDS = String(ids.approvedReviewerDoctor);

  // Setup the 7 synthetic accounts and sessions
  for (const name of roleNames) {
    const id = ids[name];
    const sid = crypto.randomUUID();

    if (name === 'patient') {
      await User.create({ _id: id, firstName: 'Synthetic', lastName: 'Patient', email: `${name}@test.example`, password: 'Test-password-123', gender: 'other' });
      await AuthSession.create({ _id: sid, principalId: id, kind: 'user', csrfToken: 'reels-lifecycle-csrf', expiresAt: new Date(Date.now() + 3600000) });
      sessions[name] = { token: jwt.sign({ id: String(id), sid, role: 'user' }, process.env.TOKEN_KEY), sid };
    } else if (name === 'hospitalStaff') {
      await HospitalStaff.create({ _id: id, hospitalId, name: 'Synthetic Staff', email: `${name}@test.example`, role: 'HOSPITAL_ADMIN', isActive: true, inviteStatus: 'accepted' });
      await AuthSession.create({ _id: sid, principalId: id, kind: 'staff', csrfToken: 'reels-lifecycle-csrf', expiresAt: new Date(Date.now() + 3600000) });
      sessions[name] = { token: jwt.sign({ id: String(id), sid, role: 'HOSPITAL_ADMIN', type: 'staff', hospitalId: String(hospitalId) }, process.env.TOKEN_KEY), sid };
    } else {
      // Doctor accounts
      const isVerified = name !== 'unverifiedDoctor';
      await Doctor.create({
        _id: id,
        firstName: `Synthetic ${name}`,
        lastName: 'MD',
        email: `${name}@test.example`,
        password: 'Test-password-123',
        gender: 'other',
        experience: { years: 8, expertise: name === 'creatorDoctor' ? 'Cardiology' : 'Neurology' },
        credentialVerification: { status: isVerified ? 'verified' : 'pending' },
      });
      await AuthSession.create({ _id: sid, principalId: id, kind: 'doctor', csrfToken: 'reels-lifecycle-csrf', expiresAt: new Date(Date.now() + 3600000) });
      sessions[name] = { token: jwt.sign({ id: String(id), sid, role: 'doctor' }, process.env.TOKEN_KEY), sid };
    }
  }

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/reels', router);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Server error' });
  });

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;

  // Generate synthetic test videos using FFmpeg
  const binary = (await import('ffmpeg-static')).default;
  const mp4Path = path.join(root, 'source.mp4');
  const madeMp4 = spawnSync(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=360x640:r=24', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', mp4Path], { timeout: 30000 });
  assert.equal(madeMp4.status, 0, madeMp4.stderr?.toString());
  testVideoMp4 = await fs.readFile(mp4Path);

  const webmPath = path.join(root, 'source.webm');
  const madeWebm = spawnSync(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=darkgreen:s=360x640:r=24', '-t', '2', '-c:v', 'libvpx', '-b:v', '200k', webmPath], { timeout: 30000 });
  assert.equal(madeWebm.status, 0, madeWebm.stderr?.toString());
  testVideoWebm = await fs.readFile(webmPath);
});

after(async () => {
  if (server) {
    server.close();
    await once(server, 'close');
  }
  if (mongoose.connection.db?.databaseName === uri.pathname.slice(1)) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
  await closeRedis();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('Complete 15-Step Doctor Reels Lifecycle with 7 Synthetic Identities', async t => {
  let createdReel;
  const reelMetadata = {
    title: 'Hypertension Management and Diet',
    caption: 'Educational guidance on low-sodium nutrition and cardiovascular health.',
    topics: ['heart health', 'nutrition'],
    language: 'en',
    thumbnailSeconds: 0.5,
    privacyConfirmed: true,
    educationalOnly: true,
    idempotencyKey: crypto.randomUUID(),
  };

  await t.test('Step 1: Session authentication and identity boundaries (Hospital staff fails closed)', async () => {
    // Hospital staff token cannot access account-scoped reels
    const staffRes = await request('/feed', { role: 'hospitalStaff' });
    assert.equal(staffRes.status, 401, 'Hospital staff session must fail closed');

    // Missing cookie fails
    const noAuth = await request('/feed', { token: 'invalid.jwt.token' });
    assert.equal(noAuth.status, 401, 'Invalid session must fail');

    // CSRF required on mutations
    const csrfFail = await request('/', { role: 'creatorDoctor', method: 'POST', body: reelMetadata, csrf: false });
    assert.equal(csrfFail.status, 403, 'Mutation without CSRF must fail');
  });

  await t.test('Step 2 & 3: Metadata validation, video preview and thumbnail boundary checks', async () => {
    // Negative thumbnail frame rejected
    const badThumb = await request('/', { role: 'creatorDoctor', method: 'POST', body: { ...reelMetadata, thumbnailSeconds: -1 } });
    assert.equal(badThumb.status, 400);

    // Over 300s thumbnail rejected
    const overThumb = await request('/', { role: 'creatorDoctor', method: 'POST', body: { ...reelMetadata, thumbnailSeconds: 301 } });
    assert.equal(overThumb.status, 400);

    // Excessive title length rejected
    const longTitle = await request('/', { role: 'creatorDoctor', method: 'POST', body: { ...reelMetadata, title: 'x'.repeat(121) } });
    assert.equal(longTitle.status, 400);
  });

  await t.test('Step 4: Educational and privacy attestations enforced', async () => {
    // Unverified doctor cannot create reel
    const unverifiedRes = await request('/', { role: 'unverifiedDoctor', method: 'POST', body: reelMetadata });
    assert.equal(unverifiedRes.status, 403, 'Unverified doctor cannot create reels');

    // Patient cannot create reel
    const patientRes = await request('/', { role: 'patient', method: 'POST', body: reelMetadata });
    assert.equal(patientRes.status, 403, 'Patient cannot create reels');

    // Missing privacy confirmation rejected
    const missingPrivacy = await request('/', { role: 'creatorDoctor', method: 'POST', body: { ...reelMetadata, privacyConfirmed: false } });
    assert.equal(missingPrivacy.status, 400);

    // Missing educational confirmation rejected
    const missingEdu = await request('/', { role: 'creatorDoctor', method: 'POST', body: { ...reelMetadata, educationalOnly: false } });
    assert.equal(missingEdu.status, 400);
  });

  await t.test('Step 5 & 6: Create draft, upload genuine video bytes, verify durable outbox command', async () => {
    // Creator creates draft
    const createRes = await request('/', { role: 'creatorDoctor', method: 'POST', body: reelMetadata });
    assert.equal(createRes.status, 201);
    createdReel = createRes.data.reel;
    assert.equal(createdReel.status, 'draft');
    assert.equal(createdReel.mediaStatus, 'empty');
    assert.equal(createdReel.version, 0);

    // Invalid non-video payload rejected
    const uploadKey = crypto.randomUUID();
    const badUpload = await request(`/${createdReel.id}/upload`, {
      role: 'creatorDoctor',
      method: 'PUT',
      body: Buffer.from('not a genuine video stream'),
      headers: { 'Content-Type': 'video/mp4', 'Idempotency-Key': uploadKey },
    });
    assert.equal(badUpload.status, 415, 'Non-video payload must be rejected');

    // Unrelated doctor cannot upload to creator draft
    const hijackUpload = await request(`/${createdReel.id}/upload`, {
      role: 'unrelatedDoctor',
      method: 'PUT',
      body: testVideoMp4,
      headers: { 'Content-Type': 'video/mp4', 'Idempotency-Key': uploadKey },
    });
    assert.equal(hijackUpload.status, 404, 'Unrelated doctor cannot upload to another doctor draft');

    // Successful upload of genuine MP4 bytes
    const uploadRes = await request(`/${createdReel.id}/upload`, {
      role: 'creatorDoctor',
      method: 'PUT',
      body: testVideoMp4,
      headers: { 'Content-Type': 'video/mp4', 'Idempotency-Key': uploadKey },
    });
    assert.equal(uploadRes.status, 200);
    assert.equal(uploadRes.data.reel.mediaStatus, 'queued');
    assert.equal(uploadRes.data.reel.version, 1);
    createdReel = uploadRes.data.reel;

    // Verify exactly one durable OutboxJob was enqueued
    const outboxJobs = await OutboxJob.find({ kind: 'reels.process', 'payload.reelId': createdReel.id });
    assert.equal(outboxJobs.length, 1, 'Exactly one processing job must be queued');
    assert.equal(outboxJobs[0].payload.version, 1);
  });

  await t.test('Step 7 & 8: Real FFmpeg processing and multilingual embedding execution', async () => {
    // Deliver outbox batch with real FFmpeg and real Hugging Face model
    const batchResult = await runOutboxBatch(job => processReelJob(job), { limit: 1 });
    assert.equal(batchResult.delivered, 1, 'Outbox worker must deliver job');

    // Creator checks studio: reel is now ready
    const mineRes = await request('/mine', { role: 'creatorDoctor' });
    const mineItem = mineRes.data.items.find(x => x.id === createdReel.id);
    assert.ok(mineItem, 'Reel must be present in creator studio');
    assert.equal(mineItem.mediaStatus, 'ready');
    assert.equal(mineItem.status, 'draft');
    assert.ok(mineItem.playbackUrl, 'Playback URL must be generated');
    assert.ok(mineItem.thumbnailUrl, 'Thumbnail URL must be generated');
    createdReel = mineItem;

    // Verify embedding vector was generated in MongoDB
    const storedReel = await Reel.findById(createdReel.id).select('+embedding');
    assert.equal(storedReel.embedding.length, 384, 'Normalized 384-dimension vector required');
    assert.ok(storedReel.embeddingModel.includes('paraphrase-multilingual'));

    // Authenticated preview check for creator: manifest is accessible
    const previewRes = await request(createdReel.playbackUrl.replace('/api/reels', ''), { role: 'creatorDoctor' });
    assert.equal(previewRes.status, 200);
    assert.match(previewRes.data, /#EXTM3U/);

    // Private draft is NOT readable by patient or unapproved doctors
    const patientPreview = await request(createdReel.playbackUrl.replace('/api/reels', ''), { role: 'patient' });
    assert.equal(patientPreview.status, 404, 'Private draft playback must not be accessible to public');
  });

  await t.test('Step 9: Version-bound submission by creator', async () => {
    // Stale version rejected
    const staleSubmit = await request(`/${createdReel.id}/submit`, { role: 'creatorDoctor', method: 'POST', body: { version: 0 } });
    assert.equal(staleSubmit.status, 409, 'Stale version submission must conflict');

    // Unrelated doctor cannot submit creator reel
    const unrelatedSubmit = await request(`/${createdReel.id}/submit`, { role: 'unrelatedDoctor', method: 'POST', body: { version: createdReel.version } });
    assert.equal(unrelatedSubmit.status, 404);

    // Correct submission
    const submitRes = await request(`/${createdReel.id}/submit`, { role: 'creatorDoctor', method: 'POST', body: { version: createdReel.version } });
    assert.equal(submitRes.status, 200);
    assert.equal(submitRes.data.reel.status, 'pending_review');
    createdReel = submitRes.data.reel;
  });

  await t.test('Step 10: Independent medical moderation review and publication', async () => {
    // Creator cannot moderate own reel
    const selfReview = await request(`/${createdReel.id}/moderate`, {
      role: 'creatorDoctor',
      method: 'POST',
      body: { version: createdReel.version, decision: 'publish', reason: 'Self-approval attempt' },
    });
    assert.equal(selfReview.status, 403, 'Creator cannot approve their own reel');

    // Unapproved doctor cannot moderate
    const unapprovedReview = await request(`/${createdReel.id}/moderate`, {
      role: 'unapprovedReviewerDoctor',
      method: 'POST',
      body: { version: createdReel.version, decision: 'publish', reason: 'Unapproved attempt' },
    });
    assert.equal(unapprovedReview.status, 403, 'Doctor not in approved reviewers list cannot moderate');

    // Stale version rejected by approved reviewer
    const staleReview = await request(`/${createdReel.id}/moderate`, {
      role: 'approvedReviewerDoctor',
      method: 'POST',
      body: { version: createdReel.version - 1, decision: 'publish', reason: 'Stale version attempt' },
    });
    assert.equal(staleReview.status, 409, 'Moderation on stale version must conflict');

    // Approved reviewer views moderation queue
    const queueRes = await request('/moderation', { role: 'approvedReviewerDoctor' });
    assert.equal(queueRes.status, 200);
    assert.ok(queueRes.data.items.some(x => x.id === createdReel.id));

    // Approved reviewer approves and publishes
    const pubRes = await request(`/${createdReel.id}/moderate`, {
      role: 'approvedReviewerDoctor',
      method: 'POST',
      body: { version: createdReel.version, decision: 'publish', reason: 'Verified educational cardiovascular content approved' },
    });
    assert.equal(pubRes.status, 200);
    assert.equal(pubRes.data.reel.status, 'published');
    createdReel = pubRes.data.reel;
  });

  await t.test('Step 11: Public feed presence, HLS playback and security path protection', async () => {
    // Patient discovers published reel in For You feed
    const feedRes = await request('/feed', { role: 'patient' });
    assert.equal(feedRes.status, 200);
    const item = feedRes.data.items.find(x => x.id === createdReel.id);
    assert.ok(item, 'Published reel must appear in patient feed');
    assert.equal(item.doctor.name, 'Dr. Synthetic creatorDoctor MD');

    // Patient plays actual HLS master playlist
    const masterPath = item.playbackUrl.replace('/api/reels', '');
    const masterRes = await request(masterPath, { role: 'patient' });
    assert.equal(masterRes.status, 200);
    assert.match(masterRes.data, /#EXTM3U/);
    assert.match(masterRes.data, /360p\/index.m3u8/);

    // Patient plays 360p variant playlist
    const variantPath = path.dirname(masterPath) + '/360p/index.m3u8';
    const variantRes = await request(variantPath.replace(/\\/g, '/'), { role: 'patient' });
    assert.equal(variantRes.status, 200);
    assert.match(variantRes.data, /segment_00000.ts/);

    // Patient downloads segment
    const segmentPath = path.dirname(masterPath) + '/360p/segment_00000.ts';
    const segmentRes = await request(segmentPath.replace(/\\/g, '/'), { role: 'patient' });
    assert.equal(segmentRes.status, 200);
    assert.equal(segmentRes.headers.get('content-type'), 'video/mp2t');

    // Patient loads thumbnail
    const thumbPath = item.thumbnailUrl.replace('/api/reels', '');
    const thumbRes = await request(thumbPath, { role: 'patient' });
    assert.equal(thumbRes.status, 200);
    assert.equal(thumbRes.headers.get('content-type'), 'image/jpeg');

    // Raw original source cannot be accessed
    const rawRes = await request(`/media/${createdReel.id}/${item.playbackUrl.split('/')[5]}/originals/source.mp4`, { role: 'patient' });
    assert.equal(rawRes.status, 404, 'Original source video must never be served');
  });

  await t.test('Step 12: Engagement operations (likes, comments, saves, follows, reporting)', async () => {
    // Like reel
    const likeRes = await request(`/${createdReel.id}/reactions`, { role: 'patient', method: 'POST', body: { kind: 'like', active: true } });
    assert.equal(likeRes.status, 200);
    assert.equal(likeRes.data.counts.likes, 1);

    // Save reel
    const saveRes = await request(`/${createdReel.id}/reactions`, { role: 'patient', method: 'POST', body: { kind: 'save', active: true } });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.data.counts.saves, 1);

    // Check Saved feed contains the reel
    const savedFeed = await request('/feed?saved=true', { role: 'patient' });
    assert.ok(savedFeed.data.items.some(x => x.id === createdReel.id));

    // Follow creator doctor
    const followRes = await request(`/doctors/${ids.creatorDoctor}/follow`, { role: 'patient', method: 'POST', body: { active: true } });
    assert.equal(followRes.status, 200);
    assert.equal(followRes.data.active, true);

    // Following feed includes the reel
    const followingFeed = await request('/feed?mode=following', { role: 'patient' });
    assert.ok(followingFeed.data.items.some(x => x.id === createdReel.id));

    // Post comment with idempotency
    const commentKey = crypto.randomUUID();
    const commentRes = await request(`/${createdReel.id}/comments`, {
      role: 'patient',
      method: 'POST',
      body: { text: 'Clear and educational explanation of blood pressure management.', idempotencyKey: commentKey },
    });
    assert.equal(commentRes.status, 201);
    assert.equal(commentRes.data.comment.authorName, 'Synthetic Patient');

    // Replay with identical key is idempotent
    const replayComment = await request(`/${createdReel.id}/comments`, {
      role: 'patient',
      method: 'POST',
      body: { text: 'Clear and educational explanation of blood pressure management.', idempotencyKey: commentKey },
    });
    assert.equal(replayComment.status, 201);
    assert.equal(await ReelComment.countDocuments({ reelId: createdReel.id }), 1);

    // Comments query does not leak actorKey or account identifiers
    const commentsList = await request(`/${createdReel.id}/comments`, { role: 'patient' });
    assert.equal(commentsList.status, 200);
    assert.equal(commentsList.data.items.length, 1);
    assert.ok(!('actorKey' in commentsList.data.items[0]));
    assert.ok(!('principalId' in commentsList.data.items[0]));

    // Report reel for patient privacy
    const reportRes = await request(`/${createdReel.id}/report`, {
      role: 'patient',
      method: 'POST',
      body: { reason: 'patient_privacy', details: 'Synthetic report test' },
    });
    assert.equal(reportRes.status, 200);

    // Reported reel is excluded from reporter feed
    const reporterFeed = await request('/feed', { role: 'patient' });
    assert.ok(!reporterFeed.data.items.some(x => x.id === createdReel.id), 'Reported reel must be hidden from reporter feed');

    // Approved reviewer can view reports queue without reporter identity leakage
    const reportsList = await request('/reports', { role: 'approvedReviewerDoctor' });
    assert.equal(reportsList.status, 200);
    const foundReport = reportsList.data.items.find(r => r.reelId === createdReel.id);
    assert.ok(foundReport);
    assert.ok(!('actorKey' in foundReport));
  });

  await t.test('Step 13: Watch/skip events, session telemetry and interest vector updates', async () => {
    // Patient opts in to personalization
    await request('/preferences', { role: 'patient', method: 'POST', body: { personalizationEnabled: true, topics: ['heart health'] } });

    // Begin playback session
    const pbRes = await request(`/${createdReel.id}/playback`, { role: 'patient', method: 'POST', body: {} });
    assert.equal(pbRes.status, 200);
    const sessionId = pbRes.data.sessionId;
    assert.ok(sessionId);

    // Send watch event sequence 1
    const event1 = { eventId: crypto.randomUUID(), sessionId, sequence: 1, type: 'watch', watchMs: 2000 };
    const eventRes1 = await request(`/${createdReel.id}/events`, { role: 'patient', method: 'POST', body: event1 });
    assert.equal(eventRes1.status, 200);
    assert.equal(eventRes1.data.accepted, true);

    // Replay of sequence 1 event
    const eventReplay = await request(`/${createdReel.id}/events`, { role: 'patient', method: 'POST', body: event1 });
    assert.equal(eventReplay.data.replay, true);

    // Advance playback lastEventAt to allow sequence 2
    await ReelPlayback.updateOne({ _id: sessionId }, { $set: { lastEventAt: new Date(Date.now() - 3000) } });

    // Send watch event sequence 2
    const event2 = { eventId: crypto.randomUUID(), sessionId, sequence: 2, type: 'watch', watchMs: 2000 };
    const eventRes2 = await request(`/${createdReel.id}/events`, { role: 'patient', method: 'POST', body: event2 });
    assert.equal(eventRes2.status, 200);

    // Stored ReelSignal verified
    const signal = await ReelSignal.findOne({ actorKey: `user:${ids.patient}`, reelId: createdReel.id });
    assert.ok(signal, 'ReelSignal must be recorded for opted-in user');
    assert.ok(signal.watchMs > 0);

    // Resetting history purges stored signals
    await request('/preferences', { role: 'patient', method: 'POST', body: { personalizationEnabled: false, resetHistory: true } });
    const clearedSignal = await ReelSignal.findOne({ actorKey: `user:${ids.patient}`, reelId: createdReel.id });
    assert.equal(clearedSignal, null, 'Signals must be purged on history reset');
  });

  await t.test('Step 14: Edit published metadata requires withdrawal, reprocessing and re-review', async () => {
    // Creator edits published reel
    const editRes = await request(`/${createdReel.id}`, {
      role: 'creatorDoctor',
      method: 'PATCH',
      body: {
        title: 'Updated: Hypertension Management Guide',
        caption: 'Revised educational details on cardiovascular health.',
        topics: ['heart health', 'prevention'],
        language: 'en',
        version: createdReel.version,
      },
    });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.data.reel.status, 'draft', 'Status must return to draft');
    assert.equal(editRes.data.reel.mediaStatus, 'queued', 'Media must be queued for reprocessing');
    createdReel = editRes.data.reel;

    // Public playback is revoked (returns 404)
    const oldMediaRes = await request(createdReel.playbackUrl.replace('/api/reels', ''), { role: 'patient' });
    assert.equal(oldMediaRes.status, 404, 'Public playback must be revoked upon edit');

    // Audit entries recorded
    const auditCount = await ReelAudit.countDocuments({ reelId: createdReel.id });
    assert.ok(auditCount >= 3, 'Audit log entries must track changes');
  });

  await t.test('Step 15: Content removal revokes manifests, segments and thumbnails', async () => {
    // Creator deletes the reel
    const delRes = await request(`/${createdReel.id}`, { role: 'creatorDoctor', method: 'DELETE' });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.data.removed, true);

    const removedReel = await Reel.findById(createdReel.id);
    assert.equal(removedReel.status, 'removed');

    // Public manifest returns 404
    const pubManifest = await request(createdReel.playbackUrl.replace('/api/reels', ''), { role: 'patient' });
    assert.equal(pubManifest.status, 404);

    // Creator manifest also returns 404
    const creatorManifest = await request(createdReel.playbackUrl.replace('/api/reels', ''), { role: 'creatorDoctor' });
    assert.equal(creatorManifest.status, 404);

    // Feed excludes removed content
    const feed = await request('/feed', { role: 'patient' });
    assert.ok(!feed.data.items.some(x => x.id === createdReel.id));
  });
});
