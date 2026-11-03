# Doctor Reels

Educational short videos integrated into MediPulse Connect. Feed: `/reels`; verified-doctor studio and independent review: `/doctor/reels`. API: `/api/reels`, account cookie/CSRF scope. Hospital staff sessions never confer publishing permission. No patient records, symptoms, appointments or private clinical notes enter recommendation vectors.

## What runs

- Camera/microphone recording with cleanup, MP4/WebM upload, preview, editable metadata and thumbnail frame selection. Maximum duration 300 seconds, upload 200 MiB. Client checks help UX; server magic/container/probe/packet checks enforce limits. Browser WebM without a duration header is timed from verified packet timestamps, never a client duration.
- Private original storage, actual FFmpeg H.264/AAC adaptive HLS variants up to 360p/720p without upscaling, JPEG thumbnail. Auth is checked on manifests, segments and images; originals have no serving route.
- Existing durable outbox performs embedding/transcoding with leases, heartbeat, retries/backoff and failure state. Version and lease fences prevent stale workers committing results; failed jobs have an explicit retry action. Changing published metadata withdraws it for fresh processing/review.
- Likes, saves, follows, comments, reporting, sharing, following/explore/saved feeds, signed actor/filter-bound pagination snapshots in Redis. Explicit reaction state is transactionally retry safe. Watch events have session/actor binding, monotonic sequence, stable command fingerprints, wall-clock credit caps and per-person/day view/share deduplication. Client watch observations are abuse-limited signals, not proof of attention or learning.
- Independent explicitly approved verified doctors review the exact version. Authors cannot approve themselves. Report queue supports reviewing/removing published content. Verification revocation, edits and removal prevent public media access. Privacy attestation and human review do not establish clinical validation or automated PHI detection.

## Actual recommendation implementation

Pinned Hugging Face `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, revision `2c4055b12046f11709e9df2c122e59ffbdc2f900`, produces normalized 384D CPU q8 embeddings of reel title/caption/topics/language. Model assets load locally; downloading requires explicit opt-in. No random/hash-vector fallback exists. Missing model configuration leaves processing failed/retryable and prevents publication.

For You builds a time-decayed interest vector from consented viewing/completion, likes/saves and skips. Ranking combines semantic cosine, chosen topics, follows, smoothed public engagement, freshness and negative feedback, then applies creator/topic diversity and deterministic unseen-content exploration. Cold start uses public freshness/quality without inferred clinical data. Opt-out/reset deletes viewing signals; existing explicit likes/saves/follows remain user actions. Following filters by followed doctors. Candidate retrieval is bounded to 300 recent plus 100 popular matching reels; this is not an unbounded Atlas vector search. Scale testing and vector-index retrieval are future operational work if the catalogue exceeds this bounded pool.

Discovery personalization defaults off. Technical playback sessions expire after 30 minutes, event deduplication after one day, per-day aggregate guards after two days, and opt-in behavioral signals after 90 days. Mongo TTL cleanup is asynchronous. Removed media stays private for an explicitly reviewed retention/purge policy; the UI does not promise immediate physical erasure.

## Local setup

Use Node 24 and existing Mongo replica set/Redis setup. Never load production credentials into tests or use production data for a demo. Install locked dependencies. FFmpeg/FFprobe static packages support development; Docker uses configured system binaries.

Configure a private persistent absolute `REELS_MEDIA_ROOT`, `REELS_EMBEDDING_CACHE_DIR`, `REELS_ENABLED=true`, and `REELS_REVIEWER_DOCTOR_IDS` containing explicitly approved verified doctor account IDs. Reviewer and creator must differ. No account gains verification or reviewer permission from the UI.

Run `node scripts/reelsSchema.js` from backend for read-only inspection with an explicit DATABASE_URL. After backup/rehearsal and exact approval where required, apply with `--apply --confirm-database=<exact-name>`. The migration is additive and named-index based, refuses conflicting indexes, and preserves duplicate records when uniqueness creation fails. Startup/API requests never sync indexes. Reels routes fail closed when disabled or required schema is absent.

Populate the pinned model cache using `npm run reels:prepare-model -- --download` from backend, with download enabled only for that operation. Normal worker inference should run with `REELS_EMBEDDING_ALLOW_DOWNLOAD=false`. A local-model override is the exact model directory containing config/tokenizer files and `onnx/model_quantized.onnx`, not a parent folder. Keep assets outside Git/shared folders.

Existing outbox worker dispatches `reels.process`; disabled Reels jobs are held rather than consuming retries. Deploy compatible API/worker versions and mount the same private media/model storage before enabling the feature. Render ephemeral storage/Vercel functions alone are insufficient for this self-hosted processing/storage architecture. No paid provider, storage account, DNS, production migration or activation is provisioned by these changes. Provider webhooks are not used in this local pipeline; adding an external video provider requires separately verified webhook signatures.

For local Docker use `docker compose -f docker-compose.yml -f docker-compose.reels.yml up -d` after existing local initialization. The overlay supplies persistent media/model volumes and system binary paths. Prepare model assets before accepting jobs; containers start inference in offline mode. This is configuration, not an executed production deployment.

## Verification

From backend, use the isolated TEST_DATABASE_URL and TEST_REDIS_URL from the existing handoff:

```powershell
node --import ./tests/bootstrap.js --test tests/reel-media.test.js tests/reel-ranking.test.js
$env:REELS_REAL_MEDIA_TESTS='true'
$env:REELS_EMBEDDING_CACHE_DIR='<private populated model cache>'
node --import ./tests/bootstrap.js --test tests/reel-real-media.test.js
node --import ./tests/bootstrap.js --test tests/integration/reels.test.js
node --import ./tests/bootstrap.js --test tests/integration/reels-lifecycle.test.js
```

Real-media tests run FFmpeg/FFprobe and the actual HF model; without the explicit flag they are visibly skipped. Router tests always use real Mongo/auth/transactions; without that flag only their expensive worker adapters are synthetic. Record that distinction. Browser tests use synthetic identities/API state and real generated HLS/video assets; they do not certify a live production account, physical camera or moderation quality.

From root: `node tools/run-browser-checks.mjs --grep 'reels'` can be too broad because test names may not contain reels; use `node tools/run-browser-checks.mjs reels.spec.js` for the full feature file. Run one browser suite at a time with source frozen. Run frontend lint/build and existing regression suites. See WORK_LOG for actual final executed results, initial diagnostic failures and limitations.

## Antigravity independent audit and handback report

Google Antigravity independently audited and verified the complete Doctor Reels implementation on 2-3 November 2026. Detailed findings, verified execution metrics, security and moderation invariants, and the operational production checklist are documented in [REELS_ANTIGRAVITY_REPORT.md](REELS_ANTIGRAVITY_REPORT.md).

Key outcomes of the Antigravity audit:
- Reconciled and verified baseline commit `da5d6d69`.
- Fixed Redis outage degradation in `backend/services/reelService.js`: initial feed now gracefully falls back to MongoDB-ranked candidates with `nextCursor: null` when Redis is unavailable, while cursor-based queries safely return 409 ("Feed expired; refresh").
- Implemented and verified the complete 15-step synthetic lifecycle test with all 7 synthetic identities in `backend/tests/integration/reels-lifecycle.test.js` (13 test groups passed in 11.68s with real media and real multilingual embeddings).
- Re-verified all 250 backend units, 17 reels integration tests, 29 regression tests, 62 frontend UI tests, and 10 desktop/mobile browser tests with zero failures.

Clinical efficacy, recommendation accuracy, load capacity, hardware camera compatibility and production operating acceptance are not claimed by passing software tests.

## Executed checks and operating boundary (3 November 2026)

250 backend units, 17 actual Mongo/router/media/model checks (including simulated Redis outage), 13 complete 15-step lifecycle checks, 29 existing socket/outbox/practice regressions, 62 frontend units, and 10 desktop/mobile browser cases passed with no failures. The backend run enabled the two real-media tests, so they were not skipped. Actual HF vectors, MP4 >300s refusal, HLS/JPEG outputs and browser-created missing-duration WebM were exercised. Final browser suite: 47.6s; Reels integration: 12.47s; Reels lifecycle: 11.68s; production build: 30.37s. Lint has zero errors and one existing AuthContext Fast Refresh warning. Production audits: zero backend/frontend advisories; full frontend audit retains seven moderate dev-tool advisories. Lazy HLS chunk ~599kB triggers a bundle warning. Docker Compose overlay parses; Docker image build/live activation, physical device/Safari and catalogue-scale load acceptance were not executed.

Technical references: [Hugging Face feature extraction](https://huggingface.co/docs/transformers.js/api/pipelines), [pinned multilingual model](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2), [Hls.js API](https://hlsjs.video-dev.org/api-docs/hls.js.hls).
