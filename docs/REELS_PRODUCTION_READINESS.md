# Doctor Reels: final engineering review and deployment steps

3 November 2026. Reviewed all changes from da5d6d69 through Antigravity commit 69fb1485, the original request, report, auth/media/ranking/outbox/schema implementation, and Render/Vercel configuration. Scope is Reels; unfinished enterprise hospital tracks remain unchanged.

## Verdict

**Locally verified implementation; production activation awaits approved infrastructure, schema and operating acceptance.** Recording/upload, independent review, publishing, adaptive playback and genuine behavioral recommendation features are implemented. No critical application defect was reproduced in Antigravity's Redis change, RBAC, media access or lease fencing. No application rewrite was needed.

No production account/data/index/configuration was changed, no service activated or purchased, and no deployment-console action taken. Only public read-only HTTP probes were performed. General health and a working SPA shell do not establish live Reels readiness.

## Findings and changes

1. Accepted Antigravity's only application change: Redis snapshot write failure returns MongoDB-ranked first-page results without pagination; cursor read failure/missing snapshot returns 409. Current publication, verification and reporter visibility are rechecked. The shared ioredis command timeout is five seconds; fallback is not instant failover. Existing global care readiness still requires Redis at boot: a boot outage leaves routes/workers gated until a healthy restart. That broader boundary was preserved.
2. Corrected a **false-positive Redis outage test**. Bootstrap selected memory Redis; getRedis() creates a fresh memory-client wrapper on each call, so patching one wrapper never affected feed(). An empty catalogue also made nextCursor=null meaningless. Both Reels files now ping isolated real Redis DB 15 with unique prefixes. The strengthened test creates 13 synthetic published candidates, proves real cursor paging works, then asserts that the actual reused client's asynchronous write/read failures were invoked: 12 useful results/no cursor on write failure, 409 on cursor read failure. This is injected command failure on a real client, not physical Redis-server failover certification.
3. Registered the omitted lifecycle file in backend/scripts/testIntegration.js: now 37 files. Its actual media/model workflow needs a prepared HF cache. Registration is not evidence that the whole runner passed.
4. Added real HF -> MongoDB -> authenticated playback/watch event -> actual feed-order verification. With otherwise equal candidates, heart-health viewing moves related content above dental content; replay does not duplicate watch credit; reset restores cold start; skip-only feedback moves away from the skipped semantic direction; opt-out clears signals. Only the synthetic playback clock is adjusted to avoid a 15-second wait. Directly published synthetic ranking fixtures test ranking; the separate lifecycle tests genuine independent publication.
5. Strengthened private/removed manifest, variant, segment and JPEG denials across roles, invalid-session denial and author-verification revocation. The earlier audit claimed broader removal coverage than its manifest-only assertions established.
6. Aligned frontend/.nvmrc from Node 23.7.0 to tested Node 24. Provider settings still require dashboard verification; this marker cannot establish the actual Vercel runtime.

Application routes, recommendation weights, auth, processing, outbox semantics, accounts and records were preserved. No critical production code fix was required beyond the existing accepted Redis patch.

## Requirement assessment

| Requirement | Independently established | Remaining operating boundary |
| --- | --- | --- |
| Verified doctors record/upload <=300s, preview, metadata/thumbnail | Actual API upload/replay, FFmpeg duration refusal, browser MediaRecorder WebM probe | Physical devices; trimming uses device editor |
| Independent review/publish and medical privacy | Explicit verified reviewer, exact version, self/unapproved/staff denial, edit withdrawal, attestations | Real qualified reviewer assignment and moderation operations |
| Adaptive secure playback | Real HLS/JPEG generation and decode, browser playback, private/original/removed/revoked-author denials | Authenticated live relay/Safari delivery and disk persistence |
| Social/discovery and integration | For You/Following/Explore/Saved, likes/comments/follows/reporting, profile/booking links, existing CSRF/session scope | Synthetic browser API/accounts; sharing depends on browser capability |
| Personalized recommendations | Actual model vectors plus consented watch/skip signals change API ordering; reset/opt-out/replay verified | No clinical efficacy, model training or catalogue-quality claim |
| Durability/concurrency/privacy | Actual outbox processing; stale/reclaimed start/success/failure fences, committed replay, upload-attempt fencing, consent/TTL schema | Real host crash/redeploy/restore and concurrent long-video capacity |

The model is Xenova/paraphrase-multilingual-MiniLM-L12-v2, pinned revision 2c4055b12046f11709e9df2c122e59ffbdc2f900, normalized 384D q8 CPU inference. Initialization is lazy and cached in the worker, not feed reads. Actual Hindi/English similarity and offline inference passed. The API order test uses English metadata; the separate model test exercises Hindi/English.

Personalization defaults off. When opted in, a time-decayed interest vector combines viewing/completion, likes/saves and skips. Ranking also uses semantic similarity, selected topics, follows, public quality, freshness and diversity/exploration. Fresh feed requests adapt; a cursor snapshot intentionally stays stable for up to ten minutes. Reset/opt-out deletes watch signals and changes cursor identity; explicit likes/saves/follows remain user actions. No symptoms, appointments or private clinical notes enter this model. This is genuine heuristic hybrid personalization, not random sorting or an online-trained patient model. Any future model change needs reviewed re-embedding/revision isolation.

Retrieval caps ranking at 300 recent + 100 popular candidates. This bounds in-memory ranking, not all MongoDB scan cost; substring search is not indexed full-text search. Antigravity's sub-100ms assertion for thousands of reels lacks a load test and is **not accepted**. Measure CPU/RAM, searches, disk growth and shared outbox notification latency during long transcodes before rollout. No new vector database is needed for this bounded pilot review.

## Executed checks

Host: Node 24.11.0, isolated MongoDB 7 replica set and Redis 7 DB 15, real prepared private model cache. Deployment environment files were never loaded.

| Check | Observed result |
| --- | --- |
| Targeted media/ranking/real-media units | 17 passed, 0 failed/skipped, 17.17s; actual FFmpeg and HF |
| Original Antigravity Reels/lifecycle baseline | 30 passed, 0 failed/skipped, 21.85s; before stronger Redis assertions |
| Corrected Reels/lifecycle plus existing p06 workflow regressions | 48 passed, 0 failed/skipped, 64.51s; transactions/socket/outbox |
| Final strengthened Reels/lifecycle | 32 passed, 0 failed/skipped, 36.45s: 18 Reels + 14 lifecycle |
| Frontend units | 62 passed, 0 failed/skipped |
| Lint/build | Zero errors, one existing AuthContext Fast Refresh warning; build passed 11.65s, lazy HLS ~599kB warning |
| Portable browser Reels suite | 10 passed, no failures/skips, 39.7s; desktop/mobile Chromium, synthetic API/identities/fake camera, real HLS/WebM probe |
| Fresh production dependency audits | Zero backend/frontend advisories |
| Compose base + Reels overlay parse | Passed |
| Actual backend Docker build | Passed, image medipulse-reels-review:local, ID sha256:39391d527972f3f55e5d9b7601d60b8843ee44918bcf55a82d8c48e084b93515 |
| Network-disabled Linux image runtime | Passed UID1000 / Node24.22.2: read-only actual model cache, offline 384D inference, private media writes, both adaptive H.264/AAC variants decoded, JPEG generated |

Docker runtime smoke is not a deployed API, persistent Render disk or restore test. Full unrelated backend/integration/browser suites were not repeated; prior counts remain historical. The seven moderate frontend development-tool advisories in Antigravity's full audit were not re-audited here; fresh production audits were clean. No force/downgrade was used.

Logs live under local %TEMP%: medipulse-reels-final-review-units.log; medipulse-reels-review-final-integration.log; medipulse-reels-review-critical-integration.log; medipulse-reels-review-ui.log; medipulse-reels-review-lint.log; medipulse-reels-review-build.log; medipulse-reels-review-browser.log; medipulse-reels-review-docker-build.log; medipulse-reels-review-docker-runtime.log. Browser artifacts: %LOCALAPPDATA%/MediPulse/Private/browser-checks-JgYMCW. Local Python encoding/path editing errors were corrected before final checks; they did not touch production.

## Live public evidence: 3 November 2026

- medipulse.live/reels and medi-pulse-gamma.vercel.app/reels returned HTTP200 SPA shells with public build revision 69fb14857f9a5aeb53aeee8e905717a59ba3b376. This proves frontend deployment identity at observation time, not authenticated feature behavior.
- medipulse.live/backend/health/ready and direct medipulse-4fi1.onrender.com/health/ready returned ready=true/HTTP200: MongoDB/Redis ready, queue/ledger/auth/durable/scheduling schemas ready, Kafka unavailable, mail configured. Configured mail is not observed delivery. Health does not inspect Reels indexes/storage/model/reviewers or expose backend commit identity.
- medipulse.live/backend/api/reels/feed returned HTTP401 JSON, Sign in is required. Relay reaches the API and anonymous access is denied. Authentication precedes Reels readiness, so this cannot prove feature flag/index status.
- Backend deployed SHA, dashboard settings, disk/plan, Reels flag/cache/indexes/reviewers and authenticated live workflow remain **unverified**. No connected deployment-console access was used.

## Activation blockers

1. render.yaml describes a native Node backend, npm install/npm start, with no persistent disk or Reels model/media preparation. It does not deploy the Dockerfile/Compose overlay. Approve persistent private storage/capacity/cost/backup and one API instance with its existing co-located outbox worker. A Render disk cannot be shared with another service/worker or multiple instances. Default storage is ephemeral.
2. Inspect and approve additive Reels indexes in the exact medipulse database after backup/rehearsal; require empty missing/conflict arrays. Global ready=true cannot establish this. No production inspection/apply occurred here.
3. Prepare persistent pinned model cache, actual host FFmpeg/FFprobe and writable private paths. A persistent Render disk is runtime-only; build/predeploy cache preparation cannot populate that mounted disk.
4. Owner must nominate qualified verified doctor reviewers. One approved independent reviewer can review a different creator; two listed IDs are not a code requirement. A reviewer publishing their own content needs another approved reviewer. Never auto-verify accounts or grant staff reviewer rights.
5. Keep Reels and enterprise flags false until approved activation. Actual live Reels flag has not been read. Close physical-phone/native-Safari, long/large upload, resource/timeout, restart persistence and rollback acceptance using approved synthetic content.
6. Agree retention, orphan cleanup, backup/restore, disk alerts and operator responsibility. No scheduled purge job was delivered; a proposed 90-day policy is not implemented physical deletion. Existing live Kafka degradation needs triage for its actual consumers, separately from Mongo outbox Reels processing.

## Exact approval-gated deployment steps

### 1. Freeze candidate and approvals

Record final review commit, current deployed frontend/backend SHAs, approved database medipulse, backup/recovery location, storage capacity and actual approved reviewer accounts. Obtain separate approval for index apply, infrastructure cost/deployment, then feature activation and any synthetic production records. These instructions were not executed.

### 2. Render runtime, persistence and configuration

Lowest-change path: preserve the existing native service/hostname medipulse-4fi1.onrender.com. Root Directory backend; Node24; install npm ci; start npm start; health /health/ready. Native npm ci must permit ffmpeg-static installation. Leave REELS_FFMPEG_PATH/REELS_FFPROBE_PATH unset when using those installed static binaries; verify both execute on the actual host. Do not copy Docker's --ignore-scripts install command into native runtime without system FFmpeg.

If choosing the locally tested Docker path, explicitly approve migration: Dockerfile backend/Dockerfile, build context backend, existing CMD npm start, health /health/ready; system binary paths /usr/bin/ffmpeg and /usr/bin/ffprobe. Preserve protected variables/routing. Do not silently create a second paid backend or switch Vercel's relay; a changed hostname requires its own reviewed relay update. Current render.yaml remains unchanged.

For either approved path, attach a persistent disk at /var/data, verify runtime-user write permission and absence of symlinks, and set:

    NODE_ENV=production
    REELS_ENABLED=false
    REELS_MEDIA_ROOT=/var/data/medipulse/reels
    REELS_EMBEDDING_CACHE_DIR=/var/data/medipulse/models
    REELS_EMBEDDING_ALLOW_DOWNLOAD=false
    REELS_MAX_UPLOAD_BYTES=209715200
    REELS_MAX_OUTPUT_BYTES=536870912
    REELS_PROCESS_TIMEOUT_MS=180000
    ENTERPRISE_PILOT_ENABLED=false

Set REELS_REVIEWER_DOCTOR_IDS in Render to owner-approved comma-separated verified doctor ObjectIds; the repository cannot safely prefill them. Leave REELS_EMBEDDING_LOCAL_MODEL_PATH unset unless an exact reviewed model directory is supplied. Retain existing secret DATABASE_URL/TOKEN_KEY/REDIS_URL and existing consumer/mail configuration. DATABASE_URL must explicitly name /medipulse. Do not expose these secrets through frontend env/reports.

CLIENT_URLS must include https://medipulse.live, https://www.medipulse.live and https://medi-pulse-gamma.vercel.app; preserve other approved Connect/app origins. Preserve FRONTEND_URL=https://medipulse.live. Keep cookie authentication, allowed Origin and account X-CSRF-Token.

### 3. Prepare cache and verify actual host

After the approved disk is mounted, in the backend runtime shell (Docker /app; native backend working directory), as the actual service user:

    mkdir -p /var/data/medipulse/reels /var/data/medipulse/models
    chmod 700 /var/data/medipulse/reels /var/data/medipulse/models
    npm run reels:prepare-model -- --download
    node --input-type=module -e 'import {embedReelText} from "./services/reelEmbedding.js"; const r=await embedReelText({title:"Synthetic deployment readiness check",language:"en"}); console.log({model:r.model,revision:r.revision,dimension:r.dimension});'

Preparation enables download only within its child process; permanent allow-download stays false. Alternatively transfer the approved complete pinned cache. Verify actual mounted-disk ownership (Docker UID1000); image-directory permissions alone do not establish mount permissions. Prove actual-host H.264/AAC transcode/decode and JPEG with approved synthetic material. Benchmark five-minute videos, RSS, event-loop/notification latency and upload/probe time before enabling jobs; supported processing timeout ceiling is 600000ms, not unlimited execution.

### 4. Inspect and apply approved indexes

With the already configured secret runtime environment:

    node --input-type=module -e 'import {requireDatabaseUrl} from "./util/databaseConfig.js"; if(new URL(requireDatabaseUrl(process.env)).pathname!=="/medipulse") throw Error("Stop: unexpected database target"); console.log("Database target confirmed: medipulse");'
    npm run reels:schema

Review missing/conflict names and backup/rehearsal evidence. **Only after exact production DB-change approval:**

    npm run reels:schema -- --apply --confirm-database=medipulse
    npm run reels:schema

Require empty missing/conflict arrays. Duplicate/conflicting index errors stop activation for reviewed repair; never delete documents/drop indexes to force success. Additive apply can leave partial additions on failure; inspect again. Recovery normally disables Reels while preserving data/indexes, not an automatic destructive rollback.

### 5. Vercel and relay acceptance

Existing frontend/vercel.json correctly orders /backend/:path* -> https://medipulse-4fi1.onrender.com/:path* before SPA fallback. Preserve when hostname is unchanged. After approval verify dashboard settings: Root Directory frontend; Vite; Node24.x; install npm ci; build npm run build; output dist; production branch main; VITE_BACKEND_URL=/backend or the existing same-origin default. No new domain is required. Never use VITE variables for DB/signing keys, model paths or reviewer IDs.

Verify public frontend build revision matches the approved candidate. With approved test accounts verify login/logout/account switching, cookie/CSRF mutations, raw upload, HLS/JPEG, private/removed denial and absence of public caching on personalized/media responses. Verify native Safari cookie delivery. Vercel external proxies have a documented 120-second response timeout: measure large/slow upload behavior through the actual relay. Async transcoding does not eliminate upload/probe/proxy limits; do not incorrectly apply serverless-function body limits to this external rewrite.

### 6. Pilot activation and rollback

After every blocker and owner acceptance, separately approve REELS_ENABLED=true and restart the single co-located API/outbox instance; leave enterprise off. Disabled Reels jobs are held. Use a creator, different approved reviewer and opted-in patient to verify the full workflow, manifest/segment/JPEG statuses, actual feed adaptation, reset/opt-out, credential revocation and removal. Creating synthetic production records needs its own approval. Record exact deployed pair and evidence.

Monitor failed/retried outbox jobs, disk growth, CPU/RAM, processing latency and existing notification latency. Rehearse approved persistence/restart/restore. On failure set REELS_ENABLED=false and restart; retain media/model disk and records, reverting application revision only if needed. Flag rollback holds future jobs but does not forcibly cancel an in-flight transcode; lease/version fences remain. Never truncate records/remove storage/drop indexes or rotate TOKEN_KEY as a rollback shortcut.

## Local reproduction

From repository root in PowerShell, start only local services and set explicit isolated targets:

    docker compose up -d mongo redis mongo-init
    $env:TEST_DATABASE_URL='mongodb://127.0.0.1:27017/medipulse_test?replicaSet=rs0&directConnection=true'
    $env:TEST_REDIS_URL='redis://127.0.0.1:6379/15'
    $env:REELS_REAL_MEDIA_TESTS='true'
    $env:REELS_EMBEDDING_ALLOW_DOWNLOAD='false'
    $env:REELS_EMBEDDING_CACHE_DIR=Join-Path $env:LOCALAPPDATA 'MediPulse\Private\reels-models'

From backend:

    node --import ./tests/bootstrap.js --test tests/reel-media.test.js tests/reel-ranking.test.js tests/reel-real-media.test.js
    node --import ./tests/bootstrap.js --test --test-concurrency=1 tests/integration/reels.test.js tests/integration/reels-lifecycle.test.js tests/integration/p06-workflows.test.js

The full registered integration runner needs the same actual cache but was not run here. Frontend: npm run test:ui, npm run lint, npm run build. Root browser: node tools/run-browser-checks.mjs reels.spec.js --timeout 45000; one runner at a time, app/spec source frozen.

## Provider references checked

- [Render disks](https://render.com/docs/disks): paid persistence, runtime-only access and single-instance constraints; no purchase performed.
- [Render Blueprint reference](https://render.com/docs/blueprint-spec): runtime/build context and disk settings.
- [Vercel external-origin timeout](https://vercel.com/docs/errors/router_external_target_error): 120 seconds.
- [Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions): verify supported Node24 settings, not the old Node23 marker.
