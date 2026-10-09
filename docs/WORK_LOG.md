# MediPulse work log

## P01 - Credentials, public data and authorization

Date: 8 October 2026. Code implementation and focused checks complete. Credential rotation and repository-history remediation remain external actions. No production database, diagnostic/index script, DNS, provider API, or deployment was executed.

### Verified findings and implemented changes

- Removed embedded database connection credentials from `backend/sync_indexes.mjs` and `backend/check_tokens.mjs`. Both require a validated `DATABASE_URL` with an explicit database name; errors do not print the URI. Token diagnostics now report aggregate counts instead of token IDs, symptoms, or clinical briefs. Added a local database configuration example. These utilities were inspected, not executed.
- Added `services/publicViews.js` field allowlists for hospital discovery/profile/doctors/departments and all three public review/feedback feeds. Public output excludes onboarding data, subscription state, provider identifiers, patient/token identifiers, moderation metadata and response-author IDs. Anonymous reviewers have only an anonymous display name; named reviewers have a display name without their account ID. Homepage uses `reviewerName` instead of `patientId`.
- Versioned public hospital/search caches. Public profiles and search results are sanitized again on cache hits. Requests remove applicable legacy keys, and shared invalidation clears both generations for hospital slug and custom domain. Hospital profiles resolve custom domains only when verified. Profile edits cannot write domain verification/provider fields; adding a domain already assigned to another hospital is rejected.
- Added `services/hospitalAccess.js` to bind patient identity to authentication, validate family ownership, check hospital/doctor/department references and enforce care access. Patient booking rejects doctor sessions and another account's patient ID. Assisted staff bookings validate supplied patient/family references; accountless walk-ins still work. New bookings require an active hospital and an accepted, active doctor assigned to the department.
- Scoped staff queue reads, token mutations and OPD AI context. Queue caching stores raw internal rows but rechecks current permissions and applies role-specific response fields on every request. Department references are checked against the hospital. Corrupt linked appointments cannot be started/completed through another patient's token. Appointment OTP verification and booking also validate family ownership before payment.
- Validated staff invite department IDs and department head/timing doctor references. Department edits use an allowed `$set` payload and cannot move a department to another hospital.
- Added `services/staffMessaging.js` to enforce the same visit/department/recipient policy for message creation, history, read acknowledgements and event recipients. Direct messages are available only to their participants, including when the requester is an administrator. Patient conversations require an authorized visit; historical unscoped clinical announcements are suppressed. Referenced sender, recipient, patient, doctor and department records must match the hospital/visit.
- OPD events now go to current accepted/active staff in private identity rooms and carry only minimal refresh signals. Clinical records, vitals, briefs and diagnoses are fetched through authorized HTTP APIs. Updated both hospital token and linked online-appointment emitters. Revoked or unrelated staff are excluded from delivery.
- Socket authentication verifies accepted/active staff. Message sending and appointment access recheck current staff state. Hospital staff can join only a linked appointment for their own hospital/assigned visit, rather than any appointment of a shared platform doctor. Community joins require real membership/authorship and cannot name private staff or appointment rooms. Call signaling/chat/end operations require authorized room membership. Null join payloads fail safely.
- Updated the staff communication lab tab to require a visit token and use a patient-context conversation. The alert is scoped to that care team and the department's lab technicians; it is still a message, not a full lab-order workflow.
- Added `backend/tests/p01.test.js` and `npm run test:p01`; `npm test` now runs the local regression tests rather than the placeholder command.

### Access policy

| Staff role | Operational visit data | Clinical visit data |
|---|---|---|
| Doctor | Assigned doctor only | Assigned doctor only; copilot requires this role |
| Nurse | Assigned departments | Assigned departments; vitals recording requires this role |
| Department head | Assigned departments | Assigned departments |
| Hospital administrator / receptionist | Own hospital queues | No clinical fields or clinical conversations |
| Lab technician | No general visit/queue access | Only visit-linked lab-alert conversations in assigned departments |
| Pharmacist | No general visit/queue access | No general clinical access; pharmacy module is deferred |

`adminAccess` enables administrative workflows, not clinical access. Staff without required department assignments must have those assignments configured. Administrative queue responses retain patient registration details and status/payment fields while omitting complaint, vitals, triage, diagnosis and clinical notes. Direct and authorized department messages remain available for general staff coordination.

### Verification

- `backend: npm run test:p01`: **19 passed, 0 failed**, on Node 24.11.0. Covers credential/configuration guards, contaminated caches, public-field/anonymous-review filtering, cross-user/family/tenant/department/role denials, legitimate self/family/walk-in booking, private message history/read acknowledgements, current staff event recipients, corrupted references, profile domain-field protection and call-room interference.
- Tests exercise real Express routes/authentication over local HTTP and real Socket.IO/WebSocket transport. MongoDB model methods use a small synthetic query fixture; Redis uses the in-memory test implementation. Transitive dotenv imports run from an empty temporary directory so project `.env` files are not loaded. No external databases, Kafka, mail, AI or payment services are contacted. These tests do not validate MongoDB index behavior, persistence, races or real-money flows; those belong to P02-P04.
- Frontend `npm run build`: passed after the homepage and lab-alert adjustments. Existing warning remains for a main bundle above 500 kB.
- ESLint comparison against HEAD: `StaffCommunication.jsx` has 0 errors; `Home.jsx` retains its 5 existing errors. Neither changed frontend file adds a lint issue.
- Node syntax checks passed for the changed backend modules, utilities and test. Changed-file Git whitespace checks accept existing CRLF line endings. Credential scans report filenames/counts only and never print connection strings.
- No rendered browser screenshots or authenticated live-site checks were performed. UI compatibility was checked through source review, lint comparison and the production build.

### Deployment and follow-up items

1. **Rotate/revoke the exposed MongoDB credential now**, update deployment secrets and check access logs privately. Code removal does not invalidate a credential already exposed through Git or other copies. Review and remove affected repository-history exposure with collaborators before rewriting published history; this task does not rewrite history or change provider credentials.
2. No schema/index migration is introduced. Existing cross-hospital/incorrect department links, mismatched family/appointment links and incomplete staff invites fail authorization rather than being silently repaired. Any needed data correction should be reviewed and performed against an explicitly approved database. Historical clinical announcements need an authorized visit reference to be made visible; do not mass-link them automatically.
3. Deploy matching backend/frontend versions and restart API processes to establish the new socket subscriptions. Runtime cache invalidation/versioning prevents old public payloads from being served by the updated API. Confirm any separate CDN/proxy caches during deployment.
4. P03/P04 still own token/session uniqueness, atomic queue transitions, booking/payment idempotency and refund reconciliation. P05 still owns cookie/CORS/CSRF/session revocation and full REST community-policy alignment. P06 owns durable event/mail delivery and further call lifecycle work. P07 owns complete independent/hospital care-context separation and production domain ownership verification. No claim is made that this task completes those stages.

Implementation files: `backend/services/{hospitalAccess,staffMessaging,publicViews,publicHospitalCache}.js`, `backend/util/databaseConfig.js`, the two utilities, hospital/OPD/AI/appointment/review/staff-message controllers, staff middleware, OPD routes, socket server, rating cache invalidation, package scripts/config example, and the two affected frontend pages.

## P02 — Reproducible development and regression baseline

Date: 2026-10-08. Implementation and Docker runtime verification complete; the follow-up below resolves the initial service blocker.

### Verified findings and changes

- Reverified the infrastructure finding in `MEDIPULSE_REVIEW.md`: standalone local Mongo, inherited local production DB settings, implicit memory Redis and missing Nginx SPA fallback were present. The original ledger test utility loaded deployment `.env` and wrote wallet records without isolating its database.
- Configured a dedicated `medipulse_dev` MongoDB replica set with a one-shot initialization container. API waits for writable transaction support and healthy Redis/Kafka; API and consumer use the same real Redis DB 0. Kafka supports internal container and host connections, with explicit topic creation before subscription and consumer readiness after group membership.
- Production Compose now excludes local Mongo/init dependencies, requires an explicit production DB/signing key/client/API configuration and uses private production env files. Production Redis/Kafka volumes are distinct and broker/Redis ports are not published. A synthetic `scripts/checkCompose.js` validates both merges without loading production secrets.
- Added localhost `.env.local` templates and guarded host API/consumer launchers. Local startup requires `medipulse_dev`, real localhost Redis DB 0 and localhost Kafka. Docker contexts exclude credentials/dependencies/test artifacts; both Node images now use Node 24 to match the verified host runtime. Git ignores the private production env file and browser artifacts.
- Added frontend Nginx SPA fallback, relative `/api/` proxy, health endpoint and explicit public build arguments. Vite now proxies relative API requests during host development. README points to `DEVELOPMENT.md`; the existing AWS script's production command comment uses the explicit env file. No deployment script was executed.
- Added API/consumer liveness/readiness reporting and nonzero startup failure, with sanitized dependency labels. Shutdown stops polling workers and closes sockets/Mongo/Redis. Disabled local mail performs no provider delivery; readiness mail status represents configuration only.
- Added safe backend test preload and seven P02 tests alongside P01's 19. The real integration harness creates a unique local test database and Redis DB 15 key prefix, checks virtual transfer/refund conservation, rollback, an existing atomic OPD sequence, family ownership and visit permissions, then removes only its fixtures. It cannot fall back to `DATABASE_URL` or deployment `.env`. The old ledger utility delegates to this harness; the Gemini utility requires explicit provider-test opt-in and a separate test key.
- Added pinned Playwright tooling, a small synthetic API and eight desktop/mobile journey checks. Page requests are restricted to the fixture/Vite localhost ports. The fixture exercises booking fee, keyboard confirmation into synthetic triage, failed demo payment, guest sign-in and deep-link reload. Browser tracing is optional; output can be directed outside OneDrive.

### Checks and actual results

| Check | Result |
|---|---|
| Backend `npm test` | **26 passed**, 0 failed: P01 19 + P02 7 |
| Final targeted P02 suite after Redis cleanup changes | **7 passed**, 0 failed |
| `node backend/scripts/checkCompose.js` | **Passed** both local and production merged DB/Redis/dependency checks, using synthetic variables only |
| Frontend `npm run test:e2e` | **8 passed** with bundled Chromium, desktop and 390 × 844 mobile; real React pages rendered against synthetic HTTP API |
| Frontend `npm run build` | **Passed**; existing main bundle warning remains (~1.57 MB before gzip) |
| ESLint on Vite config, Playwright config and browser specs | **Passed**, no errors |
| Syntax checks and changed tracked-file whitespace | **Passed** |
| Private env/artifact ignore checks | **Passed** |
| Real `npm run test:integration` with explicit localhost test targets | **Blocked**: local MongoDB replica set/Redis unavailable; all three cases stopped at the prerequisite hook, exit 1 |
| Docker images, replica-set initialization, real Kafka delivery, Nginx runtime | **Not run**: Docker Engine unavailable |

Docker Compose 5.1.3 is installed, but Docker Desktop's Linux engine pipe is absent. No local `mongod` or `redis-server` executable was available. The first integration attempt exposed a Windows `--import` path issue, corrected to a file URL before the prerequisite result above. Initial Edge runs had a cold-page timeout and stalled browser teardown; owned test processes were stopped and the final Chromium run completed successfully. No screenshots or live-site/provider checks are claimed.

The Playwright installation reported 29 dependency advisories (3 low, 8 moderate, 17 high, 1 critical). Dependency upgrades were not mixed into this task; assess affected packages before launch. No production database, patient records, DNS, providers or deployments were changed.

### Reproduction, migration and follow-up

- Commands and configuration: `docs/DEVELOPMENT.md`. The initially pending Docker integration step is completed in the follow-up below. Use the same isolated targets when running P03 concurrency checks.
- No application schema/index migration was introduced. New development/production infrastructure volume names deliberately do not reuse old data. Before applying the production override to an existing deployment, prepare an approved Redis/Kafka/ZooKeeper data recovery/migration plan; this task does not copy or delete existing volumes.
- P03/P04 still own first-issuance races, queue invariants, booking idempotency and refund reconciliation. The sequence baseline tests a pre-existing counter, not the unresolved first-upsert race. P06 still owns durable delivery/restart recovery. Existing oversized frontend bundles and dependency advisories remain launch follow-ups. P01 credential rotation remains an external action.

Main files: root Compose files, `infra/mongo-init.js`, Dockerfiles/ignore files, `frontend/nginx.conf`, Vite config, backend runtime/readiness/Redis/consumer/worker setup, safe launch/test scripts, `backend/tests/{bootstrap,p02,integration/local-stack}.js`, frontend Playwright fixtures/specs, package manifests/lockfile, env templates and `docs/DEVELOPMENT.md`.


### P02 Docker verification follow-up — 2026-10-08

User enabled Docker Desktop and authorized the pending runtime verification. Docker Engine 29.4.3 was available. Pulled the local images, started Mongo/Redis/ZooKeeper/Kafka, initialized `rs0`, and successfully built/started the complete local stack. Existing application changes were preserved; no implementation fixes were needed during this verification.

Commands executed from the repository root:

```sh
docker compose up -d mongo redis zookeeper kafka
docker compose --progress quiet run --rm mongo-init
docker compose --progress quiet up -d --build
```

The backend integration runner used explicit localhost `TEST_DATABASE_URL` for `medipulse_test` with `replicaSet=rs0&directConnection=true` and `TEST_REDIS_URL` for Redis DB 15.

| Runtime check | Result |
|---|---|
| `npm run test:integration` | **3 passed**, 0 failed: virtual transfer/partial refund and failed debit rollback; 12 concurrent increments of an existing sequence; real family/staff authorization queries |
| Synthetic fixture schema validation | **Passed** |
| Replica-set initialization | **Passed**, writable primary confirmed |
| Docker backend, consumer and frontend image builds | **Passed** |
| Final container status | API, consumer, frontend, Mongo, Redis and Kafka **healthy**; ZooKeeper running; one-shot Mongo init exited successfully |
| API and consumer readiness | **Passed**, real Mongo/Redis/Kafka ready and consumer joined; mail disabled |
| Shared Redis across actual API/consumer containers | **Passed**: API wrote a uniquely named expiring synthetic key; consumer read the same value; key removed |
| Actual Kafka publisher → running worker → Mongo analytics record | **Passed** using a unique synthetic marker; only that fixture was removed afterward |
| Nginx `nginx -t` | **Passed** |
| Docker SPA routes | **Passed** root, appointment booking deep link and nested hospital URL return the SPA; missing asset returns 404 |
| Nginx relative `/api/hospitals` proxy | **Passed**, JSON HTTP 200 |
| Browser against Docker frontend and real local API | **Passed** guest booking redirects to sign-in and login survives reload at 1280px and 390px; external requests blocked |
| Real dependency outage/recovery | **Passed**: briefly stopping only local Redis yielded API readiness 503 with Redis unavailable; restarting Redis restored readiness 200 |
| Fixture cleanup | **Passed**: zero generated test databases, no integration/shared-Redis test keys, zero synthetic Kafka analytics records |

These results supersede the initial Docker-blocked rows above. The previous 26 backend and eight synthetic browser regression results remain unchanged. The Docker browser checks used anonymous sessions; authenticated clinical workflows and the unresolved first token-upsert race are not claimed as verified.

KafkaJS emitted nonfatal partitioner and Node timeout warnings during the delivery check; the event was received successfully. Track compatibility/warning cleanup with P06. No production services, credentials, patient records or deployment settings were changed.

The local stack is left running and healthy: frontend `http://localhost:8081`, API `http://localhost:8080`. Stop it with `docker compose down` when finished; retain its volumes. P02's service blocker is resolved and the baseline is available for P03.

## P03 — OPD and appointment concurrency

Date: 2026-10-09. Implementation and isolated verification complete. Existing P01/P02 edits preserved.

### Verified findings and changes

- Reverified the review's queue findings: sequence and token indexes disagreed about department scope; live-patient constraints merged family members and anonymous walk-ins; first counter creation could collide; ordinary status saves allowed competing starts and stale terminal edits. Booking used separate resources and unstable payment references. Hospital reservations implied arrival and linked appointments exposed online-call behavior.
- Wrote [P03_QUEUE_CONTRACT.md](P03_QUEUE_CONTRACT.md) before implementation. Queue identity is hospital/independent practice, doctor, timezone-local service date and configured session. Default timezone/session are `Asia/Kolkata`/`day`; a doctor's departments share a hospital session sequence. Family identities remain separate; walk-ins use actor/request identity.
- Added atomic counter upserts with bounded duplicate-key recovery; partial unique indexes enforce queue numbers, live patient identity and one active consultation. Index auto-creation is disabled for queue models; API startup requires migration readiness.
- Persisted actor/endpoint request keys, input fingerprints and booking-operation/resource/payment references. Matching retries across API processes replay the same booking; changed input conflicts. Provisional resources commit before debit, so different keys for a live patient also cannot debit twice. Failed aliases replay failure; uncertain paid operations return pending reconciliation. Browser keys survive reload/lost responses without storing raw medical input.
- Added shared conditional transactions for linked visit transitions, revision conflicts and queue ordering. Corrupt linked states/references fail without partial mutation. Remote hospital bookings remain reservations until staff check-in; assisted walk-ins arrive at issuance. Terminal visits cannot reopen. Paid no-show refunds retain terminal clinical state and separately claim financial processing.
- Updated patient/staff/doctor callers, reservation/check-in controls, configured session selection and separate appointment queue selection. Hospital visits carry `in_person`, do not expose video joining or trigger the online five-minute timer, and use the existing hospital-site route. Optional cache/socket/mail/AI failures occur after clinical commit; absent AI credentials cause no provider request.
- Added explicit dry-run/apply/recovery tools with reference/conflict detection, private backups, counter backfill and guarded rollback. Reinspection preserves assigned context and walk-in identities after configuration edits. Local empty-schema bootstrap refuses nonempty legacy queues and unsafe targets; Compose requires it only in local mode.

### Checks and actual results

| Check | Result |
|---|---|
| Backend `npm test` | **32 passed**, 0 failed: P01 19 + P02 7 + P03 6 |
| Real `npm run test:integration` | **23 passed**, 0 failed: P02 3 + P03 20, using Docker MongoDB replica set and Redis DB 15 |
| Concurrency and workflow | Passed simultaneous first upserts, two API processes, same/different-key retries, family/walk-in identity, shared department numbering, competing starts, direct index enforcement, stale revisions, terminal actions and linked rollback |
| Payment/date cases | Passed one demo debit on booking replay, failed-payment aliases, paid no-show refund, current-date/session rejection and lost-response replay across a local-date boundary |
| Migration rehearsal | Passed populated synthetic duplicate detection, metadata/identity backfill, context preservation, refusal after later writes, exact row/index recovery and guarded empty bootstrap |
| Frontend browser | **14 passed**, bundled Chromium at desktop and 390px mobile: existing journeys plus lost-response reload, keyboard check-in and separate physical/online doctor queues |
| Frontend production build | **Passed**; existing ~1.57 MB main-bundle warning remains |
| Affected-page ESLint against HEAD | **No new errors**; existing profile/console/hospital-page errors and hook warnings remain. New request-key helper has zero errors/warnings |
| Compose validation | **Passed** local and production dependency/configuration checks using synthetic variables |
| JavaScript syntax / changed-file whitespace | **Passed** |
| Fixture cleanup | **Passed**: generated test databases and Redis fixture keys removed; delayed empty Mongoose collection creation disabled in the P03 harness |

HTTP tests used synthetic identities, real Express routes and two child API processes. Browser tests rendered real React pages against an isolated synthetic API with external page requests blocked. Migration/recovery ran only on temporary local test databases. No live patient/provider/payment/production verification is claimed.

### Migration and remaining work

- **Apply the reviewed queue migration before deploying/restarting P03 writers.** See [P03_MIGRATION.md](P03_MIGRATION.md) for writer pause, dry-run, conflict review, backups and recovery. Existing local P02 Docker containers remain healthy and unchanged; they still run their previous images. P03 Docker images and production deployment were not run. No existing `medipulse_dev` data, production database, DNS, provider settings or credentials were changed.
- P04 owns interrupted booking/refund reconciliation, fully atomic accounting and cumulative refund limits. Pending operations/failed refunds deliberately remain held for reviewed recovery; P03 does not claim those ledger crash windows are resolved.
- P06 owns durable events/notification recovery and online consultation deadlines across processes/restarts. Rich scheduling, priorities, ETA and the full UI redesign remain later prompts.

Main files: queue context/booking/transition/migration services; booking-operation, token, appointment, sequence and configuration models; OPD/appointment controllers/routes and socket guards; migration/bootstrap/Compose checks; patient/staff/doctor pages and request-key helper; backend unit/integration/HTTP fixtures, browser fixtures/specs and development/migration documentation.

## P04 — Ledger, refunds and booking recovery

Date: 2026-10-09. Implementation and final isolated verification complete; existing P01-P03 work preserved.

### Verified findings and changes

- Confirmed cumulative refund validation ran before transfer/accounting writes, completed replay followed original-status rejection, wallet operations ran concurrently inside a transaction, and Redis cleanup could throw after a committed debit. Top-ups updated balance/ledger separately; payment HTTP keys lived in a shared expiring Redis namespace. Demo top-up/refund pages generated a new key after each retry. Transaction-history search also widened the ownership filter.
- Added integer hundredths for demo INR balances, amounts, totals and cumulative refunds, retaining numeric major-unit responses. Invalid precision/units are rejected. Wallet creation/starting credit is conditional and transactional; no Redis lock determines financial correctness.
- New booking resources, debit, ledger/notification records and operation completion commit in one Mongo transaction. Persistent intents and fixed IDs permit restart recovery. Concurrent/repeated keys replay without another debit; different keys retain P03 live-patient protection. Uncertain outcomes remain durable; structural legacy inconsistencies require review.
- Refund transfer, refund record, original cumulative total and status commit together. Completed authorized replay precedes fully-refunded eligibility. Appointment cancellation shares one financial identity across manual/automatic/recovery paths; linked clinical cancellation commits with its refund. Generic refund endpoints cannot bypass appointment eligibility. Omitted generic refund amount means the remaining balance.
- Resolve lost commit acknowledgements from persisted success; optional post-commit cache/event delivery cannot turn successful money movement into failure. Wallet reads remain authoritative. History search retains ownership constraints; asynchronous payment routes return controlled failures.
- Added bounded startup/periodic recovery with retry backoff. Legacy committed debits/provisional visits and completed refunds/clinical holds recover without duplicate movement. Expired incomplete intents cannot take a new payment; committed debits are compensated before recording completion. Failed compensation remains pending without claiming a refund.
- Demo top-up/refund forms preserve actor-scoped keys after lost responses/reload, prevent repeated submission, provide accessible labels and explicitly identify demo credits. Added a selectable demo gateway contract; real collection is rejected.

### Final checks and results

| Check | Result |
|---|---|
| Backend `npm test` | **39 passed**, 0 failed: P01 19 + P02 7 + P03 6 + P04 7 |
| Real `npm run test:integration` | **46 passed**, 0 failed: P02 3 + P03 20 + P04 23 |
| Money/concurrency cases | Passed exact decimal balances, concurrent partial refund caps, full-refund replay/authorization, same-reference and actor/action-scoped HTTP replay, first-wallet creation and consultation/refund races |
| Failure/recovery cases | Passed rollback after debit/resource/refund/notification failures, post-commit Redis failure, lost payment/refund/top-up/booking commit acknowledgements, recovery in a restarted API process, legacy payment/refund recovery and expired compensation/retry |
| Migration rehearsal | Passed populated synthetic conflict detection, integer backfill, matching committed-refund repair, readiness checks, refusal after later writes and exact row/index rollback |
| Frontend browser | **18 passed**, bundled Chromium, desktop and 390px mobile; includes keyboard top-up/refund submission and lost-response reload with one persistent key |
| Frontend production build | **Passed**, 2,289 modules; existing ~1.57 MB main-bundle warning remains |
| Affected frontend lint | **0 errors, 0 warnings** in `VirtualAdminDashboard.jsx` and `VirtualRefunds.jsx`; no new errors against their original contents |
| JavaScript syntax / changed-file whitespace | **Passed** |
| Fixture cleanup | **Passed**: no generated test databases or Redis test keys remain |

Tests used explicit localhost MongoDB replica-set targets, uniquely named synthetic databases and Redis DB 15 prefixes. Browser checks rendered real pages against a synthetic API with external requests blocked. Early runs exposed a wallet-upsert default error (fixed) and a cold bootstrap timeout (bounded timeout increased); the final runs above passed. Docker stopped during verification; its local engine and the existing containers were restarted without rebuilding images or migrating existing development data.

### Rollout and remaining work

- **Existing writers require P03 followed by P04 migration before deployment.** [P04_MIGRATION.md](P04_MIGRATION.md) covers paused writers, dry-run counts, private backups, recovery and operator review. No production/development application-data migration, provider activation, DNS change or deployment was executed. Existing local containers still run their previous P02 images.
- Recovery retains unverifiable legacy references as `review_required`; insufficient merchant funds/unknown outcomes stay pending. Migration never silently deletes duplicate financial records or invents historical credit provenance.
- P06 owns durable notification/cache/mail delivery and restart-safe consultation/refund schedules. P04 recovers persisted unfinished operations/holds; it does not reconstruct a schedule lost from Redis. Real gateway settlement/activation and historical cases requiring operator correction remain separate work. Existing bundle/dependency follow-ups remain.

Main files: money utility/transaction/ledger, booking and appointment-refund/recovery/gateway services; wallet/ledger/refund/booking/appointment models; payment/appointment/OPD controllers/routes and startup; money migration/empty bootstrap; two demo-payment pages; backend and browser fixtures/tests; gateway/development/migration documentation.

## P05 — Sessions, communities and forecast defects

Date: 2026-10-09. Implementation and final isolated verification complete; P01-P04 changes preserved.

### Verified findings and changes

- Verified the review's readable JWT cookies, permissive CORS and staff-first socket selection. Added persisted Mongo sessions with sid/expiry/revocation and current account-version checks; cookies are host-only HttpOnly, secure in production. Browser CSRF tokens stay in memory and mutations require an exact approved Origin. Explicit bearer clients use the same session guards. Legacy JWTs require new sign-in.
- Added server logout and transactional password-reset/staff-password-change revocation. Switching accounts revokes both previous browser cookie sessions, clears the other workspace and disconnects sockets. Staff/account sockets select their scope explicitly. Generation guards keep delayed verify/community responses and their CSRF values from overwriting a newly signed-in account.
- Prepared same-origin `/backend` routing to the existing Render API in Vercel and to the configured API in Nginx/Vite. Relayed sockets use HTTP polling, avoiding a dependency on Vercel WebSocket forwarding. Direct configured API URLs remain supported. This prepares first-party cookie use on the existing domain; live configuration was not changed.
- Confirmed User's save hook rehashed unchanged passwords; added the modified-password guard, preserving Doctor/Staff guards. JSON/auth projections exclude password hashes, invite secrets and account-version internals, including freshly created or password-selected documents. Profile saves with and without selected passwords were checked before login.
- Staff invite acceptance now requires a future expiry and atomically consumes the pending token. Concurrent acceptance/replay cannot reset an accepted password. OTP challenges moved to Mongo: HMAC hashes, fixed ten-minute expiry, atomic five-attempt limit and single-use consumption in the password/revocation transaction. Secret OTPs are no longer published on the general notification topic; disabled/unconfigured/failed mail returns 503.
- REST and Socket.IO now share community membership/doctor-organizer rules. Doctor authors can send messages; nonmembers cannot read/send/join private rooms. Join/leave/create/send are transactional, repeated joins are idempotent, organizers cannot leave their own community and broadcasts recheck recipients. Discovery/public doctor responses expose summaries/counts instead of member IDs/message pointers. Member count displays accept the new DTO and older cached responses. Event reads are membership scoped; creation requires that community's doctor organizer and valid date/kind.
- Forecast routes now use authorization middleware, enforce same-hospital admin role and execute their controllers. Bed total OPD volume is defined, and blood prompts include the recorded volume. Bounded schema/range/department validation precedes persistence; invalid provider output cannot replace a stored draft, and malformed legacy drafts are withheld for regeneration. UI/API mark forecasts as unreviewed planning drafts with admissions/occupancy/inventory unknown.
- Added explicit auth-index dry-run/apply/guarded index rollback, startup readiness checks and empty-local bootstrap support. Existing account versions default to zero; no account/password/community backfill is applied. Integration files now run sequentially to reduce cold-import contention while retaining concurrent requests and multiple API processes inside their cases.

### Checks and results

| Check | Result |
|---|---|
| Backend `npm test` | **44 passed**, 0 failed: P01-P04 39 + P05 5 |
| Real `npm run test:integration` | **60 passed**, 0 failed: P02 3 + P03 20 + P04 23 + P05 14 |
| Session/password/OTP/invite checks | Passed cookie/Origin/CSRF rejection, workspace switching, persisted logout across two HTTP API instances, legacy-token rejection, profile-save/login/hash preservation, bounded concurrent OTP attempts, one reset winner, replay/expiry rejection, concurrent invite consumption and competing staff password changes |
| Community/forecast checks | Passed nonmember REST/socket denial, doctor-author messages, membership idempotency, recipient filtering after leave, malformed socket acknowledgements, organizer event checks, metadata DTOs, own-tenant forecast execution/volume, invalid-output rollback and malformed legacy-draft suppression |
| Transport/schema rehearsal | Passed real scoped-cookie Socket.IO polling through an HTTP relay; auth-index dry-run, apply prerequisites, readiness, conflict refusal, private metadata backup and index rollback retaining synthetic accounts |
| Frontend production build | **Passed**, 2,290 modules; existing ~1.57 MB main-bundle warning remains |
| Affected frontend lint | **0 new diagnostics** against P05 before-images across 15 source files. Existing **57 errors / 10 warnings** remain, primarily prop validation and existing hooks/unused-code findings; this is not a clean full-project lint run |
| Browser, direct API | **22 passed**, bundled Chromium, desktop and 390px mobile; login switching, unreadable HttpOnly tokens, delayed staff verification, CSRF logout/reload, booking/staff/doctor/demo-money journeys |
| Browser, same-origin relay | **24 passed**, desktop and 390px mobile via the Vite `/backend` relay; includes keyboard profile/community modal/chat count rendering using summaries without member IDs |
| Syntax/Compose/whitespace | Passed 40 backend JavaScript syntax checks, frontend helper syntax, local/production Compose validation and changed-source whitespace |
| Fixture cleanup | Passed: **0** generated test databases and **0** Redis fixture keys remain |

Tests used explicitly validated localhost replica-set databases with unique synthetic names and Redis DB 15 prefixes. Browser checks rendered real React source against a synthetic API with external requests blocked. AI output was supplied by fixture generators; no real mail/Google/AI provider calls or production-browser cookie forwarding were verified. An early fixture omitted a required department fee (corrected). An intermediate full run failed isolated child API startup while several cold-import jobs were running; subsequent file-sequential execution with bounded startup cleanup passed all 60 cases. After acknowledgement type guards, all 44 backend tests and the 14 P05 integration cases passed again. A browser run exposed the logout navigation race (fixed); lint caught one added count-field diagnostic (corrected with a reusable DTO helper). New community browser fixtures were corrected to close the modal, open the mobile sidebar and distinguish navigation/footer links; the final 24-case run passed. Hospital signup stores only staff/hospital metadata, keeping the new CSRF token in memory.

Docker Desktop was restarted, then the existing local containers were restored. Kafka initially encountered an old ZooKeeper broker registration; a later start after session expiry succeeded. API, consumer, frontend, MongoDB, Redis and Kafka are healthy; ZooKeeper is running. Images were not rebuilt, so those containers still run the earlier P02 code. No existing development/production application data was migrated.

### Rollout and remaining work

- Before deployment: reviewed P03 migration, P04 migration, then P05 auth-index initialization and coordinated frontend/API rollout. [P05_SESSIONS.md](P05_SESSIONS.md) covers origin/proxy/cookie configuration, private backups, dry-run, paused writers, rollback and new sign-in. Historically double-hashed passwords require a reset after mail is configured; old reset OTPs must be requested again.
- P06 owns durable secret-bearing notification jobs, distributed socket delivery/session refresh and call/deadline recovery. Cross-process socket revocation uses per-packet validation and a five-second poll; instant distributed logout/broadcast delivery is not claimed. P07 owns verified host/custom-domain registration and cross-host product routing. P14 owns expanded community moderation/pagination; P18 owns measured AI reliability.
- No production schema operation, DNS/TLS/provider change, purchase, deployment or Docker image rebuild was executed. Existing lint debt and bundle size remain follow-ups.

Main files: auth controller/session/schema/challenge services/models/middleware and routes; password models; community/message/event controllers and shared policy; forecast controller/schema/validator/routes; API/socket/bootstrap; frontend HTTP/session/socket/context/navbar and count/staff/forecast consumers; proxy/build/Compose config; regression/integration/browser fixtures and rollout documentation.

## P06 — Durable notifications, realtime recovery and calls (9 October 2026)

### Implemented and verified findings

Verified the review's concrete defects in `reviewRequestWorker`, Kafka/mail consumers, appointment OTP handlers, consultation timers and browser TURN configuration. Preserved the existing uncommitted P01–P05 work.

- Added Mongo outbox jobs with unique identities, atomic claim/renewal, lease ownership checks, exponential retries, bounded attempts and sanitized failed-job visibility/retry CLI. Booking and shared clinical/refund transitions persist notification jobs and queue revisions in their existing transaction. A failed outbox write rolls back resources/payment; the existing booking recovery then completes once. Broker/mail failure after commit does not undo workflow success. Booking, doctor-ready, cancellation/refund and review mail now use the durable worker. Doctor-ready mail expires and is skipped after the visit ends.
- OTP challenges and encrypted mail jobs commit together before returning **queued**. Disabled/unconfigured mail refuses requests. Booking OTP/proof storage moved from process-dependent Redis state to Mongo, with fixed expiry, five wrong guesses, one-minute resend cooldown, atomic verification and proof redemption with booking. Secret bodies use AES-GCM, are excluded from default projections/operator output, and are removed after delivery/skip or expiry. Password reset uses the same durable delivery boundary. Legacy OTP broker messages are discarded; analytics payloads are allowlisted and exclude OTP/email/password/body data.
- Replaced the five-minute in-memory forced ending with manual completion by default and configurable persisted online deadlines. Startup/periodic Mongo scans recover consultation deadlines and the existing 30-minute unstarted online demo refund policy. Hospital in-person visits remain manual and are excluded from automatic refunds. Legacy Redis reviews transfer to Mongo before removal; failed mail remains retryable.
- Authorized doctor/staff/patient snapshots plus revisions drive queue UI. Guards reject reversed HTTP responses, old revisions and prior contexts, including automatic queue changes after completion/midnight. Socket/visibility/polling refresh repairs missed events. Hospital patient call alerts read their own token snapshot instead of trusting stale socket payloads. Existing session validation runs per packet and every five seconds; staff permission changes disconnect old rooms. One API instance is explicitly supported; configured horizontal scaling is refused pending an adapter.
- Call participants rebuild signaling/media on reconnect, recover missed endings through authorized snapshots, attempt ICE restart and get explicit permission retry/audio-only fallback. A doctor disconnect leaves the visit active. Patients leave/rejoin locally; doctors end through REST, with one parent callback and no second end request. TURN credentials are issued by an authenticated participant/status endpoint using backend coturn REST configuration; VITE provider secrets were removed. Mobile controls fit 360px and retain keyboard access.

### Checks

| Check | Result |
|---|---|
| Backend regression | **50 passed**, including six P06 unit cases; final run after the delivery changes |
| Local integration | **74 passed**: prior 60 plus 14 P06 cases; full final file-sequential run |
| P06 delivery/migration checks | Transaction rollback/recovery, replay/deduplication, competing lease claims, lease expiry/fencing after DB reconnect, retry/failed visibility, encrypted/fixed-expiry OTP races, atomic proof redemption, persisted consultation/refund deadlines, legacy reviews, actual socket participant/permission checks, operator retry, additive schema dry-run/apply/conflicts/rollback and legacy deadline backup/rollback |
| Browser regression | **32 passed** in the full desktop/390px run; actual React source and synthetic API/signaling through the `/backend` relay |
| Final call checks | **6 passed** in an isolated final run, including both participants exchanging actual WebRTC media with fake devices, transport disconnect/reconnect, patient leave/rejoin, one doctor end, denied microphone/retry and real audio-only camera fallback; 360px controls fully in viewport and keyboard actions checked |
| Frontend build | Passed, **2291 modules**; existing large-chunk warning remains (main bundle about **1.58 MB**) |
| Affected lint | **0 new diagnostics** across seven affected source files; existing **26 errors / 13 warnings** remain. Compared rule/severity/message with shifted line references normalized |
| Syntax / Compose / whitespace | **41** changed/new JS/MJS syntax checks passed; local/production Compose checks and affected tracked-source whitespace passed |
| Fixture cleanup | **0** generated test databases and **0** Redis fixture keys remain |

One intermediate final call rerun passed five cases and timed out on mobile audio fallback while several heavy checks were running. That case subsequently passed twice in isolation; the complete six-case call suite then passed in isolation. The precise timeout cause was not established. An intermediate lint comparison counted an existing warning's shifted line number as new; normalization confirmed it was unchanged. Added callback/unused-function diagnostics were corrected before the final comparison.

Checks used generated local Mongo replica-set databases, isolated Redis fixtures where needed, synthetic accounts and disabled real mail/AI/Kafka delivery. Lease/deadline tests reconnect to persisted Mongo state; the existing P04 tests also restart actual isolated API processes and recover booking intents. Browser calls use Chromium fake devices, synthetic local signaling and host ICE candidates, with external requests blocked. Actual SMTP acceptance, a configured TURN provider/cross-network NAT traversal, production API restart, deployment cookies and DNS were not tested.

The existing Docker stack remains healthy and still runs its earlier P02 images. No image rebuild, existing development/production migration, provider activation, DNS/TLS change, purchase or deployment was performed.

### Rollout / remaining actions

[P06_DURABLE_WORKFLOWS.md](P06_DURABLE_WORKFLOWS.md) records explicit-target dry-run/apply, paused writers, private backups, rollback/partial-apply recovery, failed-job operations, old broker backlog boundaries, key rotation and configuration. Finish P03/P04/P05 migrations, initialize P06 indexes and review/backfill eligible legacy online refund deadlines before deploying the new API. Existing active visits with no stored deadline stay manual. Coordinate API/frontend/consumer updates so old mail consumers do not duplicate outbox delivery. Request new OTPs after rollout; old Redis proofs are intentionally invalid.

SMTP can deliver again after provider acceptance followed by a worker crash; exactly-once external email is not claimed. Configure/verify mail and a compatible backend TURN provider before launch, and review any legacy Kafka mail backlog separately rather than automatically resending previously accepted messages. API scaling, full notification preferences/timelines and further UI/product work belong to subsequent prompts.

Main files: new outbox/delivery/workflow, booking authorization, consultation policy, TURN and durable-schema services/models; booking/visit/appointment/auth/refund integration; socket, readiness, mail and analytics/review workers; schema/deadline/operator scripts and local bootstrap; queue guards and doctor/nurse/patient/hospital/call UI; config examples, integration/browser fixtures and rollout/review documentation.
## P07 — Product contexts, domains and practice isolation (9 October 2026)

### Implemented and verified findings

Verified the review's medipulse.com default, unreserved product names, hospital-host early return and routing-only domain verification. Preserved P01–P06 edits.

- Company home presents Connect and Hospitals. Explicit host contexts and /connect/*, /hospital/* and /hospitals/:slug/* fallbacks support nested login, signup, visit/family tracking, profile and review routes. Cross-product navigation establishes the correct basename. Unknown, reserved, disabled and inactive hospital hosts fail closed; preview aliases are exact.
- Staff surfaces hydrate staff sessions; Connect/patient surfaces hydrate account sessions. Hospital login selects the required profile. Staff login uses the canonical endpoint and role-specific destination. Host-only cookies and current backend URLs/API/socket relays are retained.
- Custom domains use unique Mongo reservations, fresh hospital-specific TXT challenges plus provider project ownership and DNS routing checks, bounded sanitized provider requests and safe retry/removal. Reservation challenges fence stale verification/removal after recreation. Public resolution uses minimal metadata and current ownership/status rather than cached legacy flags. Checks used synthetic provider/DNS responses.
- Visits persist explicit practice type, hospital identity and mode, preserving queue/token identities. Client overrides must match server context. The independent current doctor session is the default; active accepted hospital memberships are distinct named queues. Revoked memberships/inactive hospitals are excluded. Selection clears prior clinical UI; forbidden queues return to independent practice, with stale-error guards.
- Hospital booking now opens its reservation form instead of a doctor-id triage URL, sends hospital/in-person context, supports keyboard confirmation/Escape, explains check-in/demo credits and links to visit tracking. Unknown waits are unavailable. Tracking supports owned family tokens and guards previous-account snapshots.
- Prepared dry-run/apply/rollback migration with exclusive private BSON-aware backup, conflict checks, canonical fingerprints, stale-data refusal and transactional writes. Legacy domains require fresh verification. A rehearsal caught BSON field-order dependence in rollback; canonical hashing fixed it and the repeated rehearsal passed. Empty local bootstrap initializes domain indexes.

### Checks

| Check | Result |
|---|---|
| Backend unit/regression | **56 passed**, final full run, including six P07 cases |
| Backend integration | Full file-sequential run **84 passed**; final P07 suite **12 passed**, including two additional cases: **86 distinct integration cases executed successfully** |
| P07 integration coverage | Claim concurrency, tenant/reserved-domain rejection, TXT/project/routing ownership, provider outage, removal/recreation fencing, three practices sharing a doctor, membership/hospital revocation, migration conflicts/stale apply/rollback and CLI rehearsal |
| Frontend browser | Isolated full suite **52 passed** on desktop/390px mobile; latest product suite **22 passed**, including cross-product hospital discovery: **54 distinct browser journeys verified**; final host precedence rerun **4 passed** with Connect/app/api also listed as aliases |
| Frontend build | Final production build passed; main bundle **1,566.62 kB**, gzip **379.86 kB**; existing size warning remains |
| Affected lint | **0 new findings** across 18 source files against P07 snapshot; existing **87 errors / 6 warnings**. Final App/host parser routing check **0 findings** |
| Syntax/whitespace | **18 backend syntax checks passed**; targeted tracked whitespace passed with Windows CRLF handling, excluding unrelated OneDrive placeholders |
| Cleanup | **0 remaining generated integration databases / 0 test Redis keys** |

One combined browser/build run had an audio-only media timeout (49 passed / 1 failed). Earlier 48-case and subsequent isolated 52-case runs passed, including both participants' synthetic media on desktop/mobile. No cause was established or assertion relaxed. An initial product assertion expected no token despite its fixture supplying one; it was corrected. Integration fixture validation omissions were corrected before successful runs.

### Rollout and remaining work

[P07_PRODUCTS.md](P07_PRODUCTS.md) documents migration/rollback, DNS/TLS/hosting, exact CORS origins, host-only cookies, Google origins/redirects and the optional API alias. Migrate before enabling domain administration; legacy domains need fresh verification. Keep path fallbacks/current backend URL until approved configuration is ready.

No existing development/production migration, live DNS/TLS/CORS/Google/provider change, purchase, deployment or Docker image rebuild was executed. Docker Desktop and existing Mongo/Redis images supported isolated tests. Existing lint debt and approximately 1.57 MB main bundle remain. Patient history, room/file guidance, wait forecasts, broader visit modes and the visual overhaul remain later tasks; P08 is next.

Main files: product host/location/router/context/home, App/auth/login/navigation, hospital booking/tracking, doctor queue/snapshot guard, domain controller/model/resolver, queue context/booking/models/migration/bootstrap, fixtures/tests, environment examples and rollout/review/work log.



## P08 — Visual system and product shells (9 October 2026)

### Implemented and verified findings

Preserved P01–P07 work. Verified the absence of a shared visual foundation and the legacy marketing page's unverified named testimonials and unsupported QR-prescription claims.

- Added scoped warm-white/slate surfaces, teal actions, blue keyboard focus, typography/spacing, responsive navigation, dark surfaces and reduced motion. Reused the Lucide heart consistently. Company, care/patient and hospital staff shells share the visual system while retaining P07 routing and session boundaries.
- Rebuilt the company home around Connect and Hospitals with actual product links and supported capabilities; refreshed Connect's entry page. Replaced the old Home and Footer implementations with compatibility exports. Removed named testimonials and unsupported marketing claims; the company home no longer includes the floating legacy bot.
- Added reusable buttons, labeled fields, native modal dialogs, cards, tables, status badges and loading/empty/error states. Dialogs restore focus, wrap Tab/Shift+Tab and support Escape/backdrop dismissal. Staff mobile navigation supports outside dismissal and keyboard focus restoration.
- Hospital branding accepts normalized hex only, chooses readable action text and derives light/dark foreground colors tested at 4.5:1 against their intended surfaces. Existing hospital actions use safe foreground/background pairs.
- Patient visits use owned API records, actual status/date/session and refresh timestamps. Initial fetch failure offers retry instead of remaining in a loading state. No queue ETA, appointment slot or room direction is fabricated.
- Nursing station uses current auth context, real reservations/queue snapshots and compact labeled forms. Required name and optional contact/age validation prevents invalid issuance requests. Blank vitals are omitted rather than submitted as empty measurements. Existing revisions, snapshot guards, request idempotency, check-in and demo-credit behavior remain intact.

Main files: frontend App, ProductShell, Navbar, Home/Footer compatibility exports, ProductHome, PatientVisits, HospitalWebsite, NursingStation, index.css, shared ui/index.jsx and visualSystem.js; frontend test:ui script, pure unit tests, browser design checks, synthetic fixture additions and product reload assertion. Component conventions are in [P08_DESIGN_SYSTEM.md](P08_DESIGN_SYSTEM.md).

### Verification

- `npm run test:ui`: **5 passed**, including color normalization, light/dark contrast and walk-in validation.
- Production `npm run build`: **passed**; main bundle **1,148.43 kB**, gzip **332.63 kB**. Existing large-chunk warning remains.
- Affected lint: **0 new diagnostics** across 11 source files against the P08 snapshot; **3 existing errors / 4 existing warnings** remain. Rule/severity/message comparisons normalize shifted line references.
- Targeted design browser suite: **13 passed / 1 intentionally skipped duplicate viewport sweep**. Rendered company, Connect, patient and staff routes at **360px, 768px and 1440px**, saved 12 screenshots and checked page overflow. Visually inspected company desktop/mobile, patient mobile, staff desktop/mobile and Connect tablet. Keyboard navigation, focus restoration, modal containment, validation, omitted blank vitals, dark brand action text, reduced motion and patient retry recovery passed.

Initial checks caught a temporary nursing-page parse error, missing modal Tab wrapping, a mobile test's pre-render keyboard timing and an unused import; corrected before successful targeted checks. The first complete browser run had **64 passed / 1 failed / 1 skipped**: a disposed response occurred in the synthetic-host reload fixture. Its previous assertion could finish at DOMContentLoaded before the doctor directory rendered. Strengthened the assertion to wait for the actual directory heading; the exact disposal timing was not established; no response error is swallowed and no assertion relaxed. The final complete run is recorded below.

All browser records are synthetic local fixtures; calls use fake Chromium devices/local signaling. No backend schema or dependency changes are needed for P08. Backend integration was not rerun for this frontend-only batch. No existing database migration, provider activation, live configuration, deployment or Docker image rebuild was executed. Remaining legacy page bodies, broad accessibility review, lint debt and bundle splitting remain follow-up work. Next is **P09 appointment scheduling backend**, then P10 appointment/waiting-room UI using this foundation.

Final complete frontend browser run: **67 passed / 0 failed / 1 intentionally skipped** across desktop and mobile, including all 54 existing booking/call/product cases and 13 new design checks. Ran without concurrent build work.

Final formatting check: preserved unchanged snapshot lines and original line endings across the 20-file P08 change; normalized contents stayed identical. Targeted tracked-file whitespace check passed with Windows CRLF handling.


## P09 — Appointment scheduling backend (9 October 2026)

### Implemented and verified findings

Verified the review's current-day queue-only limitation and absence of persisted availability/capacity reservations. Preserved P01–P08 code and existing immediate booking contracts.

- Added configured dated sessions and actual slots for scheduled online consultations, online OPD capacity windows and hospital in-person visits. Session identity includes practice/doctor/date/timezone; real breaks remove slots. Doctor leave and hospital-local pause controls gate availability, confirmation and admission.
- Canonical doctor transaction locks prevent overlapping dated sessions across independent and hospital practices. Patient/family locks and conditional capacity increments protect competing holds/reschedules across API processes. Holds expire durably, release capacity exactly once and never charge credits.
- Confirmation writes frozen fee, demo-credit transfer, appointment, optional hospital token, reservation/request identity and durable visit event in one Mongo transaction. Insufficient funds or post-ledger resource failure leave no debit/visit; committed retries replay the resource. Existing immediate bookings now also carry explicit type/fee snapshots.
- Future reservations retain compatible queued storage status plus reserved admission state. Online patients check in within the actual arrival window; authorized staff confirm hospital arrival. New reservations are excluded from ready queues before arrival/start. Arrival ordering is shared by queue positions; hospital token order is retained. Existing revision/single-active/terminal-state and clinical permission constraints remain.
- Added policy-bound cancellation/full demo refunds, same-doctor/practice/type/fee rescheduling and stable request replay. Target capacity/stale/ownership conflicts preserve the source booking. Shared visit/refund transitions release reservation capacity on cancellation/no-show/completion. Future bookings have no immediate auto-refund timer; admitted online visits start the existing missed-response timer no earlier than the slot start.
- Added public real availability, private confirmation/tracking/history and management APIs. Payloads distinguish holds from paid reservations, expose freshness/next steps and actual admission/payment state, and keep unknown room/ETA unavailable. Revoked memberships/absent doctors cannot admit existing reservations. No appointment availability or room directions are fabricated.
- Prepared additive scheduling collections/indexes, explicit-target dry run/apply/guarded rollback, startup readiness and empty-local bootstrap. Legacy records need no P09 backfill or replacement of P03 queue indexes. Rollback refuses after scheduling data exists; recovery must move forward.

Main files: scheduling models/router/policy/lifecycle/service/schema/initializer; appointment/token fields, queue adapters, arrival position service, visit/refund/payment integration, expiry worker/runtime/bootstrap; unit/integration/HTTP fixtures and integration runner. [P09_SCHEDULING.md](P09_SCHEDULING.md) records invariants, configurable defaults, API examples, migration/recovery and P10 contracts. Earlier credential rotation/provider/DNS rollout requirements remain external actions.

### Checks and corrections

- Final backend unit/mocked regression run: **65 passed / 0 failed**, including nine P09 policy/index/clock cases.
- Initial P09 integration suite: **22 passed**, including actual simultaneous requests through two separate API processes.
- First complete backend integration run: **111 passed / 0 failed** (86 earlier cases + 25 P09 cases). Added arrival-order and guarded CLI rehearsal coverage for the final run recorded below.
- Node syntax checks passed for **24** changed/new JS/MJS files before final documentation/formatting checks.

An initial unit run found an older mocked staff queue fixture lacked the new configured-session model; added an empty synthetic session fixture without relaxing permission assertions. An initial integration launcher refused missing explicit TEST targets before connecting; reran with localhost replica-set/test Redis configuration. Inspection found scheduled queue positions still used booking order; extracted a shared arrival-order helper and added a regression. No financial assertions or production checks were bypassed.

All integration writes use generated local medipulse_test databases, synthetic identities and Redis fixture prefixes on database 15; real mail/AI/Kafka delivery is disabled. Migration rehearsal uses a separate disposable database and private temporary index backups. No existing development/production database migration, provider activation, Docker image rebuild, DNS change or live deployment was performed. The frontend remains the P08 implementation; P10 will use these backend contracts for appointment/waiting-room UI. Recurring calendar templates, mixed-fee/provider rescheduling and bulk leave notifications are later extensions.

### Git publication

The repository had damaged OneDrive Git objects and an unreadable origin/main reference, which prevented tree construction/fetch. Recovered matching objects from a clean temporary bare clone of the existing GitHub repository, moved the broken remote reference to a temporary backup and recreated it at the verified remote hash. Working files and existing changes were preserved. No history rewrite or force push was used.

Committed the previously verified P01–P08 baseline separately as **303f02bc**, with P09 edits excluded using the saved phase snapshot. Pushed it to **codex/p09-scheduling-20261009**. Reviewed candidate files for credential URI/private-key/provider-token patterns; no matches were found. P09 is prepared as a separate phase commit on the same branch; the publication hash is reported in the phase completion response. Main is not merged and no deployment was initiated.

Final complete backend integration run: **113 passed / 0 failed** (86 prior cases + **27 P09**). Guarded CLI dry-run/apply/rollback and refusal after use passed in a separate isolated database. Final cleanup check: **0 generated integration databases / 0 test Redis keys**. No frontend code changed in P09; frontend build/browser results remain the separately verified P08 baseline.

Final source check: **24 syntax checks passed**, targeted tracked-file whitespace passed, new files had no trailing spaces, and unchanged lines/line endings were restored without changing normalized contents. Candidate-source credential URI/private-key/provider-token scans found no matches.


## P10 — Appointment and waiting-room UI (10 October 2026)

### Implemented and verified findings

Verified the P08 appointment screens still used immediate queues, the P09 API supplies actual dated availability/holds/reservations, and doctor affiliations use hospitalName/hospitalId. Preserved P01–P09 behavior and existing immediate routes.

- Rebuilt doctor discovery/profile, shared independent/hospital booking, MyAppointments and owned reservation tracking with P08 controls. Care type, self/family, real session/date/slot, actual fee/policy review and confirmation are explicit. Guest sign-in returns to selection; hospital doctor profiles/direct booking retain hospital context.
- Holds do not charge or assert confirmation. Stable request identities and minimal owner/provider-scoped drafts preserve original interrupted hold/confirmation/mutation requests across reloads. Failed/pending payments retain recovery actions without false success; capacity conflicts preserve patient/date. Synchronous guards prevent duplicate local submissions.
- Tracking shows actual slot/token, arrival, queue position when known, payment, next step, status freshness, permitted reschedule/cancel and online check-in. Hospital visits require staff arrival and expose no video. Active online visits reuse the existing call implementation with leave/rejoin. Unknown room/ETA stay unavailable.
- Private scopes dispose old requests and hide old-owner rendering. Access-denied/missing private responses clear cached details, including held receipt fallback. Network/server failures retain visibly stale details. Queue revision guards survive manual retry and reject an older snapshot. Offline mutation controls are disabled.
- Preserved legacy queued cancellation through P04’s canonical server refund identity, with pending/completed distinction, original revision retry and native confirmation. Draft consultation summaries remain downloadable; jsPDF loads on demand. Calendar downloads use actual UTC times and a 15-minute alarm without claiming delivered mail or adding medical/patient input.
- Shared hospital review stays within one native dialog and scrolls/focuses its heading after the hold. Published slots, fees, cancellation terms and doctor information come from existing APIs; unrecorded professional verification is explicit.

Main files: appointment components, care-resource hook, formatting/calendar/download helpers; doctor/booking/history/tracking pages, hospital booking/visits, App routes, safe login return, targeted styles and synthetic fixtures/tests. [P10_APPOINTMENT_UI.md](P10_APPOINTMENT_UI.md) documents contracts and recovery boundaries.

### Checks and corrections

- Final `npm run test:ui`: **13 passed / 0 failed** (eight appointment utilities plus five design utilities).
- Affected ESLint comparison: **0 new diagnostics** across **16 source files**; **36 existing errors / 1 existing warning** remain (baseline 47 findings). Rule/severity/message comparisons normalize shifted line references.

The first appointment browser run had **28 passed / 1 failed / 1 intentionally skipped**. Its mobile recovery test clicked a booking-only refresh control after automatic recovery had already navigated to confirmation. A later expiry check encountered the same obsolete-control race when an in-flight read had already shown expiry. Changed those checks to await the actual recovered/expired state, retaining payment-count and disabled-confirmation assertions. Partial follow-up runs were stopped before source refinements; their results are not counted as complete runs. Source inspection/screenshot review also corrected hospital affiliation fields/care routing, denied-access cache retention, hospital modal scroll position and revision reset on manual retry. Added regressions for those workflows without bypassing financial or authorization assertions.

All browser records are synthetic local fixtures with external requests blocked; calls use fake Chromium devices and local signaling. No backend source, schema or dependency changes are required for this phase. Backend integration was not rerun; P09’s separately verified backend results remain recorded above. No existing database migration, live configuration, provider activation, deployment, DNS change or Docker image rebuild was executed. Published availability requires P09 configuration. Real room/file guidance and ETA depend on P12/P13; broader UI/accessibility and remaining page bodies continue in **P11**.

### Final verification and publication

- Complete frontend browser suite: **108 passed / 0 failed / 2 intentionally skipped duplicate viewport sweeps**. Includes **41 active P10 cases** and **67 earlier cases** across desktop/mobile, with keyboard booking, real browser media/signaling fixtures, refunds, family ownership UI, offline/revoked access, online arrival and stale-revision recovery. Ran separately from the production build.
- Responsive appointment sweep rendered discovery, profile, booking, tracking and history at **360px, 768px and 1440px** and saved **15 screenshots**. Online OPD and hospital review saved **4 additional desktop/mobile screenshots**. The earlier shell sweep also saved 12 screenshots: **31 total in the final run**. Visually inspected booking/tracking mobile, profile desktop, online OPD reviews and corrected hospital review desktop/mobile. Browser artifacts are under the local temporary `medipulse-p10-browser-verified` directory; records and screenshots are synthetic.
- Final production build: **passed**; main bundle **754.02 kB**, gzip **207.10 kB**; lazy jsPDF chunk **390.24 kB**, gzip **128.71 kB**. Main bundle is smaller than P08’s separately recorded baseline; the existing large-chunk warning remains.
- Final utility rerun after source formatting: **13 passed / 0 failed**. Restored original unchanged lines/endings in five frontend files and verified normalized content stayed identical. Documentation formatting was similarly preserved; targeted whitespace and candidate-source scans are checked before commit.
- Credential URI/private-key/provider-token pattern scan: **27 candidate files / 0 matches**; no matched credential text was printed.

Prepared as the next phase on **codex/p09-scheduling-20261009**, following P09 **1f209796**. Commit/push are authorized by the user’s earlier instruction; the phase hash is reported in the completion response. Main is not merged and no deployment is initiated. Next task is **P11**, one remaining UI batch per run.
