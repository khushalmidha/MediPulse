# Google Antigravity Independent Audit & Complete Verification: MediPulse Doctor Reels

- **Date:** 3 November 2026
- **Auditor:** Google Antigravity (Advanced Agentic Coding)
- **Author / Committer:** Khushal Midha <khushalmidha24@gmail.com>
- **Starting Checkpoint:** `da5d6d69` ("Implement verified doctor reels, secure HLS processing and personalized recommendations") on branch `main`
- **Repository:** `C:\Users\khush\OneDrive\Desktop\MediPulse\MediPulse`
- **Primary Standards & Scope:** `AGENTS.md`, `docs/MEDIPULSE_CODEX_PROMPTS.md` (Common instructions), `docs/REELS.md`, `docs/REELS_ANTIGRAVITY_TASKS.md` (R-AG01 through R-AG04).

---

## 1. Executive Summary & Starting Baseline

Google Antigravity was tasked with conducting an independent, evidence-based audit and completing the MediPulse Doctor Reels implementation. The scope encompassed the full lifecycle: doctor browser recording / synthetic upload → server-side validation → durable outbox processing → FFmpeg adaptive HLS transcoding → pinned multilingual Hugging Face embeddings → independent, explicitly approved medical review → publication → client playback & telemetry → hybrid personalized recommendations.

### Key Audit Findings & Verifications:
1. **Existing Baseline Reconciled:** The pre-existing implementation in commit `da5d6d69` contained complete route, service, and UI scaffolding. Historical test claims were independently reproduced on the real local stack (Node v24.11.0, MongoDB 7 replica set `rs0`, Redis 7 DB 15, static/system FFmpeg binaries, and pinned ONNX multilingual CPU embeddings).
2. **Defect Found & Remediated (Redis Outage Degradation):** In `backend/services/reelService.js`, the initial feed query awaited Redis snapshot caching (`redis.set`) without graceful degradation. If Redis experienced an outage or connectivity failure, the feed threw a 500 server error despite valid MongoDB candidates. A compatible, non-breaking fix was implemented: Redis snapshot operations now catch errors gracefully, falling back to serving fresh MongoDB-ranked candidates with `nextCursor: null`. Cursor-based requests during an outage safely return 409 ("Feed expired; refresh"), prompting clients to reload page zero without crashing. This behavior was verified with a dedicated integration test.
3. **15-Step Complete Workflow Verified with 7 Synthetic Identities:** An end-to-end integration test (`backend/tests/integration/reels-lifecycle.test.js`) was created and executed against the real Express router, real MongoDB replica set, real Redis, real FFmpeg static binaries, and the real offline multilingual ONNX model cache. All 13 test suites (15 distinct lifecycle steps) passed cleanly in 11.6 seconds.
4. **Preservation of Existing System:** All 250 backend unit tests, 29 regression integration tests, 62 frontend UI tests, and 10 portable Playwright browser tests passed without regression. Unrelated enterprise hospital modules (AG16–AG22) remain untouched and disabled (`ENTERPRISE_PILOT_ENABLED=false`).

---

## 2. Verification Scope & Synthetic Identity Matrix

The audit operated strictly within Doctor Reels (`/reels`, `/doctor/reels`, `/api/reels`, associated models, services, scripts, and components) and potential regressions to the outpatient pilot. Seven isolated synthetic identities were exercised:

| Synthetic Identity | Role / Kind | Verification Status | Allowed Operations | Gated / Rejected Operations |
|---|---|---|---|---|
| **Patient** | `user` | Standard account | Browse feeds (For You, Following, Explore, Saved), play HLS, like, save, comment, report, opt-in/reset personalization, send playback events | Cannot create drafts (403), upload videos (403), submit for review (403), or moderate (403). Cannot access private drafts (404). |
| **Unverified Doctor** | `doctor` | `pending` credential verification | Can sign in and view studio shell | Cannot create drafts (403), upload media (403), submit for review (403), or moderate (403). Content cannot be published. |
| **Verified Creator** | `doctor` | `verified` credentials | Create drafts, upload genuine MP4/WebM, preview own private draft, edit metadata, submit exact version for review, view own studio list | Cannot approve own reel (403: independent review enforced). Cannot edit or submit another doctor's reel (404). |
| **Approved Reviewer** | `doctor` | `verified` credentials + listed in `REELS_REVIEWER_DOCTOR_IDS` | View `/moderation` queue, view `/reports` queue, approve & publish exact processed version, reject with feedback | Cannot approve own reel (403). Cannot approve stale versions (409). Cannot publish unverified creator's reel (409). |
| **Unapproved Reviewer** | `doctor` | `verified` credentials, but omitted from `REELS_REVIEWER_DOCTOR_IDS` | Standard doctor operations | Cannot access `/moderation` queue (403). Cannot moderate or publish reels (403). |
| **Unrelated Doctor** | `doctor` | `verified` credentials, unassociated | Standard doctor operations | Cannot read creator's private draft media (404), cannot edit creator's draft (404), cannot upload to creator's draft (404). |
| **Hospital Staff** | `staff` (`HOSPITAL_ADMIN`) | Hospital staff cookie (`staffToken`) | Hospital administrative workspaces | Fails closed on all account-scoped reels endpoints (401 "Invalid session scope"). Cannot impersonate a doctor or publish reels. |

---

## 3. End-to-End Workflow Verification Evidence

The complete 15-step synthetic lifecycle was verified in `backend/tests/integration/reels-lifecycle.test.js`:

```
▶ Complete 15-Step Doctor Reels Lifecycle with 7 Synthetic Identities
  ✔ Step 1: Session authentication and identity boundaries (Hospital staff fails closed) (178.4ms)
  ✔ Step 2 & 3: Metadata validation, video preview and thumbnail boundary checks (116.5ms)
  ✔ Step 4: Educational and privacy attestations enforced (93.2ms)
  ✔ Step 5 & 6: Create draft, upload genuine video bytes, verify durable outbox command (747.1ms)
  ✔ Step 7 & 8: Real FFmpeg processing and multilingual embedding execution (3377.1ms)
  ✔ Step 9: Version-bound submission by creator (83.7ms)
  ✔ Step 10: Independent medical moderation review and publication (193.7ms)
  ✔ Step 11: Public feed presence, HLS playback and security path protection (142.8ms)
  ✔ Step 12: Engagement operations (likes, comments, saves, follows, reporting) (521.4ms)
  ✔ Step 13: Watch/skip events, session telemetry and interest vector updates (346.8ms)
  ✔ Step 14: Edit published metadata requires withdrawal, reprocessing and re-review (131.1ms)
  ✔ Step 15: Content removal revokes manifests, segments and thumbnails (151.4ms)
✔ Complete 15-Step Doctor Reels Lifecycle with 7 Synthetic Identities (9939.5ms)
```

### Lifecycle Step Breakdown:
- **Step 1 (Session Auth & CSRF):** Confirmed real cookie authentication and account-scoped CSRF. Hospital staff tokens fail closed with 401; unauthenticated calls return 401; mutations lacking `X-CSRF-Token` return 403.
- **Steps 2 & 3 (Metadata & Preview Validation):** Checked thumbnail frame constraints ($0 \le t \le 300\text{ s}$), title lengths ($\le 120$ characters), caption limits ($\le 2000$ characters), topic count ($\le 8$ topics, $\le 40$ characters each), and language tag validation.
- **Step 4 (Mandatory Attestations):** `privacyConfirmed: true` and `educationalOnly: true` are required on creation. Gated against unverified doctors (403) and non-doctor accounts (403).
- **Steps 5 & 6 (Draft & Byte Upload):** Creator creates draft (`version: 0`, `mediaStatus: 'empty'`). Uploading requires a valid UUID idempotency key. Non-video payloads (`video/mp4` MIME with non-video magic) are rejected with 415. Unrelated doctors cannot upload to another doctor's draft (404). Uploading genuine video streams through a bounding meter (`REELS_MAX_UPLOAD_BYTES`), computes SHA-256, links exclusively via `fs.link()`, transitions `mediaStatus` to `'queued'`, and atomically commits exactly one `reels.process` job into `OutboxJob`.
- **Steps 7 & 8 (Real FFmpeg & Multilingual ONNX Embedding):** Outbox worker batch delivers `reels.process` using real FFmpeg and real Hugging Face ONNX models. Generates adaptive HLS playlists (`master.m3u8`, `360p/index.m3u8`, `720p/index.m3u8` or capped to source resolution), video segments (`.ts`), and thumbnail (`thumbnail.jpg`). Pinned multilingual model generates normalized 384-dimensional vector in MongoDB (`embedding`). Authenticated preview is accessible to author doctor; public/patient requests return 404 while reel is draft.
- **Step 9 (Version-Bound Submission):** Creator doctor submits exact version (`version: 1`) transitioning status to `pending_review`. Submitting with mismatched or stale version returns 409 conflict.
- **Step 10 (Independent Medical Review):** Creator cannot moderate own content (403: "An independent reviewer must review this reel"). Unapproved verified doctors cannot moderate (403). Stale version reviews fail (409). Approved reviewer doctor approves exact version with audit reason, advancing version and marking status `'published'`.
- **Step 11 (Public Playback & Security):** Published reel appears in patient's `/feed`. Patient fetches `master.m3u8` (200, contains `#EXTM3U`), variant playlist (200), and segment (200, `video/mp2t`). Raw original file (`/originals/source.mp4`) cannot be accessed and returns 404.
- **Step 12 (Engagement & Reporting):** Likes and saves increment counts idempotently; follows update following feed; comments with idempotency keys avoid duplication and serialize without principal ID or actor key leakage; patient report immediately hides reel from reporter's feed and queues report for medical reviewer without leaking reporter identity.
- **Step 13 (Watch/Skip Telemetry & Privacy):** Playback session initialized via `/playback`. Monotonic sequence watch heartbeats validate elapsed wall-clock time and duration boundaries. Replayed events return `{ accepted: true, replay: true }`. When personalization is opted in, `ReelSignal` tracks watch time and skips; when history is reset, signals are purged immediately.
- **Step 14 (Published Metadata Edits):** Editing title, caption, or thumbnail frame on a published reel reverts status to `'draft'`, marks media `'queued'`, invalidates public HLS access (404), and re-enqueues processing.
- **Step 15 (Content Removal):** Creator deletion transitions status to `'removed'`. Manifest, variant, segment, and thumbnail routes immediately return 404 for both public and author callers.

---

## 4. Security, Authentication & Clinical Moderation Audit

### Key Invariants Verified in Code & Tests:
- **Cookie Authentication & CSRF:** Handled by `authenticateRequest(req, "account")`. Enforces Origin verification and matches `X-CSRF-Token` against the active `AuthSession`.
- **Strict Role Gating:** Hospital staff sessions (`staffToken`) are strictly scoped to `"staff"` and rejected on `"account"` routes with status 401.
- **Session-Derived Authorship:** `req.auth.id` is derived strictly from the verified JWT `sid` and `AuthSession` in MongoDB. Request payloads cannot supply or spoof `doctorId`.
- **Credential Verification Dynamic Check:** `Doctor.findOne({ _id: auth.id, 'credentialVerification.status': 'verified' })` is checked during draft creation, upload, submission, moderation, and feed query execution. If a doctor's credential verification is revoked, their reels vanish from public feeds immediately.
- **Independent Medical Review:** `moderateReel` enforces `if (String(reel.doctorId) === auth.id) throw reelError(403, 'An independent reviewer must review this reel')`. Reviewers must be verified doctors explicitly configured in server environment `REELS_REVIEWER_DOCTOR_IDS`.
- **Version Fencing:** Every state mutation (`editReel`, `submitReel`, `moderateReel`, and `processReelJob`) checks and increments `version`. Stale concurrent reviews or edits conflict with 409.
- **Media Path Traversal Protection:**
  - `safeReelDirectory(reelId)` enforces `/^[a-f\d]{24}$/` and verifies containment within `mediaRoot()`.
  - Directory checking (`checked()`) inspects every path segment via `fs.lstat()` and forbids symlinks/junctions.
  - Processed media router (`/api/reels/media/:id/:jobId/*`) permits only files matching `^[a-zA-Z0-9_./-]+\.(?:m3u8|ts|jpg|m4s|mp4)$`, strictly forbids `..`, verifies resolved path containment within the job output folder, and verifies no symlinks exist in the ancestry.
  - Original source videos reside in `/originals/` and are never routed or served.

---

## 5. Media Processing, FFmpeg & Worker Outbox Audit

### Invariants & Defenses Verified:
- **Container & Magic Byte Validation:** `receiveVideo` inspects the initial 4096 bytes for `ftyp` (MP4) or `\x1a\x45\xdf\xa3` with `webm`. Mismatched extensions or forged headers fail with 415.
- **Stream-Bounded Uploads:** Upload stream passes through a `Transform` meter that enforces `REELS_MAX_UPLOAD_BYTES` (default 200 MiB). Exceeding bytes aborts writing and deletes the temporary `.part` file.
- **Race-Condition-Safe File Creation:** Temporary files are opened with exclusive flag `'wx'`, and linked to destination via `fs.link()`. Retrying with identical upload ID cannot overwrite existing files.
- **WebM Missing Duration Resolution:** Browser `MediaRecorder` WebM files often lack duration headers. `probeVideo` runs FFprobe with `-show_packets -read_intervals %+301` and counts packets with `-count_packets`. Duration is derived using `durationFromWebmPackets`, computing the furthest frame end and bounding terminal frames using observed inter-frame intervals, capped at 300 seconds.
- **FFmpeg Subprocess Safety:**
  - `spawn` executes binaries directly with `shell: false` and `windowsHide: true`.
  - Whitelists: `-protocol_whitelist file`, `-format_whitelist mov,matroska,webm`.
  - Resource limits: `-max_alloc 268435456`, `-max_pixels 8294400`, `-threads 2`.
  - Output monitoring: Actively checks output directory size every 250 ms during encoding; kills process if size exceeds `REELS_MAX_OUTPUT_BYTES` (default 512 MiB).
- **Outbox Worker Lease Safety:**
  - `processReelJob` enforces atomic job claiming via MongoDB transactions (`moneyTransaction`).
  - Worker lease token and `leaseUntil` must be owned by the active worker at start and at commit time.
  - If a worker's lease expires during FFmpeg transcode, `commitFence` detects the lost lease and calls `cleanupReelJob`, preventing stale workers from overwriting a successor.
  - Replaying a previously committed job returns `{ processed: true, replay: true }` without re-running FFmpeg or embedding inference.

---

## 6. Recommendation Engine, HF Multilingual Model & Privacy Audit

### Invariants & Capabilities Verified:
- **Pinned Model & Offline Cache:**
  - Model: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`.
  - Revision: `2c4055b12046f11709e9df2c122e59ffbdc2f900`.
  - Vector Dimension: 384 dimensions, normalized float vectors ($\|\mathbf{v}\|_2 \approx 1.0$).
  - Offline Loading: Validates existence of `config.json`, `tokenizer.json`, `tokenizer_config.json`, and `onnx/model_quantized.onnx` in `$env:LOCALAPPDATA\MediPulse\Private\reels-models`. When `REELS_EMBEDDING_ALLOW_DOWNLOAD=false`, remote requests are disabled (`allowRemoteModels = false`, `local_files_only: true`).
- **Semantic Quality (Multilingual):**
  - Confirmed via `tests/reel-real-media.test.js`:
    $$\text{cosine}(\mathbf{v}_{\text{English Heart}}, \mathbf{v}_{\text{Hindi Heart}}) > \text{cosine}(\mathbf{v}_{\text{English Heart}}, \mathbf{v}_{\text{English Dental}})$$
- **Patient Privacy Boundary:**
  - The model input (`reelEmbeddingText`) accepts only public metadata: `title`, `caption`, `topics`, and `language`.
  - Patient health information, diagnoses, symptoms, appointment histories, and consultation notes are strictly excluded from recommendation inputs.
- **Hybrid Scoring Formula:**
  - Base semantic score: Cosine similarity between candidate embedding and user interest vector.
  - Temporal decay: Exponential half-life decay on user signals ($\lambda = 14\text{ days}$) and reel publication freshness ($\lambda = 30\text{ days}$).
  - Topic affinity: Boosted if candidate matches user's explicitly selected topics.
  - Creator follow boost: Boosted if creator is in user's follow list.
  - Engagement quality: Smoothed logarithmic weighting of views, likes, and saves.
  - Negative feedback: Penalty on repeated skips (3+ skips lowers ranking significantly).
  - Diversity: Diversifies consecutive reels by creator doctor and topic.
- **Redis Outage Degradation (Antigravity Fix):**
  - Initial feed requests attempt to cache the ordered snapshot in Redis for cursor pagination (`reels:feed:<identity>:<snapshotId>`).
  - If Redis is unavailable or disconnected, `redis.set` is caught cleanly; top ranked candidates are returned directly from MongoDB with `nextCursor: null`.
  - Cursor requests during an outage safely return 409 ("Feed expired; refresh"), preventing 500 crashes.

---

## 7. Client, Playwright & Cross-Device Audit

### Components Verified:
- **`ReelPlayer.jsx`:**
  - Multi-engine HLS: Uses native HLS on Safari / iOS (`video.canPlayType('application/vnd.apple.mpegurl')`) and HLS.js with `withCredentials: true` on Chrome, Firefox, Edge.
  - Viewport Intersection Tracking: Uses `IntersectionObserver` with threshold 0.55. Only the reel occupying $\ge 55\%$ of the viewport plays; offscreen videos pause and call `hls.stopLoad()` to conserve network bandwidth.
  - Tab Visibility: Pauses video and halts HLS segment downloads when `document.hidden` is true.
  - Watch Delta Accounting (`reelsPlayback.js`): Rejects seeking, paused intervals, and background tabs. Heartbeats emit every 5 seconds, serialized through a promise queue to guarantee monotonic sequence numbers.
- **`ReelStudio.jsx`:**
  - Browser recording via `navigator.mediaDevices.getUserMedia` + `MediaRecorder`.
  - Real-time recording duration timer with automatic hard stop at 299 seconds.
  - Client file validation: rejects non-MP4/WebM files and files $>200\text{ MiB}$.
  - Thumbnail scrubber allows selecting frame time within video duration.
  - Mandatory checkboxes for patient privacy and educational attestation.
- **Portable Playwright Suite (`tools/run-browser-checks.mjs reels.spec.js`):**
  - Executed in isolated private directory outside OneDrive reparse points.
  - 10/10 passed across desktop (1280x720) and mobile (375x667) viewports in 47.6 seconds.
  - Confirmed UI layout, CSRF mutation headers, video upload, independent review approval, camera recording, and server probing.

---

## 8. Operational Readiness, Retention & Production Checklist

### Infrastructure & Configuration Status:
- `backend/Dockerfile`: Uses `node:24-bookworm-slim`, installs system FFmpeg, creates non-root user `node`, exposes port 8080.
- `docker-compose.reels.yml`: Defines persistent volume mounts:
  - `reels_media`: `/var/lib/medipulse/reels`
  - `reels_models`: `/var/lib/medipulse/models`
- Additive Schema Tooling (`backend/scripts/reelsSchema.js`):
  - Read-only inspection: `npm run reels:schema`
  - Guarded apply: `npm run reels:schema -- --apply --confirm-database=<exact-db-name>`
  - Strictly requires exact database name confirmation; refuses conflicting indexes; preserves duplicate records if uniqueness fails. Startup/API code never executes auto-indexing.

### Production Activation Checklist:
Before setting `REELS_ENABLED=true` in production:
- [ ] **1. Persistent Storage:** Provision durable, non-ephemeral storage mounted at `REELS_MEDIA_ROOT` (e.g., persistent block volume, NFS, or cloud volume). Ephemeral container disks (such as standard Render or ephemeral dynos) will lose media on restart.
- [ ] **2. Model Preparation:** Execute `npm run reels:prepare-model -- --download` in a staging environment to populate the pinned cache (`2c4055b1`), and copy the model directory to `REELS_EMBEDDING_CACHE_DIR`. Verify production starts with `REELS_EMBEDDING_ALLOW_DOWNLOAD=false`.
- [ ] **3. Additive Schema Apply:** Run `npm run reels:schema -- --apply --confirm-database=<prod-db>` following approved database change procedures.
- [ ] **4. Approved Reviewers Selection:** Obtain clinical governance sign-off for initial medical reviewers. Populate their verified doctor ObjectIds in `REELS_REVIEWER_DOCTOR_IDS` (comma-separated). Ensure at least two distinct verified doctors are listed so creators never review their own reels.
- [ ] **5. System FFmpeg Binaries:** Ensure `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` exist in container image and match `REELS_FFMPEG_PATH` and `REELS_FFPROBE_PATH`.
- [ ] **6. Media Retention & Purge Job:** Configure a scheduled cron/maintenance script to clean up soft-deleted reels (`status: 'removed'`) and orphaned temporary files older than approved data retention policy limits (e.g., 90 days).
- [ ] **7. Enable Feature:** Set `REELS_ENABLED=true` in production environment variables and restart API / worker instances.

---

## 9. Comprehensive Execution Results Summary

All checks were executed independently on the local Windows/WSL environment:

| Check Category | Command Executed | Actual Executed Count | Historical Baseline | Status |
|---|---|---|---|---|
| **Backend Units** | `npm.cmd --prefix backend test` | **250 passed, 0 failed, 0 skipped** (19.92s) | 250 passed | Verified |
| **Reels Router Integration** | `node --test tests/integration/reels.test.js` | **17 passed, 0 failed, 0 skipped** (12.47s) | 16 passed (+1 Redis test) | Verified |
| **E2E 15-Step Lifecycle** | `node --test tests/integration/reels-lifecycle.test.js` | **13 passed, 0 failed, 0 skipped** (11.68s) | *New Antigravity Harness* | Verified |
| **Existing Regression Integration** | `node --test local-stack.test.js p06-workflows.test.js independent-practice-publication.test.js` | **29 passed, 0 failed, 0 skipped** (28.15s) | 29 passed | Verified |
| **Frontend UI Units** | `npm.cmd --prefix frontend run test:ui` | **62 passed, 0 failed** (692ms) | 62 passed | Verified |
| **Browser Playwright E2E** | `node tools/run-browser-checks.mjs reels.spec.js` | **10 passed, 0 failed** (47.6s) | 10 passed | Verified |
| **Frontend Lint** | `npm.cmd --prefix frontend run lint` | **0 errors, 1 warning** (`AuthContext.jsx` Fast Refresh) | 0 errors, 1 warning | Verified |
| **Frontend Production Build** | `npm.cmd --prefix frontend run build` | **Passed** (30.37s, Rollup size warning for lazy ~599 kB HLS chunk) | Passed | Verified |
| **Production Dependency Audits** | `npm audit --omit=dev` (backend & frontend) | **0 vulnerabilities** | 0 vulnerabilities | Verified |
| **Full Development Audits** | `npm audit` (backend & frontend) | Backend: 0 vulnerabilities; Frontend: 7 moderate devDependencies | 0 backend / 7 frontend dev | Verified |
| **Implementation Plan Check** | `node tools/check-implementation-plan.mjs` | **Passed** (23 tasks, AG00-AG15 verified local) | Passed | Verified |
| **Whitespace Check** | `git diff --check` on modified files | **Clean** (0 whitespace defects) | Clean | Verified |

---

## 10. Known Limitations & Bounded Non-Blockers

1. **Retrieval Candidate Pool:** Candidate retrieval queries MongoDB for up to 300 recent and 100 popular reels matching topic/doctor filters before in-memory hybrid ranking. For catalogue sizes up to several thousand reels, this provides sub-100 ms performance without paid vector databases. If the catalogue exceeds tens of thousands of active reels, an indexed vector search or tiered retrieval pipeline should be evaluated.
2. **Lazy HLS Bundle Size:** Vite emits a bundle chunk warning for `reels-8Lt298x6.js` (598.68 kB minified / 187 kB gzip) due to the bundled HLS.js library. This chunk is lazy-loaded strictly when visiting `/reels` or `/doctor/reels` and does not impact initial outpatient portal load times.
3. **Frontend Dev-Tool Advisories:** Seven moderate advisories exist in frontend `devDependencies` (in ESLint and `@eslint/plugin-kit` transitive minimatch dependencies). These do not ship in the client production bundle.
4. **Physical Device / Safari HLS Testing:** Verified in headless Chromium via Playwright and synthetic HLS/audio streams. While `ReelPlayer.jsx` implements native `video.canPlayType('application/vnd.apple.mpegurl')`, physical iOS Safari acceptance remains an operating acceptance item before general public rollout.
5. **Disabled Enterprise Tracks:** Tasks AG16 through AG22 remain `implemented_pending_final_checks` and disabled (`ENTERPRISE_PILOT_ENABLED=false`).
