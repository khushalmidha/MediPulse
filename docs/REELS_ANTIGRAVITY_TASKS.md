# Doctor Reels: independent Antigravity review tasks

Status: prepared for file-based handoff; not dispatched or accepted by Antigravity. This Codex session has no direct Antigravity delegation tool. Each task below can be executed separately by an available independent reviewer. A checklist or source file is not evidence that its criteria passed.

Read root `AGENTS.md` and the Common instructions in `docs/MEDIPULSE_CODEX_PROMPTS.md`. Work from this repository's root. Preserve unrelated edits. Use synthetic accounts and isolated local Mongo/Redis fixtures only; never import deployment `.env` files or patient data. Production index creation, deployment, provider activation and paid services remain outside these review tasks. Record exact revision, commands, counts, artifacts, limitations and remaining failures. Keep actual model inference, synthetic vector checks, mocked-browser checks and real-device checks distinct.

## R-AG01: API, authorization and durable processing review

Owner: independent backend/security reviewer. Read scope: `backend/model/reel.js`, `backend/routes/reels.js`, `backend/services/reelService.js`, `backend/services/reelProcessing.js`, `backend/services/outbox.js`, `backend/scripts/reelsSchema.js`, authentication middleware and the `/api/reels` mount in `backend/index.js`. Edit ownership: `backend/tests/integration/reels.test.js` (route/domain/security and worker assertions); report implementation fixes to the coordinating owner before editing services shared with another task.

Exercise actual mounted routes with synthetic patient, unverified doctor, verified doctor, approved independent reviewer and unrelated owner sessions. Cover `/feed`, `/mine`, `/moderation`, `/reports`, `/preferences`, create/edit/upload/submit/retry/moderate/delete, follows, reactions, comments, reporting, playback and events. Require server-side verification for publishing; separate reviewer and author; bind decisions to the reviewed version; deny private/original/removed media and cross-owner writes. Inspect authenticated HLS segments and thumbnails as well as manifests. Test idempotent concurrent commands, conflicting payload replays, bounded watch-time credit and counter updates. Require disabled/missing schema to fail clearly without startup schema mutation.

For processing, prove stale/reclaimed worker leases cannot publish old media or overwrite a newer version, failed inference never substitutes fake vectors, retry remains possible and cleanup never removes another worker's output or source original. Review transaction and lease fencing, including failure paths. Add regression tests for discovered defects; do not replace database behavior with mocks when claiming transaction/concurrency coverage.

Targeted commands from `backend`, using explicit isolated `TEST_DATABASE_URL` and `TEST_REDIS_URL` accepted by existing test-target guards:

```powershell
node --import ./tests/bootstrap.js --test tests/reel-media.test.js tests/reel-ranking.test.js
node --import ./tests/bootstrap.js --test --test-concurrency=1 tests/integration/reels.test.js
```

Acceptance: the integration file actually executes; no missing/skipped-service result counts as a pass. Report isolation, fixture cleanup, every denial and replay/race assertion, and any remaining release blocker. Never run schema `--apply` against production as part of this task.

## R-AG02: actual media and multilingual model verification

Owner: independent media/runtime reviewer. Read scope: `backend/services/reelMedia.js`, `backend/services/reelEmbedding.js`, worker call sites and the authenticated media route. Edit ownership: new focused runtime/security tests in `backend/tests/`; coordinate helper changes with the owner.

From `backend`, first run:

```powershell
node --test tests/reel-media.test.js tests/reel-ranking.test.js
node --input-type=module -e "const f=await import('ffmpeg-static');const p=await import('ffprobe-static');console.log({ffmpeg:!!f.default,ffprobe:!!p.default.path})"
```

Add and execute a real runtime test using those installed binaries and an exclusive temporary `REELS_MEDIA_ROOT`. Generate a short synthetic MP4 and WebM; upload via `receiveVideo`, call `probeVideo` and `processVideo`, inspect master/variant manifests, decode generated segments and JPEG, and remove only the test-owned directory. Verify bounded source-height variants, no upscaling, finite duration, compatible H.264/AAC output and local relative segment URLs. Exercise malformed/container-mismatch files, oversized streams, interrupted upload cleanup, excessive duration/dimensions, path traversal, symlinks/junctions, timeouts and bounded outputs. Probe validation alone does not establish full transcode success.

For actual inference use `embedReelText` with public synthetic English and Hindi health-topic metadata and unrelated topics. Default `REELS_EMBEDDING_ALLOW_DOWNLOAD` is false: first prove a missing local model gives a clear retryable failure. With a previously approved local cache, or explicit free local-model-download opt-in (`REELS_EMBEDDING_ALLOW_DOWNLOAD=true`), verify finite normalized 384-dimensional vectors and returned model/revision. `REELS_EMBEDDING_LOCAL_MODEL_PATH` and `REELS_EMBEDDING_CACHE_DIR` configure local files/cache. Verify initialization is lazy in the worker: ordinary feed/interaction requests must not initialize or download the model. No API keys, paid provider activation or patient text are needed. Pin the test fixture and record semantic similarity measurements rather than claiming broad recommendation quality from a few examples.

Acceptance: execute and report real CPU inference and actual transcode/decode, or explicitly identify which dependency/cache/network constraint prevented each. At handoff authoring, backend static-binary dependency installation was still running; no successful binary or inference run was established by this handoff. The pure ranking tests use hand-authored vectors; they are not evidence of actual multilingual model behavior.

## R-AG03: feed, studio and browser verification

Owner: independent frontend/accessibility reviewer. Read scope: `frontend/src/pages/Reels.jsx`, `ReelStudio.jsx`, `frontend/src/components/reels/`, `frontend/src/utils/reels.js`, `reelsPlayback.js`, authentication context and `/reels` plus `/doctor/reels` routes in `frontend/src/App.jsx`. Edit ownership: `frontend/e2e/reels.spec.js` and focused frontend tests; coordinate product fixes with the frontend owner.

From `frontend` run the focused playback tests, affected-file lint and production build:

```powershell
node --test src/utils/reelsPlayback.test.mjs
npx --no-install eslint src/pages/Reels.jsx src/pages/ReelStudio.jsx src/components/reels src/utils/reels.js src/utils/reelsPlayback.js
npm run build
```

Add a synthetic browser spec covering signed-out entry; feed/search/topic/saved states; follow, reaction, comments and reporting; loading/error/retry/empty states; pagination with no duplicates; shared reel links; preference opt-out; doctor-only studio; upload preview and progress; recording permission denial/cancellation; processing/retry; attestation and independent review controls. Test keyboard focus, dialog close/focus return, readable mobile layout, reduced-motion behavior and permission labels. Test exactly one active player, offscreen/hidden-tab pause, muted autoplay, explicit unmute, playback-credit cancellation on unmount and HLS cleanup. Mocking successful media responses does not demonstrate real HLS decode or camera/device support.

After adding the spec, run from the repository root, one browser suite at a time, with no source/spec edits during execution:

```powershell
node tools/run-browser-checks.mjs reels.spec.js
```

Acceptance: report actual browser/project/viewport results, screenshots or traces and console failures. Keep manual camera/microphone, Safari/native HLS and physical mobile acceptance explicitly pending until observed. Do not label code inspection as rendered-browser evidence.

## R-AG04: ranking and privacy review

Owner: independent recommendation/privacy reviewer. Read scope: `backend/services/reelRanking.js`, `reelEmbedding.js`, feed/preferences/events handling in `reelService.js`, model projections and API serializers. Edit ownership: `backend/tests/reel-ranking.test.js` and an independent review report; coordinate shared-source edits.

From `backend`:

```powershell
node --test tests/reel-ranking.test.js
```

The authored baseline currently has ten passing pure tests: vector edge cases; explicitly synthetic multilingual semantics; positive interest signals and recency; follow/topic preferences; cold start and smoothed quality; repeated exposure/skips and negative feedback; creator/topic diversity; deterministic ordering and input preservation. Rerun them on the reviewed revision. Review opt-out and reset behavior at service/database level, data retention, cursor consistency, read projections, duplicate-event protection and the use of only educational reel metadata/engagement. Ensure clinical records, symptoms and patient embeddings never enter recommendation features. Check malformed/nonfinite vectors and mixed model revisions, not merely happy-path similarity.

Acceptance: identify which assertions are pure ranking tests versus database/privacy guarantees. Real multilingual quality requires R-AG02 evidence; a deterministic synthetic ranking pass cannot close that requirement. Report any fairness, diversity, pagination or retention limitation concretely without inventing measured quality claims.

## Evidence handback

For each task return: task ID and reviewer identity; exact candidate revision plus dirty-file scope; files reviewed/changed; commands and pass/fail/skip counts; synthetic fixtures and artifact paths; actionable defects with file/line references; acceptance criteria still open. The coordinating owner reconciles findings into the project ledger and decides release readiness. These prepared tasks do not establish external review, completed delegation or production approval.
