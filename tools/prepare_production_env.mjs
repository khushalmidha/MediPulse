// Deployment preparation only. Never import this script into tests.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(root, 'backend/package.json'));
const dotenv = require('dotenv');
const original = readFileSync(join(root, 'backend/.env'), 'utf8');
const env = dotenv.parse(original);
const uri = new URL(env.DATABASE_URL || 'http://invalid');
if (uri.protocol !== 'mongodb+srv:' || !uri.hostname.endsWith('.mongodb.net') || !env.TOKEN_KEY) throw Error('Expected the configured Atlas environment and signing key');
if (/^\/medipulse_(test|dev)/.test(uri.pathname)) throw Error('Refusing a test/development database for production');
const overrides = {
  NODE_ENV: 'production', PORT: '8080', API_INSTANCES: '1', USE_REAL_REDIS: 'true', REDIS_URL: 'redis://redis:6379/0', KAFKA_BROKERS: '',
  CLIENT_URLS: 'https://medipulse.live,https://www.medipulse.live', FRONTEND_URL: 'https://www.medipulse.live',
  PUBLIC_BACKEND_URL: 'https://www.medipulse.live/backend', PUBLIC_BASE_DOMAIN: 'medipulse.live', PUBLIC_APP_DOMAINS: 'medipulse.live,www.medipulse.live',
  REELS_ENABLED: 'false', ENTERPRISE_PILOT_ENABLED: 'false', REELS_MEDIA_ROOT: '/var/lib/medipulse/reels',
  REELS_EMBEDDING_CACHE_DIR: '/var/lib/medipulse/models', REELS_EMBEDDING_ALLOW_DOWNLOAD: 'false',
  REELS_FFMPEG_PATH: '/usr/bin/ffmpeg', REELS_FFPROBE_PATH: '/usr/bin/ffprobe', REELS_PROCESS_TIMEOUT_MS: '600000',
};
const backendValues = { ...env, ...overrides };
if (Object.values(backendValues).some(v => /[\r\n\0]/.test(v))) throw Error('Multiline environment values require a separate reviewed transport format');
const backend = Object.entries(backendValues).map(([k,v]) => `${k}=${v}`).join('\n') + '\n';
const publicEnv = {};
const frontendFile = join(root, 'frontend/.env');
const frontend = existsSync(frontendFile) ? dotenv.parse(readFileSync(frontendFile)) : {};
for (const key of ['VITE_GOOGLE_CLIENT_ID', 'VITE_GOOGLE_MAPS_API', 'VITE_CLOUDINARY_API']) if (frontend[key]) publicEnv[key] = frontend[key];
publicEnv.VITE_GOOGLE_CLIENT_ID ||= env.GOOGLE_CLIENT_ID || '';
Object.assign(publicEnv, { VITE_BACKEND_URL: '/backend', VITE_BASE_DOMAIN: 'medipulse.live', VITE_APP_DOMAINS: 'medipulse.live,www.medipulse.live', VITE_ENABLE_HOSPITAL_CUSTOM_DOMAINS: 'false' });
if (Object.values(publicEnv).some(v => /[\r\n\0]/.test(v))) throw Error('Invalid multiline public setting');
const publicText = Object.entries(publicEnv).map(([k,v]) => `${k}=${v}`).join('\n') + '\n';
const directory = resolve(process.env.LOCALAPPDATA, 'MediPulse/Private'); mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'production-environment.json'), JSON.stringify({ backend, frontend: publicText }), { mode: 0o600 });
const review = { source: 'existing backend/.env and whitelisted frontend public settings', atlasConfigured: true, signingKeyPresent: true,
  providerSettingsPreserved: true, reelsEnabled: false, enterpriseEnabled: false, reviewerIdsPresent: Boolean(env.REELS_REVIEWER_DOCTOR_IDS),
  frontendBackendPath: '/backend', browserDomain: 'medipulse.live', noProductionDatabaseOperations: true, secretsPrinted: false };
writeFileSync(join(directory, 'production-environment-review.json'), JSON.stringify(review, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(review));
