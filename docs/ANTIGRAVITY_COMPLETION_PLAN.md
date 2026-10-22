# MediPulse - final Antigravity completion plan

> Current checkpoint update, 22 October 2026: read [AG22_VERIFICATION_REVIEW.md](AG22_VERIFICATION_REVIEW.md) and the corrected ledger first. 32c85bde added enterprise routes/consoles and repaired the five Mongo fixtures; older absent-route/failing-fixture statements below are historical. Continue the concrete remaining access/clinical/financial/provider/adapter requirements. Enterprise runtime defaults off pending operating readiness; local verification is not completion.

Updated 22 October 2026. Starting code checkpoint: **72635cd0** on `main`. This is the execution plan for remaining work, not a completion certificate. Use [IMPLEMENTATION_TASKS.json](IMPLEMENTATION_TASKS.json) for statuses/dependencies and [ANTIGRAVITY_FINAL_REVIEW.md](ANTIGRAVITY_FINAL_REVIEW.md) for verified defects and prior checks. Do not repeat the original implementation from scratch.

## 1. Target and execution order

Deliver the requested company website, independent doctor/patient Connect product and hospital operations product, then complete the enterprise hospital expansion. Preserve the working outpatient implementation while finishing missing workflows.

| Order | Existing task | Deliverable | Required predecessor / decision |
|---|---|---|---|
| 1 | AG05 | Secure, usable walk-in account claim | AG02/AG04 already verified locally; approved verification-delivery contract needed |
| 2 | AG16 | Outpatient UI, connected journeys and operating release acceptance | AG05 plus existing AG08/09/11-15; production/device/provider evidence remains separate |
| 3 | AG17 | Approved enterprise requirements, roles and policies | AG16; actual hospital/qualified reviewer decisions |
| 4 | AG18 | Connected admission, bed, transfer and discharge workflow | AG17 |
| 5 | AG19 | Connected inpatient orders, nursing, administration and handover | AG18 plus approved clinical policy |
| 6 | AG20 | Emergency registration/triage workflow and theatre operations | AG18/AG19 |
| 7 | AG21 | Hospital revenue, insurance, procurement and stock | AG17/AG18; can precede AG20 once its own dependencies are satisfied |
| 8 | AG22 | Actual agreed external adapters, observed recovery and enterprise acceptance | AG19/AG20/AG21 |

One bounded work package per commit. Subsections here do not introduce a competing task ledger. Keep dependencies truthful. If an external requirement blocks completion, record its owner, missing input and next command; retain containment and continue independent local work whose dependencies permit it. Requirements drafts, fixture repairs and local adapter-contract preparation may proceed while awaiting a production decision, but do not count as completing or releasing dependent tasks.

**Preserve the baseline:** review recorded 330 core integration, 224 backend unit, 59 frontend unit and 20 targeted browser passes (2 duplicate viewport sweeps skipped), clean affected lint/build and zero reported dependency advisories. These are historical reference counts, not a test quota or evidence for future changes. Five enterprise Mongo suites failed fixture setup and are excluded from that core runner.

## 2. Rules for every work package

- Follow AGENTS.md and Common in MEDIPULSE_CODEX_PROMPTS.md. Existing stack: React/Vite, Express/Mongoose, Mongo transactions, Redis and Socket.IO. Keep real route mounts and account/staff session/CSRF scopes.
- Implement persistence, authorization, actual service/controller/router, usable UI and meaningful tests together. Derive actor, hospital, department, patient/family and permissions from trusted session/source records, never caller claims.
- Use durable command keys, fingerprints and revision/conditional updates for competing writes; preserve actor/time/history and recovery after lost responses. Test actual service logic and routers, not service replacements that reimplement the expected answer.
- Preserve all original patient/payment/credential/wallet/archive records. Clinical text stays draft until qualified version/source-bound review. Labs allow collection before billing; verifiers require explicit approval and independence from the author. Demo credits remain distinct from real payments.
- Use shared neutral/deep-teal tokens, reusable UI and doctor-name formatting. Keep unknown clinical/room/file/ETA states honest. Do not introduce a second visual theme or invent defaults that appear clinically authoritative.
- Production DB/index/seed execution, provider activation, DNS, real mail and deployment-console actions retain Common's separate exact approval requirement. Existing Git commit/push approval is already granted: main, Khushal Midha <khushalmidha24@gmail.com>, no Codex coauthor or force push.
- If Astra is used, the owner's effort limit is **Medium**. Read only relevant source and the selected work package; do not paste the entire repository or repeatedly regenerate this plan.

## 3. AG05 - verified walk-in ownership (P0)

**Start here:** backend/services/encounterJourneyService.js, backend/controller/encounterJourney.js, backend/middleware/encounterAccess.js, backend/routes/encounter.js and frontend/src/pages/hospital-website/PatientVisits.jsx.

1. Record the delivery contract: approved phone-verification channel/provider, trusted recorded phone, intended self/family identity, who can correct a missing/wrong phone, consent, expiry/rate limits and delivery-status semantics. An account email or caller-supplied phone does not establish ownership of the recorded walk-in identity. Do not silently substitute email verification for phone proof.
2. Implement server-generated OTP, secure stored verifier, bounded attempts/resends, durable delivery/retry status and sanitized audit. Never accept a chosen OTP on challenge creation, expose runtime devOtp or return sent before the defined delivery acceptance. Missing identity proof/provider fails clearly.
3. Bind challenge and proof to encounter, hospital, account, exact patient/family and current challenge generation. Use conditional consumption so resend versus verify, simultaneous claims and replay cannot change ownership or consume a newer code with an older one. Link source records transactionally while preserving original walk-in history/person identity and balances.
4. Complete the patient dialog: correct encounter identifier, phone masking, intentional family selection, pending/failure/expiry/rate-limit states, retry and response-loss recovery. Hide or explain unavailable claim instead of offering a fake successful flow. Keep existing non-test request/verify/link containment until the real implementation and negative cases pass.

**Exit evidence:** actual-router tests for forged client OTP, foreign/expired/wrong/rotated proof, wrong self/family, attempt exhaustion, failed/unknown delivery, concurrent resend/verify/claim, single-winner ownership and replay after committed response loss. Browser checks include denial, interrupted delivery and successful owned-family linking. Production activation/inbox or handset evidence is recorded separately; local fake transport tests do not close that requirement.

## 4. AG16 - finish and release the outpatient product

### A. UI and complete user journeys

Inspect current implementations before editing. Reuse the existing company/Connect/hospital resolver and public/staff shells. `medipulse.live` remains the owned domain; `/connect` and `/hospitals/:slug` fallbacks must keep working. Any `connect.medipulse.live` or hospital subdomain activation follows the existing approved DNS/host-ownership process; no extra domain purchase is required for those subdomains.

| Actor / journey | Required visible behavior and proof |
|---|---|
| Patient: doctor discovery and symptom guide | Directory results are actual eligible doctors; unavailable AI has clear recovery to browsing, no invented doctor or diagnosis; independent and hospital contexts remain distinct |
| Patient: appointment / online visit | Search/filter, fee/date/time/mode/person selection, confirmation, cancellation/reschedule and response-loss retry; real capacity and no duplicate debit; lobby, permission failures, fullscreen/fallback, mute/camera, reconnect, leave/rejoin and end behavior |
| Patient: hospital arrival and history | Owned self/family ticket and real QR resolution, booked versus arrived state, live queue/qualified ETA, recorded room and file holder, visit timeline and only released/approved documents; print/download and account-switch disposal |
| Hospital doctor and independent doctor | Correct practice/session, arrived queue, pause/revision behavior, start/save/complete, reviewed SOAP, linked lab/Rx orders and critical acknowledgement; no privilege crossover or duplicate Dr prefix |
| Reception and nurse | Assisted walk-in, authorized arrival/vitals, room/stage guidance and send/accept/refuse custody; stale or wrong-recipient action cannot move a file |
| Lab and pharmacy | Actual assigned worklists, ordered parameters, approved independent result verification/release/amendment, real batch allocation/partial fills/returns and version history; failed or denied operations retain honest recovery |
| Hospital admin / operator | Real setup/invite acceptance, scoped permissions and verifier approvals, departments/locations, quota/suspension/activation, support and minimized export; no access granted merely by displaying an admin page |
| Community organizer / member | Eligible community discovery, paginated membership/chat, report/moderation, event and preference delivery; authorization and notification opt-out remain effective |

For changed surfaces check 360/768/1440 widths, light/dark theme, contrast, text overflow, keyboard/focus/Escape, clear primary actions and loading/empty/error/offline/denied/stale/pending states. Appointment booking and the consultation room are highest UI priority. Do not label a whole-site audit passed after checking one dashboard. Record routes/roles actually rendered and any exclusions.

### B. Repeatable connected demo

Reuse AG15's manifest/rollback tooling. Prepare a **local** deterministic graph with hospital and independent doctors, reception/nurse/lab/pharmacy/admin actors, self and child/family patients, live and completed visits, location/custody events, released/amended reports, partial prescription fills and community activity. Include at least one failure/retry demonstration. Keep records linked to the actual patient, encounter, department, order and responsible actor; counters must derive from these records.

Use clearly synthetic labels, isolated fixture credentials and disabled outgoing mail/providers. Preserve the approved existing owner accounts; do not reset roles/passwords or import another blanket dataset. Any new production demo execution requires an exact manifest, precondition checks, backup, rollback and the separate approval. Provide a short repeatable screen-demo run sheet; never claim synthetic evidence is real patient adoption or clinical validation.

### C. Local and production acceptance

- Run targeted checks while fixing each work package; once the local candidate is stable run the full backend unit/integration suites, frontend units, affected lint, production build and full portable browser suite. The previous review ran only a targeted browser subset. Record actual counts, failures/skips and artifacts for the exact revision.
- Prepare read-only schema/index/data inspection and additive recovery plans using the existing tools. Preserve conflicts for reviewed repair; no startup index creation, silent duplicate deletion or test against a production URI.
- Reconcile exact frontend/backend commits and configured API origin, Node runtime, host/TLS routing, health/readiness, secure cookies/CSRF and worker configuration. A successful push/build is not live deployment acceptance.
- After the required exact approvals, observe verified delivery, outbox retries/outages, actual staff/patient journeys, physical camera/microphone and cross-network TURN, QR print/scan and an authorized restore/recovery exercise. Agree support ownership, monitoring/alerts and export/deletion handling; policy decisions must be recorded before real deletion.
- If real online collection/subscription settlement is part of the agreed release, implement approved merchant checkout/webhook/idempotent reconciliation/refund acceptance as explicit work packages. Until then, visibly retain demo-credit status and record real payment activation as open; simulated checkout does not fulfill it.

**Exit:** every required journey has actual evidence, schema/data and external gates have explicit outcomes, unresolved required items stay open, and the hospital/owner accepts the exact deployed outpatient scope. `verified_local` remains distinct from `productionAcceptance`.

## 5. AG17 - agree enterprise requirements before activation

Treat docs/ENTERPRISE_PLAN.md and backend/config/enterprisePlan.js as unapproved proposals. Record the actual hospital/site, departments/wards, actor/capability matrix, inpatient identity/family rules, state transitions, clinical sign-off/escalation ownership, retention/export rules, financial policy, deployment capacity and recovery objectives. Obtain the relevant owner/qualified reviewer decisions; do not invent statutory numbers, clinical thresholds or certifications.

For each AG18-AG22 milestone define required screens/commands, integrations/vendors, operating prerequisites, migration/index needs, downtime procedure, success/failure scenarios and acceptance owner. Maintain an explicit required/deferred/unapproved scope list; do not silently remove requested functionality to clear the ledger. Prepare local work while a decision is outstanding, but keep the corresponding acceptance pending.

**Exit:** approved requirements and role/policy decisions are linked to every enterprise work package, with unknowns and owners explicit.

## 6. Enterprise implementation - one actual vertical workflow at a time

**First repair the evidence:** the five tests/integration enterprise files currently fail Hospital required-field validation. Build valid tenant/department/staff/patient/admission fixtures using actual schemas. Do not weaken production validation or substitute the business service to get green tests. After each milestone's real suite works, register it in backend/scripts/testIntegration.js so the default runner covers it. Missing infrastructure/skipped tests are not integration acceptance.

All milestones need trusted actor/tenant/capability checks in HTTP **and service boundaries**, correct CSRF, active tenant/entitlement checks, source patient/family binding, named-index readiness, conditional revisions/durable command identity and immutable history. Add actual mounted routes/controllers and role-gated UI only when the complete workflow is ready. A schema, exported function, constant entitlement or sidebar item is insufficient.

| Task / source | Implement and connect | Required regression and operating evidence |
|---|---|---|
| **AG18:** inpatient.js / ipdAdtService.js | Ward/room/bed setup and availability; admission and responsible team; transfer; cleaning/maintenance; approved discharge clearances and signed summary tied to patient history | Concurrent admissions cannot occupy one bed or duplicate an admission; transfer loss retains original bed; stale transfer/discharge, foreign identity and denied role fail; committed retries preserve one history; staff bed-board/admit/transfer/discharge browser journey |
| **AG19:** nursingCare.js / nursingCareService.js | Clinician draft/sign/modify/discontinue orders; shift assignment/handover; observations and approved escalation; administration/omission/refusal with required independent witness policy; link lab/pharmacy tasks and patient history | Order-change versus administration, duplicate dose submission, wrong patient/shift/witness, stale signed version and revoked permissions; no automated AI administration; actual nurse/doctor UI and qualified review of agreed scenarios |
| **AG20:** emergencyTheatre.js / emergencyTheatreService.js | Approved emergency registration/triage/handover; theatre room/team/equipment reservations; consent/checklist references, cancellation/reschedule and recovery handover | Competing room/surgeon/anesthetist/equipment reservations serialize; missing prerequisites, stale checklist and wrong actor denied; cancellation releases resources once; approved staff workflow browser/clinical review evidence |
| **AG21:** hospitalRevenueStock.js / hospitalRevenueStockService.js | Versioned tariffs, inpatient folio/accrual, approved invoice/payment/credit/refund and insurance allocation; supplier/GRN, central/ward batch stock and expiry/quarantine | Concurrent/replayed accrual, payment, credit/refund and split transfer conserve money/stock; immutable financial/stock entries and reversal history; independent receipt reconciliation, cutoff/date/rounding rules and tenant/family/role denial; finance/store/ward UI evidence |
| **AG22:** hospitalIntegrations.js / hospitalIntegrationsService.js | One delivery ticket per agreed LIS/HL7/ASTM, PACS/DICOM, identity/SSO/SCIM or other required adapter; authenticated ingestion, identity mapping, idempotent processing, error/reconciliation queue and downtime ownership; actual restore and capacity exercises | Actual parsing/protocol or handshake against local vendor-contract fixtures, duplicate/changed payloads, wrong patient/tenant, out-of-order/dropped/replayed events, outage recovery and controlled external acceptance; restore observed with independently measured integrity/RPO/RTO against agreed objectives |

For AG22, interface configuration is not message processing, a PACS URI is not a tested viewer, and SSO settings are not SAML/OIDC authentication or SCIM provisioning. Contract selection and tenant role mapping must be explicit. Do not store raw secrets or log patient payloads unnecessarily. Keep acceptance `prototype_only`/`not_accepted` and DR `recorded_unverified` until the corresponding actual evidence exists. Preserve historical audit rows; do not convert declarations into verified observations.

**Each milestone's exit:** actual scoped API/service/persistence/UI behavior, real integration/race/recovery tests registered, additive migration/rollback plan, relevant browser journeys, and separate hospital/provider acceptance recorded. Keep the existing outpatient suites green.

## 7. Final completion and interruption protocol

For every completed package record in WORK_LOG: task/substep, base/current commit, changed behavior/files, actual commands/results and artifacts, known failures, migrations and unresolved external decisions. Update the ledger, IMPLEMENTATION_STATUS and LAUNCH_REPORT without overwriting historical evidence. Commit/push main as Khushal after each reviewable phase. Record exact next step and safe command if interrupted.

Before claiming the **full product** finished, verify:

- AG05 and AG16 plus every required AG17-AG22 package has real evidence and truthful ledger status; no required functionality is hidden behind an unreported stub, service double or disabled action.
- Full candidate unit, registered integration (including repaired enterprise suites), browser, affected lint, build and dependency audit results are recorded for the exact source/dependency revision. Counts may grow; no silent skips or unsupported zero-regression claims.
- The actual deployed pair, approved schema/data operations, provider/delivery, physical devices/TURN, observed restore, operator/clinical workflow acceptance and release/rollback ownership are recorded. No unapproved clinical/regulatory/payment assertion remains in UI or exports.
- Existing records/credentials/balances/archives remain intact; connected demo is repeatable and distinguishable from real usage; main is published under the owner's identity with clean status or an explicit unrelated-edit note.

Final handoff: release scope and exact commits, task/check evidence, schema/provider operations actually performed, any open owner actions and rollback/support instructions. If only the outpatient release is accepted, say exactly that and keep enterprise work open. If an external requirement remains unavailable, report it precisely; do not mark it complete to wrap up.

## 8. Short Antigravity launcher

```text
Read AGENTS.md, docs/ANTIGRAVITY_COMPLETION_PLAN.md, docs/IMPLEMENTATION_STATUS.md and Common in docs/MEDIPULSE_CODEX_PROMPTS.md. Continue from the current main checkout, preserving unrelated edits. Run node tools/check-implementation-plan.mjs --next; start with AG05 and the plan's section 3, verifying current code rather than repeating completed work.

Implement one dependency-ready package through actual service/API/persistence/UI and meaningful local checks. Follow sections 4-7 until the requested scope is genuinely complete. Keep walk-in containment and enterprise prototypes closed until their real prerequisites/evidence exist. If an external contract/approval is missing, record the exact blocker and continue independent permitted local work; do not fabricate provider, clinical or production acceptance.

Use isolated synthetic databases, the real route mounts/session scopes and the portable browser runner. Update the ledger/status/work log after each phase and commit/push main as Khushal Midha <khushalmidha24@gmail.com>, no Codex coauthor or force push. Existing Git authorization applies; production/provider/DNS/mail/deployment-console operations retain Common's separate exact approval. If using Astra, Medium only. Keep final updates concise and leave an exact continuation checkpoint if interrupted.
```
