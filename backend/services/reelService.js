import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Doctor from '../model/doctor.js';
import OutboxJob from '../model/outboxJob.js';
import { Reel, ReelReaction, ReelFollow, ReelComment, ReelSignal, ReelPlayback, ReelEvent, ReelPreference, ReelReport, ReelAudit, ReelRate, ReelDaily, reelsModels } from '../model/reel.js';
import { moneyTransaction } from './moneyTransaction.js';
import { enqueueJob } from './outbox.js';
import { getRedis } from './redis.js';
import { interestVector, rankReels, RANKING_VERSION } from './reelRanking.js';
export const reelError = (status, message) => Object.assign(new Error(message), { status });
export function reelId(value) { if (!/^[a-f\d]{24}$/i.test(String(value))) throw reelError(400, 'Invalid reel or doctor identifier'); return new mongoose.Types.ObjectId(value); }
export const actorKey = auth => `${auth.role}:${auth.id}`;
export function commandKey(value) { if (typeof value !== 'string' || !/^[\w-]{8,80}$/.test(value)) throw reelError(400, 'A stable command identifier is required'); return value; }
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function text(value, max, name, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b-\u001f]/.test(value)) throw reelError(400, `Invalid ${name}`);
  const result = value.trim(); if (required && !result) throw reelError(400, `${name} is required`); return result;
}
export function metadata(body) {
  if (!Array.isArray(body.topics) || body.topics.length > 8) throw reelError(400, 'Choose up to eight topics');
  const topics = [...new Set(body.topics.map(x => text(x, 40, 'topic', true).toLowerCase()))];
  const language = text(body.language || 'en', 20, 'language', true);
  if (!/^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(language)) throw reelError(400, 'Invalid language code');
  return { title: text(body.title, 120, 'title', true), caption: text(body.caption ?? '', 2000, 'caption'), topics, language };
}
export const featureEnabled = () => process.env.REELS_ENABLED === 'true' || process.env.NODE_ENV === 'test';
const schemaReady = new WeakMap();
export async function assertReelsReady() {
  if (!featureEnabled()) throw reelError(503, 'Doctor Reels is not enabled');
  if (mongoose.connection.readyState !== 1) throw reelError(503, 'Reels database is unavailable');
  if ((schemaReady.get(mongoose.connection.db) || 0) > Date.now()) return;
  // Read-only: no index synchronization or schema creation during startup/requests.
  for (const model of reelsModels) {
    let indexes; try { indexes = await model.collection.indexes(); } catch { throw reelError(503, 'Reels schema migration is required'); }
    for (const [keys, options] of model.schema.indexes()) {
      const index = indexes.find(i => i.name === options.name);
      if (!index || JSON.stringify(index.key) !== JSON.stringify(keys) || Boolean(index.unique) !== Boolean(options.unique)
        || (options.expireAfterSeconds !== undefined && index.expireAfterSeconds !== options.expireAfterSeconds)) throw reelError(503, 'Reels schema migration is required');
    }
  }
  schemaReady.set(mongoose.connection.db, Date.now() + 15000);
}
export async function rateLimit(auth, action, max = 120, windowMs = 60000) {
  const now = Date.now(), key = `${actorKey(auth)}:${action}:${Math.floor(now / windowMs)}`;
  let record; try { record = await ReelRate.findOneAndUpdate({ _id: key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now + windowMs * 2) } }, { upsert: true, new: true }); }
  catch (error) { if (error.code !== 11000) throw error; record = await ReelRate.findOneAndUpdate({ _id: key }, { $inc: { count: 1 } }, { new: true }); }
  if (!record || record.count > max) throw reelError(429, 'Please wait before trying this Reels action again');
}
export async function verifiedDoctor(auth, session) {
  if (auth.role !== 'doctor') throw reelError(403, 'A verified doctor account is required');
  const doctor = await Doctor.findOne({ _id: auth.id, 'credentialVerification.status': 'verified' }).session(session || null);
  if (!doctor) throw reelError(403, 'Doctor credential verification is required');
  return doctor;
}
export async function isReviewer(auth, session) {
  return auth.role === 'doctor' && (process.env.REELS_REVIEWER_DOCTOR_IDS || '').split(',').map(x => x.trim()).includes(auth.id)
    && Boolean(await Doctor.exists({ _id: auth.id, 'credentialVerification.status': 'verified' }).session(session || null));
}
export async function canReadReel(auth, reel) {
  if (!reel || reel.status === 'removed') throw reelError(404, 'Reel not found');
  if (reel.status === 'published' && await Doctor.exists({ _id: reel.doctorId, 'credentialVerification.status': 'verified' })) return reel;
  if (auth.role === 'doctor' && String(reel.doctorId) === auth.id || await isReviewer(auth)) return reel;
  throw reelError(404, 'Reel not found');
}
export async function ownedReel(auth, id, session) {
  await verifiedDoctor(auth, session);
  const reel = await Reel.findOne({ _id: reelId(id), doctorId: auth.id, status: { $ne: 'removed' } }).session(session || null);
  if (!reel) throw reelError(404, 'Reel not found'); return reel;
}
export async function requirePublished(id, session) {
  const reel = await Reel.findOne({ _id: reelId(id), status: 'published', mediaStatus: 'ready' }).session(session || null);
  if (!reel || !await Doctor.exists({ _id: reel.doctorId, 'credentialVerification.status': 'verified' }).session(session || null)) throw reelError(404, 'Reel not found'); return reel;
}
export async function audit(reel, auth, action, reason = '', session) {
  await ReelAudit.create([{ reelId: reel._id, actorKey: actorKey(auth), action, version: reel.version, reason }], { session });
}
export async function serializeReels(rows, auth) {
  const ids = rows.map(r => r._id), doctors = [...new Set(rows.map(r => String(r.doctorId)))];
  const [authors, reactions, follows] = await Promise.all([
    Doctor.find({ _id: { $in: doctors } }).select('firstName lastName profilePhoto experience.expertise').lean(),
    ReelReaction.find({ actorKey: actorKey(auth), reelId: { $in: ids } }).lean(),
    ReelFollow.find({ actorKey: actorKey(auth), doctorId: { $in: doctors } }).lean(),
  ]);
  const byId = new Map(authors.map(d => [String(d._id), d]));
  return rows.map(r => {
    const author = byId.get(String(r.doctorId)), root = r.mediaJobId ? `/api/reels/media/${r._id}/${r.mediaJobId}` : null;
    return { id: String(r._id), doctor: { id: String(r.doctorId), name: `Dr. ${[author?.firstName, author?.lastName].filter(Boolean).join(' ').replace(/^(?:Dr\.?\s*)+/i, '')}`, photo: author?.profilePhoto || '', specialty: author?.experience?.expertise || '' },
      title: r.title, caption: r.caption, topics: r.topics, language: r.language, duration: r.duration || 0,
      counts: r.counts, liked: reactions.some(x => String(x.reelId) === String(r._id) && x.kind === 'like'),
      saved: reactions.some(x => String(x.reelId) === String(r._id) && x.kind === 'save'), following: follows.some(x => String(x.doctorId) === String(r.doctorId)),
      playbackUrl: root ? `${root}/master.m3u8` : null, thumbnailUrl: root ? `${root}/thumbnail.jpg` : null,
      status: r.status, mediaStatus: r.mediaStatus, version: r.version, thumbnailSeconds: r.thumbnailSeconds,
      processingError: r.processingError || null, moderationReason: r.moderationReason || null };
  });
}
export async function createReel(auth, body) {
  await verifiedDoctor(auth); const fields = metadata(body), key = commandKey(body.idempotencyKey);
  if (body.privacyConfirmed !== true || body.educationalOnly !== true) throw reelError(400, 'Confirm educational content and consent: no identifiable patient information');
  const thumbnailSeconds = Number(body.thumbnailSeconds ?? 0);
  if (!Number.isFinite(thumbnailSeconds) || thumbnailSeconds < 0 || thumbnailSeconds > 300) throw reelError(400, 'Invalid thumbnail time');
  const fingerprint = hash({ ...fields, thumbnailSeconds });
  return moneyTransaction(async session => {
    const existing = await Reel.findOne({ doctorId: auth.id, creationKey: key }).session(session);
    if (existing) { if (existing.creationFingerprint !== fingerprint) throw reelError(409, 'Creation key was used for different metadata'); return existing; }
    const [reel] = await Reel.create([{ ...fields, thumbnailSeconds, doctorId: auth.id, creationKey: key, creationFingerprint: fingerprint, privacyConfirmed: true, educationalOnly: true }], { session });
    await audit(reel, auth, 'created', '', session); return reel;
  });
}
export async function editReel(auth, id, body) {
  const fields = metadata(body), version = body.version;
  if (!Number.isSafeInteger(version) || version < 0) throw reelError(400, 'Current reel version is required');
  const thumbnailSeconds = Number(body.thumbnailSeconds ?? 0);
  if (!Number.isFinite(thumbnailSeconds) || thumbnailSeconds < 0 || thumbnailSeconds > 300) throw reelError(400, 'Invalid thumbnail time');
  return moneyTransaction(async session => {
    const reel = await ownedReel(auth, id, session);
    if (reel.version !== version || ['processing', 'uploading'].includes(reel.mediaStatus)) throw reelError(409, 'Reel changed or is processing; refresh before editing');
    Object.assign(reel, fields, { thumbnailSeconds, version: version + 1, status: 'draft', reviewedBy: null, publishedAt: null, moderationReason: '' });
    if (reel.mediaStatus === 'ready') reel.mediaStatus = 'queued';
    await reel.save({ session });
    if (reel.mediaStatus === 'queued') await enqueueJob({ id: `reel:${reel._id}:${reel.version}`, kind: 'reels.process', payload: { reelId: String(reel._id), version: reel.version } }, session);
    await audit(reel, auth, 'edited_requires_review', '', session); return reel;
  });
}
export async function submitReel(auth, id, version) {
  return moneyTransaction(async session => {
    const reel = await ownedReel(auth, id, session);
    if (reel.version !== version) throw reelError(409, 'Reel changed; refresh before submitting');
    if (reel.mediaStatus !== 'ready' || !reel.embeddingModel) throw reelError(409, 'Video and multilingual embedding processing must finish first');
    if (reel.status === 'pending_review') return reel;
    if (!['draft', 'rejected'].includes(reel.status)) throw reelError(409, 'Reel cannot be submitted in its current state');
    reel.status = 'pending_review'; reel.version++; await reel.save({ session }); await audit(reel, auth, 'submitted', '', session); return reel;
  });
}
export async function moderateReel(auth, id, body) {
  if (!await isReviewer(auth)) throw reelError(403, 'An explicitly approved verified medical reviewer is required');
  if (!['publish', 'reject', 'remove'].includes(body.decision)) throw reelError(400, 'Invalid review decision');
  const reason = text(body.reason ?? '', 1000, 'review reason', body.decision !== 'publish');
  return moneyTransaction(async session => {
    await verifiedDoctor(auth, session);
    const reel = await Reel.findById(reelId(id)).session(session);
    if (!reel || reel.status === 'removed') throw reelError(404, 'Reel not found');
    if (String(reel.doctorId) === auth.id) throw reelError(403, 'An independent reviewer must review this reel');
    if (reel.version !== body.version) throw reelError(409, 'Review is stale; reload the current version');
    if (body.decision !== 'remove' && reel.status !== 'pending_review') throw reelError(409, 'Reel is not awaiting review');
    if (body.decision === 'publish' && (reel.mediaStatus !== 'ready' || !reel.embeddingModel || !await Doctor.exists({ _id: reel.doctorId, 'credentialVerification.status': 'verified' }).session(session))) throw reelError(409, 'Author verification and processed media are required');
    reel.status = { publish: 'published', reject: 'rejected', remove: 'removed' }[body.decision];
    reel.reviewedBy = auth.id; reel.moderationReason = reason; reel.publishedAt = body.decision === 'publish' ? new Date() : null; reel.version++;
    await reel.save({ session }); await audit(reel, auth, body.decision, reason, session);
    await ReelReport.updateMany({ reelId: reel._id, status: 'open' }, { $set: { status: 'reviewed', resolvedBy: auth.id } }, { session }); return reel;
  });
}
export async function preferences(auth) { return await ReelPreference.findById(actorKey(auth)).lean() || { personalizationEnabled: false, topics: [], revision: 0 }; }
export async function setPreferences(auth, body) {
  if (typeof body.personalizationEnabled !== 'boolean' || body.resetHistory !== undefined && typeof body.resetHistory !== 'boolean') throw reelError(400, 'Explicit personalization preference is required');
  const topics = body.topics === undefined ? undefined : metadata({ title: 'preferences', topics: body.topics }).topics;
  return moneyTransaction(async session => {
    const preference = await ReelPreference.findOneAndUpdate({ _id: actorKey(auth) }, { $set: { personalizationEnabled: body.personalizationEnabled, ...(topics ? { topics } : {}), ...(!body.personalizationEnabled || body.resetHistory ? { historyResetAt: new Date() } : {}) }, $inc: { revision: 1, eventFence: 1 } }, { upsert: true, new: true, session });
    if (!body.personalizationEnabled || body.resetHistory) await ReelSignal.deleteMany({ actorKey: actorKey(auth) }, { session });
    return preference;
  });
}
const cursorSecret = () => { if (!process.env.TOKEN_KEY) throw reelError(503, 'Cursor signing is unavailable'); return process.env.TOKEN_KEY; };
function signCursor(value) { const encoded = Buffer.from(JSON.stringify(value)).toString('base64url'); return `${encoded}.${crypto.createHmac('sha256', cursorSecret()).update(encoded).digest('base64url')}`; }
function readCursor(token) {
  if (typeof token !== 'string' || token.length > 1200 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw reelError(400, 'Invalid feed cursor');
  const [encoded, signature] = token.split('.'), expected = crypto.createHmac('sha256', cursorSecret()).update(encoded || '').digest('base64url');
  if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw reelError(400, 'Invalid feed cursor');
  try { return JSON.parse(Buffer.from(encoded, 'base64url')); } catch { throw reelError(400, 'Invalid feed cursor'); }
}
export async function feed(auth, query) {
  const mode = query.mode || 'for-you'; if (!['for-you', 'following', 'explore'].includes(mode)) throw reelError(400, 'Invalid feed');
  const q = text(query.q || '', 80, 'search'), topic = text(query.topic || '', 40, 'topic');
  const doctorId = query.doctorId ? reelId(query.doctorId) : null, requestedReel = query.reelId ? reelId(query.reelId) : null;
  const pref = await preferences(auth), identity = hash([actorKey(auth), mode, q, topic, String(doctorId || ''), String(requestedReel || ''), query.saved === 'true', pref.revision]);
  const redis = getRedis(); let snapshot, offset = 0, snapshotId;
  if (query.cursor) {
    const cursor = readCursor(query.cursor);
    if (cursor.identity !== identity || cursor.expires < Date.now() || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw reelError(409, 'Feed expired or preferences changed; refresh');
    snapshotId = cursor.snapshotId; offset = cursor.offset;
    let cached = null; try { cached = await redis.get(`reels:feed:${identity}:${snapshotId}`); } catch { cached = null; }
    if (!cached) throw reelError(409, 'Feed expired; refresh'); snapshot = JSON.parse(cached);
  } else {
    const follows = await ReelFollow.find({ actorKey: actorKey(auth) }).limit(500).lean(), followed = follows.map(x => String(x.doctorId));
    const base = { status: 'published', mediaStatus: 'ready', ...(topic ? { topics: topic } : {}), ...(doctorId ? { doctorId } : {}), ...(mode === 'following' ? { doctorId: { $in: followed } } : {}) };
    if (requestedReel) base._id = requestedReel;
    if (query.saved === 'true') { const saved = await ReelReaction.find({ actorKey: actorKey(auth), kind: 'save' }).limit(500).select('reelId').lean(); base._id = { $in: saved.map(x => x.reelId).filter(id => !requestedReel || String(id) === String(requestedReel)) }; }
    if (q) base.$or = ['title', 'caption'].map(field => ({ [field]: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }));
    const [recent, popular] = await Promise.all([Reel.find(base).sort({ publishedAt: -1, _id: -1 }).limit(300).select('+embedding').lean(), Reel.find(base).sort({ 'counts.saves': -1, 'counts.views': -1 }).limit(100).select('+embedding').lean()]);
    const candidates = [...new Map([...recent, ...popular].map(r => [String(r._id), r])).values()];
    const signals = pref.personalizationEnabled ? await ReelSignal.find({ actorKey: actorKey(auth) }).sort({ lastSeenAt: -1 }).limit(100).lean() : [];
    const reacted = pref.personalizationEnabled ? await ReelReaction.find({ actorKey: actorKey(auth) }).sort({ createdAt: -1 }).limit(100).lean() : [];
    const historyIds = [...new Set([...signals.map(x => String(x.reelId)), ...reacted.map(x => String(x.reelId))])];
    const history = historyIds.length ? await Reel.find({ _id: { $in: historyIds }, status: 'published' }).select('+embedding').lean() : [];
    const vector = pref.personalizationEnabled && mode === 'for-you' ? interestVector(history.map(reel => ({ reel, signal: signals.find(s => String(s.reelId) === String(reel._id)), liked: reacted.some(r => r.kind === 'like' && String(r.reelId) === String(reel._id)), saved: reacted.some(r => r.kind === 'save' && String(r.reelId) === String(reel._id)) }))) : [];
    const ranked = rankReels(candidates, { vector, topics: pref.personalizationEnabled ? pref.topics : [], followed: pref.personalizationEnabled || mode === 'following' ? followed : [], signals: new Map(signals.map(x => [String(x.reelId), x])), explore: mode === 'explore' });
    const reports = await ReelReport.find({ actorKey: actorKey(auth) }).select('reelId').lean(), excluded = new Set(reports.map(r => String(r.reelId)));
    snapshot = { ids: ranked.filter(r => !excluded.has(String(r._id))).map(r => String(r._id)), expires: Date.now() + 600000, coldStart: !vector.length };
    snapshotId = crypto.randomUUID(); try { await redis.set(`reels:feed:${identity}:${snapshotId}`, JSON.stringify(snapshot), 'EX', 600); } catch { snapshotId = null; }
  }
  const ids = snapshot.ids.slice(offset, offset + 12), rows = await Reel.find({ _id: { $in: ids }, status: 'published', mediaStatus: 'ready' }).lean();
  const verified = await Doctor.find({ _id: { $in: rows.map(r => r.doctorId) }, 'credentialVerification.status': 'verified' }).select('_id').lean(), allowed = new Set(verified.map(d => String(d._id)));
  const hidden = new Set((await ReelReport.find({ actorKey: actorKey(auth), reelId: { $in: ids } }).select('reelId').lean()).map(r => String(r.reelId)));
  const ordered = ids.map(id => rows.find(r => String(r._id) === id)).filter(r => r && allowed.has(String(r.doctorId)) && !hidden.has(String(r._id)));
  const next = snapshotId && offset + 12 < snapshot.ids.length ? signCursor({ identity, snapshotId, offset: offset + 12, expires: snapshot.expires }) : null;
  return { items: await serializeReels(ordered, auth), nextCursor: next, personalization: { enabled: pref.personalizationEnabled, rankingVersion: RANKING_VERSION, coldStart: snapshot.coldStart, clinicalDataUsed: false } };
}
export async function reaction(auth, id, body) {
  if (!['like', 'save'].includes(body.kind) || typeof body.active !== 'boolean') throw reelError(400, 'Invalid reaction');
  return moneyTransaction(async session => {
    const reel = await requirePublished(id, session), key = { actorKey: actorKey(auth), reelId: reel._id, kind: body.kind };
    const existing = await ReelReaction.findOne(key).session(session);
    if (body.active && !existing) { await ReelReaction.create([key], { session }); await Reel.updateOne({ _id: reel._id }, { $inc: { [`counts.${body.kind === 'like' ? 'likes' : 'saves'}`]: 1 } }, { session }); }
    if (!body.active && existing) { await ReelReaction.deleteOne({ _id: existing._id }, { session }); await Reel.updateOne({ _id: reel._id }, { $inc: { [`counts.${body.kind === 'like' ? 'likes' : 'saves'}`]: -1 } }, { session }); }
    return { active: body.active, counts: (await Reel.findById(reel._id).session(session)).counts };
  });
}
export async function follow(auth, id, active) {
  if (typeof active !== 'boolean') throw reelError(400, 'Invalid follow preference');
  if (!await Doctor.exists({ _id: reelId(id), 'credentialVerification.status': 'verified' })) throw reelError(404, 'Verified doctor not found');
  if (auth.role === 'doctor' && auth.id === id) throw reelError(400, 'You cannot follow yourself');
  const key = { actorKey: actorKey(auth), doctorId: id };
  if (active) { try { await ReelFollow.updateOne(key, { $setOnInsert: key }, { upsert: true }); } catch (error) { if (error.code !== 11000) throw error; } }
  else await ReelFollow.deleteOne(key); return { active };
}
export async function addComment(auth, id, body) {
  const value = text(body.text, 500, 'comment', true), command = commandKey(body.idempotencyKey), fingerprint = hash([id, value]);
  return moneyTransaction(async session => {
    const reel = await requirePublished(id, session), existing = await ReelComment.findOne({ actorKey: actorKey(auth), commandKey: command }).session(session);
    if (existing) { if (existing.fingerprint !== fingerprint) throw reelError(409, 'Comment key was used for different content'); return existing; }
    const [comment] = await ReelComment.create([{ actorKey: actorKey(auth), authorName: text(auth.name || 'Member', 150, 'author'), reelId: reel._id, text: value, commandKey: command, fingerprint }], { session });
    await Reel.updateOne({ _id: reel._id }, { $inc: { 'counts.comments': 1 } }, { session }); return comment;
  });
}
export async function removeComment(auth, id, commentId) {
  return moneyTransaction(async session => {
    const reel = await requirePublished(id, session), comment = await ReelComment.findOne({ _id: reelId(commentId), reelId: reel._id }).session(session);
    if (!comment) throw reelError(404, 'Comment not found');
    if (comment.actorKey !== actorKey(auth) && !(auth.role === 'doctor' && String(reel.doctorId) === auth.id) && !await isReviewer(auth, session)) throw reelError(403, 'Comment removal is not permitted');
    if (!comment.removed) { comment.removed = true; await comment.save({ session }); await Reel.updateOne({ _id: reel._id }, { $inc: { 'counts.comments': -1 } }, { session }); }
  });
}
export async function reportReel(auth, id, body) {
  await requirePublished(id);
  if (!['medical_misinformation', 'patient_privacy', 'harassment', 'spam', 'other'].includes(body.reason)) throw reelError(400, 'Select a report reason');
  const details = text(body.details || '', 1000, 'report details');
  await ReelReport.updateOne({ actorKey: actorKey(auth), reelId: id }, { $setOnInsert: { reason: body.reason, details, status: 'open' } }, { upsert: true });
  // Reporting never publishes an accusation or exposes reporter identity to the author.
  return { received: true };
}
export async function beginPlayback(auth, id) {
  await requirePublished(id);
  const session = await ReelPlayback.create({ _id: crypto.randomUUID(), actorKey: actorKey(auth), reelId: id, lastEventAt: new Date(), expiresAt: new Date(Date.now() + 1800000) });
  return { sessionId: session._id };
}
export async function engagement(auth, id, body) {
  const eventId = commandKey(body.eventId), fingerprint = hash([id, body.sessionId, body.sequence, body.type, body.watchMs]);
  if (!['watch', 'skip', 'share'].includes(body.type) || !Number.isSafeInteger(body.sequence) || body.sequence < 1) throw reelError(400, 'Invalid playback event');
  if (!Number.isFinite(body.watchMs) || body.watchMs < 0 || body.watchMs > 15000) throw reelError(400, 'Watch heartbeat must be between 0 and 15000 ms');
  return moneyTransaction(async session => {
    const prior = await ReelEvent.findOne({ actorKey: actorKey(auth), commandKey: eventId }).session(session);
    if (prior) { if (prior.fingerprint !== fingerprint) throw reelError(409, 'Playback key changed'); return { accepted: true, replay: true }; }
    const reel = await requirePublished(id, session), now = new Date();
    const playback = await ReelPlayback.findOne({ _id: body.sessionId, actorKey: actorKey(auth), reelId: reel._id, expiresAt: { $gt: now } }).session(session);
    if (!playback || body.sequence !== playback.sequence + 1) throw reelError(409, 'Playback expired or sequence is stale');
    const elapsed = Math.max(0, now.getTime() - playback.lastEventAt.getTime()), remaining = Math.max(0, reel.duration * 1000 - playback.watchMs);
    const credited = body.type === 'watch' ? Math.min(body.watchMs, elapsed, remaining, 15000) : 0;
    playback.sequence = body.sequence; playback.watchMs += credited; playback.lastEventAt = now;
    const qualified = !playback.qualified && playback.watchMs >= Math.min(10000, reel.duration * 500);
    playback.qualified ||= qualified; await playback.save({ session });
    await ReelEvent.create([{ actorKey: actorKey(auth), commandKey: eventId, fingerprint, expiresAt: new Date(Date.now() + 86400000) }], { session });
    const pref = await ReelPreference.findOneAndUpdate({ _id: actorKey(auth) }, { $inc: { eventFence: 1 }, $setOnInsert: { personalizationEnabled: false } }, { upsert: true, new: true, session });
    if (pref.personalizationEnabled) await ReelSignal.updateOne({ actorKey: actorKey(auth), reelId: reel._id }, { $inc: { watchMs: credited, skips: body.type === 'skip' ? 1 : 0, shares: body.type === 'share' ? 1 : 0 }, $set: { lastSeenAt: now } }, { upsert: true, session });
    const daily = await ReelDaily.findOneAndUpdate({ actorKey: actorKey(auth), reelId: reel._id, day: now.toISOString().slice(0, 10) }, { $setOnInsert: { expiresAt: new Date(Date.now() + 2 * 86400000) } }, { upsert: true, new: true, session });
    const newView = qualified && !daily.qualified, newShare = body.type === 'share' && !daily.shared;
    daily.qualified ||= qualified; daily.shared ||= body.type === 'share'; await daily.save({ session });
    if (!(auth.role === 'doctor' && auth.id === String(reel.doctorId))) await Reel.updateOne({ _id: reel._id }, { $inc: { 'counts.views': newView ? 1 : 0, 'counts.shares': newShare ? 1 : 0 } }, { session });
    return { accepted: true, creditedWatchMs: credited };
  });
}
export async function retryProcessing(auth, id) {
  return moneyTransaction(async session => {
    const reel = await ownedReel(auth, id, session);
    if (reel.mediaStatus !== 'failed') throw reelError(409, 'Only failed jobs can be retried');
    reel.version++; reel.mediaStatus = 'queued'; reel.processingError = ''; await reel.save({ session });
    await enqueueJob({ id: `reel:${reel._id}:${reel.version}`, kind: 'reels.process', payload: { reelId: String(reel._id), version: reel.version } }, session); return reel;
  });
}
export async function finalizeUpload(auth, reel, result, uploadKey, uploadToken) {
  return moneyTransaction(async session => {
    await verifiedDoctor(auth, session);
    const updated = await Reel.findOneAndUpdate({ _id: reel._id, doctorId: auth.id, status: 'draft', mediaStatus: 'uploading', uploadKey, uploadToken }, { $set: { sourcePath: result.path, sourceHash: result.sha256, mediaStatus: 'queued', uploadLeaseUntil: null, uploadToken: null }, $inc: { version: 1 } }, { new: true, session });
    if (!updated) throw reelError(409, 'Upload no longer owns this draft');
    await enqueueJob({ id: `reel:${updated._id}:${updated.version}`, kind: 'reels.process', payload: { reelId: String(updated._id), version: updated.version } }, session); return updated;
  });
}
export async function deleteReel(auth, id) {
  return moneyTransaction(async session => {
    const reel = await ownedReel(auth, id, session); reel.status = 'removed'; reel.version++; await reel.save({ session }); await audit(reel, auth, 'author_removed', '', session);
    // Files are retained privately for reviewed retention/cleanup; never served after removal.
  });
}
export { OutboxJob };
