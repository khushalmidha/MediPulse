import { Router } from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import asyncHandler from '../middleware/asyncHandler.js';
import userValidation from '../middleware/validateUser.js';
import { Reel, ReelComment, ReelReport } from '../model/reel.js';
import { safeReelDirectory, receiveVideo, probeVideo } from '../services/reelMedia.js';
import * as service from '../services/reelService.js';
const router = Router();
const wrap = asyncHandler;
router.use(userValidation, wrap(async (req, res, next) => { await service.assertReelsReady(); res.set('Cache-Control', 'private, no-store'); next(); }));
router.use((req, res, next) => {
  if (['POST', 'PATCH'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return next(service.reelError(400, 'A JSON object is required'));
  next();
});
router.get('/feed', wrap(async (req, res) => { await service.rateLimit(req.auth, 'feed', 90); res.json(await service.feed(req.auth, req.query)); }));
router.get('/mine', wrap(async (req, res) => { await service.verifiedDoctor(req.auth); const rows = await Reel.find({ doctorId: req.auth.id, status: { $ne: 'removed' } }).sort({ createdAt: -1 }).limit(100).lean(); res.json({ items: await service.serializeReels(rows, req.auth), canReview: await service.isReviewer(req.auth) }); }));
router.get('/moderation', wrap(async (req, res) => { if (!await service.isReviewer(req.auth)) throw service.reelError(403, 'Approved medical reviewer access is required'); const rows = await Reel.find({ status: 'pending_review', doctorId: { $ne: req.auth.id } }).sort({ updatedAt: 1 }).limit(100).lean(); res.json({ items: await service.serializeReels(rows, req.auth) }); }));
router.get('/reports', wrap(async (req, res) => {
  if (!await service.isReviewer(req.auth)) throw service.reelError(403, 'Approved reviewer access is required');
  const rows = await ReelReport.find({ status: 'open' }).select('reelId reason details createdAt').limit(100).lean();
  const reels = await Reel.find({ _id: { $in: rows.map(r => r.reelId) }, status: { $ne: 'removed' } }).lean(), serialized = await service.serializeReels(reels, req.auth);
  res.json({ items: rows.map(row => ({ ...row, reel: serialized.find(r => r.id === String(row.reelId)) || null })) });
}));
router.get('/preferences', wrap(async (req, res) => { const p = await service.preferences(req.auth); res.json({ personalizationEnabled: p.personalizationEnabled, topics: p.topics }); }));
router.post('/preferences', wrap(async (req, res) => { await service.rateLimit(req.auth, 'preferences', 20); const p = await service.setPreferences(req.auth, req.body); res.json({ personalizationEnabled: p.personalizationEnabled, topics: p.topics }); }));
router.post('/', wrap(async (req, res) => { await service.rateLimit(req.auth, 'create', 20, 3600000); const reel = await service.createReel(req.auth, req.body); res.status(201).json({ reel: (await service.serializeReels([reel], req.auth))[0] }); }));
router.post('/doctors/:id/follow', wrap(async (req, res) => { await service.rateLimit(req.auth, 'follow', 60); res.json(await service.follow(req.auth, req.params.id, req.body.active)); }));
router.get('/media/:id/:jobId/*', wrap(async (req, res, next) => {
  const reel = await service.canReadReel(req.auth, await Reel.findById(service.reelId(req.params.id)));
  if (req.params.jobId !== reel.mediaJobId || !/^[a-f\d-]{36}$/.test(req.params.jobId)) throw service.reelError(404, 'Media not found');
  const filename = req.params[0];
  if (!filename || !/^[a-zA-Z0-9_./-]+\.(?:m3u8|ts|jpg|m4s|mp4)$/.test(filename) || filename.split('/').some(x => !x || x === '.' || x === '..')) throw service.reelError(400, 'Invalid media path');
  const root = path.join(safeReelDirectory(String(reel._id)), 'jobs', reel.mediaJobId), file = path.resolve(root, filename);
  if (!file.startsWith(root + path.sep)) throw service.reelError(400, 'Invalid media path');
  // Processed files are never taken from request-controlled storage paths or originals.
  for (let current = file; current !== path.dirname(root); current = path.dirname(current)) {
    const stat = await fs.lstat(current).catch(() => null); if (!stat || stat.isSymbolicLink()) throw service.reelError(404, 'Media not found');
  }
  if (filename.endsWith('.m3u8')) res.type('application/vnd.apple.mpegurl');
  if (filename.endsWith('.ts')) res.type('video/mp2t');
  res.set('X-Content-Type-Options', 'nosniff'); res.sendFile(file, error => { if (error) next(service.reelError(error.status || 500, 'Media unavailable')); });
}));
router.put('/:id/upload', wrap(async (req, res) => {
  await service.verifiedDoctor(req.auth); await service.rateLimit(req.auth, 'upload', 20, 3600000);
  const key = req.header('Idempotency-Key'); if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(key || '')) throw service.reelError(400, 'A stable upload UUID is required');
  const current = await service.ownedReel(req.auth, req.params.id), stored = await Reel.findById(current._id).select('+sourceHash');
  const replay = current.uploadKey === key && ['queued', 'processing', 'ready'].includes(current.mediaStatus);
  const uploadToken = randomUUID();
  if (!replay) {
    const claimed = await Reel.findOneAndUpdate({ _id: current._id, doctorId: req.auth.id, status: 'draft', $or: [{ mediaStatus: { $in: ['empty', 'failed'] } }, { mediaStatus: 'uploading', uploadLeaseUntil: { $lt: new Date() } }] }, { $set: { uploadKey: key, uploadToken, mediaStatus: 'uploading', uploadLeaseUntil: new Date(Date.now() + 600000) } });
    if (!claimed) throw service.reelError(409, 'Another upload is active or this reel already has media');
  }
  let received;
  try {
    received = await receiveVideo(req, String(current._id), randomUUID());
    if (replay) { if (received.sha256 !== stored.sourceHash) throw service.reelError(409, 'Upload key was used for different video content'); await fs.unlink(received.path); return res.json({ reel: (await service.serializeReels([current], req.auth))[0], replay: true }); }
    await probeVideo(received.path);
    const reel = await service.finalizeUpload(req.auth, current, received, key, uploadToken); res.json({ reel: (await service.serializeReels([reel], req.auth))[0] });
  } catch (error) {
    if (received?.path) await fs.unlink(received.path).catch(() => {});
    if (!replay) await Reel.updateOne({ _id: current._id, mediaStatus: 'uploading', uploadKey: key, uploadToken }, { $set: { mediaStatus: 'empty', uploadLeaseUntil: null, uploadToken: null } });
    throw error;
  }
}));
router.patch('/:id', wrap(async (req, res) => { await service.rateLimit(req.auth, 'edit', 30); const reel = await service.editReel(req.auth, req.params.id, req.body); res.json({ reel: (await service.serializeReels([reel], req.auth))[0] }); }));
router.post('/:id/submit', wrap(async (req, res) => { const reel = await service.submitReel(req.auth, req.params.id, req.body.version); res.json({ reel: (await service.serializeReels([reel], req.auth))[0] }); }));
router.post('/:id/retry', wrap(async (req, res) => { await service.rateLimit(req.auth, 'retry', 10); const reel = await service.retryProcessing(req.auth, req.params.id); res.json({ reel: (await service.serializeReels([reel], req.auth))[0] }); }));
router.post('/:id/moderate', wrap(async (req, res) => { const reel = await service.moderateReel(req.auth, req.params.id, req.body); res.json({ reel: (await service.serializeReels([reel], req.auth))[0] }); }));
router.delete('/:id', wrap(async (req, res) => { await service.deleteReel(req.auth, req.params.id); res.json({ removed: true }); }));
router.post('/:id/reactions', wrap(async (req, res) => { await service.rateLimit(req.auth, 'reaction', 120); res.json(await service.reaction(req.auth, req.params.id, req.body)); }));
router.get('/:id/comments', wrap(async (req, res) => {
  await service.requirePublished(req.params.id); const cursor = req.query.cursor ? service.reelId(req.query.cursor) : null;
  const comments = await ReelComment.find({ reelId: req.params.id, removed: false, ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(21).lean();
  res.json({ items: comments.slice(0, 20).map(x => ({ id: String(x._id), authorName: x.authorName, text: x.text, createdAt: x.createdAt })), nextCursor: comments.length > 20 ? String(comments[19]._id) : null });
}));
router.post('/:id/comments', wrap(async (req, res) => { await service.rateLimit(req.auth, 'comment', 10); const c = await service.addComment(req.auth, req.params.id, req.body); res.status(201).json({ comment: { id: String(c._id), authorName: c.authorName, text: c.text, createdAt: c.createdAt } }); }));
router.delete('/:id/comments/:commentId', wrap(async (req, res) => { await service.removeComment(req.auth, req.params.id, req.params.commentId); res.json({ removed: true }); }));
router.post('/:id/report', wrap(async (req, res) => { await service.rateLimit(req.auth, 'report', 20); res.json(await service.reportReel(req.auth, req.params.id, req.body)); }));
router.post('/:id/playback', wrap(async (req, res) => { await service.rateLimit(req.auth, 'playback', 60); res.json(await service.beginPlayback(req.auth, req.params.id)); }));
router.post('/:id/events', wrap(async (req, res) => { await service.rateLimit(req.auth, 'event', 120); res.json(await service.engagement(req.auth, req.params.id, req.body)); }));
export default router;
