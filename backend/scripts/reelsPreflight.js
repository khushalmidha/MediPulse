// Explicit read-only operator check. No dotenv, schema apply, media writes or downloads.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import Doctor from '../model/doctor.js';
import { requireDatabaseUrl } from '../util/databaseConfig.js';
import { inspectReelsSchema } from './reelsSchema.js';
import { REEL_EMBEDDING_MODEL, REEL_EMBEDDING_REVISION } from '../services/reelEmbedding.js';

async function checkDirectory(directory, writable = false) {
  if (!directory || !path.isAbsolute(directory)) return false;
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  try {
    for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) return false;
    }
    await access(absolute, constants.R_OK | (writable ? constants.W_OK : 0));
    return true;
  } catch { return false; }
}

async function checkBinary(kind, env) {
  try {
    const override = env[`REELS_${kind.toUpperCase()}_PATH`];
    if (override && !path.isAbsolute(override)) return false;
    const binary = override || (kind === 'ffmpeg' ? (await import('ffmpeg-static')).default : (await import('ffprobe-static')).default.path);
    return await new Promise(resolve => {
      const child = spawn(binary, ['-version'], { shell: false, windowsHide: true, stdio: 'ignore', timeout: 5000 });
      child.once('error', () => resolve(false));
      child.once('close', code => resolve(code === 0));
    });
  } catch { return false; }
}

export async function inspectReelsDeployment(env = process.env) {
  const checks = {};
  checks.explicitFeatureFlag = ['true', 'false'].includes(env.REELS_ENABLED);
  checks.enterpriseDisabled = env.ENTERPRISE_PILOT_ENABLED === 'false';
  checks.singleApiInstance = env.API_INSTANCES === '1';
  checks.offlineModelConfiguration = env.REELS_EMBEDDING_ALLOW_DOWNLOAD === 'false';
  checks.privateMediaDirectoryAccessible = await checkDirectory(env.REELS_MEDIA_ROOT, true);
  checks.privateModelDirectoryAccessible = await checkDirectory(env.REELS_EMBEDDING_CACHE_DIR);
  const local = env.REELS_EMBEDDING_LOCAL_MODEL_PATH;
  const modelDirectory = local || (env.REELS_EMBEDDING_CACHE_DIR && path.join(env.REELS_EMBEDDING_CACHE_DIR, REEL_EMBEDDING_MODEL, REEL_EMBEDDING_REVISION));
  checks.pinnedModelFilesPresent = await checkDirectory(modelDirectory);
  if (checks.pinnedModelFilesPresent) checks.pinnedModelFilesPresent = await checkDirectory(path.join(modelDirectory, 'onnx'));
  if (checks.pinnedModelFilesPresent) {
    try {
      for (const name of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']) {
        const file = path.join(modelDirectory, name);
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || !info.size) throw new Error('Invalid asset');
        await access(file, constants.R_OK);
      }
    } catch { checks.pinnedModelFilesPresent = false; }
  }
  [checks.ffmpegExecutable, checks.ffprobeExecutable] = await Promise.all(['ffmpeg', 'ffprobe'].map(kind => checkBinary(kind, env)));
  const configured = (env.REELS_REVIEWER_DOCTOR_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  const reviewerIds = [...new Set(configured)];
  checks.reviewerIdsValid = reviewerIds.length > 0 && reviewerIds.length <= 100 && reviewerIds.every(value => /^[a-f\d]{24}$/i.test(value));
  checks.reviewerAccountsVerified = false;
  checks.reelsIndexesReady = false;
  checks.mongoReplicaSetReady = false;
  let indexes = [], databaseChecksAvailable = false;
  if (mongoose.connection.readyState === 1) {
    try {
      const hello = await mongoose.connection.db.admin().command({ hello: 1, maxTimeMS: 5000 });
      checks.mongoReplicaSetReady = Boolean((hello.setName || hello.msg === 'isdbgrid') && hello.isWritablePrimary);
      indexes = await inspectReelsSchema();
      checks.reelsIndexesReady = indexes.every(row => !row.missing.length && !row.conflicts.length);
      if (checks.reviewerIdsValid) {
        const rows = await Doctor.find({ _id: { $in: reviewerIds }, 'credentialVerification.status': 'verified' }).select('_id').maxTimeMS(5000).lean();
        checks.reviewerAccountsVerified = rows.length === reviewerIds.length;
      }
      databaseChecksAvailable = true;
    } catch { /* Report only safe status; never emit database errors or account data. */ }
  }
  return {
    mode: 'read-only', featureEnabled: env.REELS_ENABLED === 'true',
    technicalChecksPassed: databaseChecksAvailable && Object.values(checks).every(Boolean),
    productionAccepted: false, databaseChecksAvailable, checks, indexes,
    configuredReviewerCount: reviewerIds.length,
    externalAcceptanceRequired: ['Persistent disk attachment and restart/restore evidence', 'Actual offline inference and synthetic transcode/decode', 'Approved reviewer governance and independent creator/reviewer workflow', 'Redis and full application readiness', 'Authenticated live relay/device checks and explicit activation approval'],
  };
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  try {
    const uri = requireDatabaseUrl({ ...process.env }), database = new URL(uri).pathname.slice(1);
    if (!process.argv.includes(`--confirm-database=${database}`)) throw new Error('Confirmation required');
    await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000, socketTimeoutMS: 10000 });
    const report = await inspectReelsDeployment();
    console.log(JSON.stringify(report, null, 2));
    if (!report.technicalChecksPassed) process.exitCode = 1;
  } catch {
    console.error('Read-only Reels check could not complete. Supply an explicit DATABASE_URL and matching --confirm-database=<name>; verify connection and permissions. Credentials and raw errors are suppressed.');
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}
