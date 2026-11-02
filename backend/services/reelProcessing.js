import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Reel } from '../model/reel.js';
import OutboxJob from '../model/outboxJob.js';
import { moneyTransaction } from './moneyTransaction.js';
import { featureEnabled } from './reelService.js';
import { processVideo, cleanupReelJob } from './reelMedia.js';
import { embedReelText } from './reelEmbedding.js';

// Shared durable outbox provides retry/backoff, leases, heartbeat and dead-letter state.
export async function processReelJob(job, testDependencies) {
  if (testDependencies && process.env.NODE_ENV !== 'test') throw new Error('Test media adapters are unavailable outside isolated tests');
  const embed = testDependencies?.embed || embedReelText, transcode = testDependencies?.transcode || processVideo;
  if (!featureEnabled()) throw new Error('Reels processing is disabled');
  const { reelId, version } = job.payload;
  const reel = await Reel.findOne({ _id: reelId, version, status: { $in: ['draft', 'processing'] } }).select('+sourcePath');
  if (!reel || !reel.sourcePath) return { skipped: true };
  if (reel.mediaStatus === 'ready' && reel.mediaJobId && reel.embeddingModel) return { processed: true, replay: true };
  const owned = () => ({ _id: job._id, state: 'processing', leaseToken: job.leaseToken, leaseUntil: { $gt: new Date() } });
  if (!await OutboxJob.exists(owned())) return { skipped: true };
  const jobId = randomUUID(); let media;
  const started = await moneyTransaction(async session => {
    if (!(await OutboxJob.updateOne(owned(), { $inc: { 'payload.startFence': 1 } }, { session })).matchedCount) return false;
    return Boolean((await Reel.updateOne({ _id: reel._id, version, mediaStatus: { $in: ['queued', 'processing', 'failed'] } }, { $set: { mediaStatus: 'processing', processingError: '' } }, { session })).matchedCount);
  });
  if (!started) return { skipped: true };
  try {
    const embedding = await embed({ title: reel.title, caption: reel.caption, topics: reel.topics, language: reel.language });
    if (embedding.dimension !== 384 || embedding.vector?.length !== 384 || embedding.vector.some(x => !Number.isFinite(x))) throw new Error('Invalid embedding');
    media = await transcode(String(reel._id), reel.sourcePath, reel.thumbnailSeconds, jobId);
    const committed = await moneyTransaction(async session => {
      const lease = await OutboxJob.updateOne(owned(), { $inc: { 'payload.commitFence': 1 } }, { session });
      if (!lease.matchedCount) return false;
      const saved = await Reel.updateOne({ _id: reel._id, version, status: { $in: ['draft', 'processing'] } }, { $set: {
        mediaStatus: 'ready', status: 'draft', mediaJobId: path.basename(media.outputDirectory),
        duration: media.duration, width: media.width, height: media.height,
        embedding: embedding.vector, embeddingModel: embedding.model, embeddingRevision: embedding.revision,
        processingError: '',
      } }, { session }); return Boolean(saved.modifiedCount);
    });
    if (!committed) await cleanupReelJob(String(reel._id), jobId);
    return committed ? { processed: true } : { skipped: true };
  } catch (error) {
    await cleanupReelJob(String(reel._id), jobId).catch(() => {});
    await moneyTransaction(async session => {
      if (!(await OutboxJob.updateOne(owned(), { $inc: { 'payload.failureFence': 1 } }, { session })).matchedCount) return;
      await Reel.updateOne({ _id: reel._id, version, mediaStatus: 'processing' }, { $set: { mediaStatus: 'failed', processingError: 'Media or embedding processing unavailable. Check worker configuration; retry is available.' } }, { session });
    });
    throw new Error('Reel processing failed', { cause: error });
  }
}
