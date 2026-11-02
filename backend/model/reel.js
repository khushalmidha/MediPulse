import mongoose from 'mongoose';
const { Schema } = mongoose;
const options = { timestamps: true, autoIndex: false, autoCreate: false };
const make = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);
const reel = new Schema({
  doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
  creationKey: { type: String, required: true }, creationFingerprint: String,
  title: { type: String, required: true, maxlength: 120 }, caption: { type: String, maxlength: 2000 },
  topics: { type: [String], default: [] }, language: { type: String, default: 'en' },
  privacyConfirmed: Boolean, educationalOnly: Boolean,
  status: { type: String, enum: ['draft', 'processing', 'pending_review', 'published', 'rejected', 'removed'], default: 'draft' },
  mediaStatus: { type: String, enum: ['empty', 'uploading', 'queued', 'processing', 'ready', 'failed'], default: 'empty' },
  version: { type: Number, default: 0 }, uploadKey: String, uploadToken: String, uploadLeaseUntil: Date,
  sourcePath: { type: String, select: false }, sourceHash: { type: String, select: false },
  mediaJobId: String, duration: Number, width: Number, height: Number, thumbnailSeconds: { type: Number, default: 0 },
  processingError: String, moderationReason: String, publishedAt: Date, reviewedBy: Schema.Types.ObjectId,
  embedding: { type: [Number], select: false, default: undefined }, embeddingModel: String, embeddingRevision: String,
  counts: { likes: { type: Number, default: 0 }, saves: { type: Number, default: 0 }, comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 }, views: { type: Number, default: 0 } },
}, options);
reel.index({ doctorId: 1, creationKey: 1 }, { unique: true, name: 'reels_create_command' });
reel.index({ status: 1, publishedAt: -1, _id: -1 }, { name: 'reels_public_feed' });
reel.index({ doctorId: 1, createdAt: -1 }, { name: 'reels_author' });
reel.index({ status: 1, topics: 1, publishedAt: -1 }, { name: 'reels_topics' });
reel.index({ status: 1, 'counts.saves': -1, 'counts.views': -1 }, { name: 'reels_popular' });
export const Reel = make('Reel', reel);
const reaction = new Schema({ actorKey: String, reelId: Schema.Types.ObjectId, kind: { type: String, enum: ['like', 'save'] } }, options);
reaction.index({ actorKey: 1, reelId: 1, kind: 1 }, { unique: true, name: 'reels_reaction_unique' });
export const ReelReaction = make('ReelReaction', reaction);
const follow = new Schema({ actorKey: String, doctorId: Schema.Types.ObjectId }, options);
follow.index({ actorKey: 1, doctorId: 1 }, { unique: true, name: 'reels_follow_unique' });
export const ReelFollow = make('ReelFollow', follow);
const comment = new Schema({ actorKey: String, authorName: String, reelId: Schema.Types.ObjectId, text: { type: String, maxlength: 500 },
  commandKey: String, fingerprint: String, removed: { type: Boolean, default: false } }, options);
comment.index({ actorKey: 1, commandKey: 1 }, { unique: true, name: 'reels_comment_command' });
comment.index({ reelId: 1, createdAt: -1, _id: -1 }, { name: 'reels_comments_page' });
comment.index({ reelId: 1, removed: 1, _id: -1 }, { name: 'reels_comments_visible' });
export const ReelComment = make('ReelComment', comment);
const signal = new Schema({ actorKey: String, reelId: Schema.Types.ObjectId, watchMs: { type: Number, default: 0 },
  skips: { type: Number, default: 0 }, shares: { type: Number, default: 0 }, lastSeenAt: Date }, options);
signal.index({ actorKey: 1, reelId: 1 }, { unique: true, name: 'reels_signal_unique' });
signal.index({ actorKey: 1, lastSeenAt: -1 }, { name: 'reels_recent_interests' });
signal.index({ lastSeenAt: 1 }, { expireAfterSeconds: 90 * 86400, name: 'reels_signal_retention' });
export const ReelSignal = make('ReelSignal', signal);
const playback = new Schema({ _id: String, actorKey: String, reelId: Schema.Types.ObjectId, sequence: { type: Number, default: 0 },
  watchMs: { type: Number, default: 0 }, lastEventAt: Date, qualified: { type: Boolean, default: false }, expiresAt: Date }, options);
playback.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'reels_playback_expiry' });
export const ReelPlayback = make('ReelPlayback', playback);
const event = new Schema({ actorKey: String, commandKey: String, fingerprint: String, expiresAt: Date }, options);
event.index({ actorKey: 1, commandKey: 1 }, { unique: true, name: 'reels_event_unique' });
event.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'reels_event_expiry' });
export const ReelEvent = make('ReelEvent', event);
const preference = new Schema({ _id: String, personalizationEnabled: { type: Boolean, default: false }, topics: { type: [String], default: [] },
  historyResetAt: Date, revision: { type: Number, default: 0 }, eventFence: { type: Number, default: 0 } }, options);
export const ReelPreference = make('ReelPreference', preference);
const report = new Schema({ actorKey: String, reelId: Schema.Types.ObjectId, reason: String, details: { type: String, maxlength: 1000 },
  status: { type: String, default: 'open' }, resolvedBy: Schema.Types.ObjectId }, options);
report.index({ actorKey: 1, reelId: 1 }, { unique: true, name: 'reels_report_unique' });
export const ReelReport = make('ReelReport', report);
const audit = new Schema({ reelId: Schema.Types.ObjectId, actorKey: String, action: String, version: Number, reason: String }, options);
audit.index({ reelId: 1, createdAt: -1 }, { name: 'reels_moderation_history' });
export const ReelAudit = make('ReelAudit', audit);
const rate = new Schema({ _id: String, count: { type: Number, default: 0 }, expiresAt: Date }, options);
rate.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'reels_rate_expiry' });
export const ReelRate = make('ReelRate', rate);
const daily = new Schema({ actorKey: String, reelId: Schema.Types.ObjectId, day: String, qualified: { type: Boolean, default: false }, shared: { type: Boolean, default: false }, expiresAt: Date }, options);
daily.index({ actorKey: 1, reelId: 1, day: 1 }, { unique: true, name: 'reels_daily_unique' });
daily.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'reels_daily_expiry' });
export const ReelDaily = make('ReelDaily', daily);
export const reelsModels = [Reel, ReelReaction, ReelFollow, ReelComment, ReelSignal, ReelPlayback, ReelEvent, ReelPreference, ReelReport, ReelAudit, ReelRate, ReelDaily];
