# MediPulse - consolidated final execution plan

Updated **22 October 2026**. Code baseline: **81c951c8** on `main`, containing the independent fixes to Antigravity's **32c85bde**. This replaces the previous contents of this file and is the single continuation plan for the company site, Connect, hospital outpatient operations and requested enterprise expansion.

**Continue this same plan until acceptance.** All currently known gaps are included below. Newly discovered required defects enter the same checklist and are resolved before release; do not create another competing final plan. Discovery and final verification are mandatory because no review can guarantee that undiscovered bugs do not exist. This document does not claim implementation is finished.

Source precedence: current code and reproducible behavior; [AG22 verification review](AG22_VERIFICATION_REVIEW.md); [task ledger](IMPLEMENTATION_TASKS.json); this plan; [implementation status](IMPLEMENTATION_STATUS.md). Older reports are historical. Follow root AGENTS.md and Common in [the prompt pack](MEDIPULSE_CODEX_PROMPTS.md).

## 1. Preserve the delivered baseline

Booking/queues, encounters/file custody, qualified note review, outpatient labs/pharmacy, Connect/community, tenant onboarding, connected demo tools and mounted enterprise APIs/consoles already exist. Extend and verify them; do not rebuild completed foundations.

Preserve 81c951c8 safeguards: staff-cookie CSRF for all eight enterprise API families; truthful LIS receipt status and unavailable processing/replay; tenant/message deduplication; durable partial-stock command fingerprints and legacy ambiguity refusal; invoice/insurance source checks; safe money inputs; medication witness containment; truthful handover/escalation states; responsive shared-theme consoles and stale-resource cleanup.

Historical evidence: 376 registered integrations, 7 latest stock follow-up cases, 226 backend units, 60 frontend units and 18 targeted Chromium passes with 2 redundant viewport sweeps skipped; affected lint/build passed; audits reported zero advisories. The stock follow-up includes a guard added after the full runner started. **Full browser and production acceptance were not performed.** These are reference counts, not newly executed evidence or a target test quota.

Ledger: 23 tasks; 15 retain verified_local evidence; AG05/AG17 pending; AG16/AG18-AG22 implemented_pending_final_checks. This planning update changes no completion status. Detailed checklist entries start pending verification even where partial scaffolding exists.

## 2. Execution order and progress rules

1. Perform **AG16.D1-D3** discovery/preparation and assemble section 3 decisions once. Preparation does not complete AG16 or bypass its AG05 prerequisite.
2. Complete **AG05**, then **AG16** outpatient acceptance prerequisites. If provider input blocks AG05, record the concrete blocker and continue independent permitted local preparation/UI/testing.
3. Complete approved **AG17**, then **AG18**, **AG19**, **AG20**. **AG21** may proceed once its own AG17/AG18 prerequisites are satisfied; it need not wait for AG20.
4. Complete **AG22** after AG19/AG20/AG21. AG16.09 closes outpatient acceptance first; **AG22.06** repeats that verification across the final whole product. Do not make AG16 completion depend on later enterprise tasks and create a dependency cycle.

Use one reviewable package per phase/commit. The existing ledger's `completionChecklist` records subtask progress; do not create a second status system. Every package needs source/schema, scoped service/API, usable UI, concurrency/recovery, tests, migration/readiness and evidence as applicable. Explain genuinely inapplicable layers. Files, tabs, configuration rows and mocked service success alone cannot close a package.

For a newly found required defect, append a stable ID to its parent checklist and this plan with reproduction/source, severity, acceptance and evidence. Reopen previously verified tasks if their acceptance is invalidated; preserve historical evidence and reconcile dependent acceptance. Do not silently expand scope into unrelated products or remove required features to obtain completion.

## 3. One early decision and external-action register

During AG16.D1, fill each row with the responsible owner, exact choice/source, approval state, blocked package and independent work that can proceed. Consolidate missing inputs once. Ordinary coding and Git publication are already authorized; production actions still require the concrete approval below.

| Decision | Required input/owner | Blocks |
|---|---|---|
| Claim verification | Owner approves delivery channel/provider, trusted phone/contact correction, country rules, self/family proof and sandbox contract | AG05 |
| Runtime/hosts | Owner confirms frontend/backend projects, paired revisions, API origin/relay, workers and release/rollback responsibility | AG16.07-.09 |
| Live payments/subscriptions | Owner defines required checkout, merchant, settlement/refund and SaaS subscription scope versus labeled demo credits | AG16.07, AG21 |
| Communications | Approved email/SMS channels, preferences, permitted recipients and observed delivery owner | AG05, AG16, AG19 |
| Clinical governance | Qualified hospital reviewers approve capability assignments, witness, escalation, handover/discharge, triage, consent/theatre and medication policies | AG17-AG20 |
| Data/recovery/capacity | Responsible reviewer approves jurisdiction, retention/export/deletion, audit access, recovery objectives and capacity targets | AG16-AG17, AG22 |
| Interface contracts | Hospital/vendor selects required analyzers/protocols, PACS, SAML/OIDC/SCIM and any ABDM bridge; private credentials and site acceptance owner | AG22 |
| Schema/data/demo | Exact target/manifest, index/data inspection, writer coordination, preservation backup, rehearsal and recovery approval | AG16.D2, AG18-AG22 |
| Physical/operator acceptance | Owner/operator supplies device/camera/mic/cross-network TURN and qualified clinical/finance/operator acceptance | AG16, AG18-AG22 |

All requested product areas remain in scope. A particular optional vendor/protocol may be excluded only by an explicit owner scope decision. Missing credentials/time do not silently remove required features. Do not invent provider, regulatory, clinical or hospital approval.

## 4. Shared implementation requirements

- Keep React/Vite, Express/Mongoose, Mongo transactions, Redis and Socket.IO. Reuse actual production routes/services. Inspect targeted files for the selected package instead of repeatedly loading the repository.
- Enforce actor/hospital/department/team/person/family/capability in services and real mounted routes. Derive authority from trusted sessions and records. Body IDs, hidden navigation, role labels or adminAccess alone cannot authorize clinical actions. Revoke HTTP/socket access promptly and minimize projections.
- Map inpatient, nursing, emergency, theatre, revenue, procurement, integrations and enterprise writes to staff-cookie CSRF; preserve account scope elsewhere. Test browser cookie writes, not bearer tests alone.
- Persist mutation keys/fingerprints before first request and across retry/reload. Use atomic transitions, database resource fences and recoverable immutable outcomes. Abort/dispose stale UI requests/resources on account, tenant, role, department-assignment changes and access denial.
- Clinical outputs remain draft until qualified source/version-bound review. Labs allow collection before billing; independent verifiers need explicit approval. Demo credits remain distinct from real payment collection/settlement.
- Preserve records, credentials, wallets and archives. Refuse ambiguous legacy references/commands for reviewed repair; never guess, reset balances, rewrite history or fabricate expiry/verification/delivery.
- Keep **ENTERPRISE_PILOT_ENABLED=false in production**. Global containment is not per-hospital approval. Isolated local synthetic pilots may enable it with outgoing effects disabled. Controlled/high-alert dosing and LIS replay stay unavailable until actual prerequisites exist.
- Production DB/index/demo writes, provider activation, real delivery, DNS and deployment-console actions need Common's separate exact approval after preparation/rehearsal. Git authorization already applies: main, Khushal Midha <khushalmidha24@gmail.com>, no Codex coauthor or force push; preserve unrelated edits.
- Keep secrets/patient details/private backups out of Git and shared folders. Tests and demo creation never load production environment files or send real messages/payments. If Astra is selected, **Medium only**; do not spawn agents without explicit authorization.

## 5. Executable work packages

Each heading below maps to a pending entry in `IMPLEMENTATION_TASKS.json`. Close it only with actual source revision, commands/results and evidence references. Operating acceptance is additional where specified.

### AG05 - Verified walk-in account claim

#### AG05.01 - Approved channel and real runtime adapter

Inspect claimDelivery.js, encounterJourneyService.js, encounter access/routes and PatientVisits.jsx. Implement the approved provider/channel and trusted recorded contact/correction contract; credentials alone cannot activate the existing runtime stub. Bind self/family proof to the actual person rather than caller-selected phone/email.

**Exit:** Actual adapter/route contract cases cover success, rejection, timeout and ambiguous provider acceptance. Missing contact has an approved correction path; no real delivery without exact activation approval.

#### AG05.02 - Atomic challenge and durable dispatch

Reserve challenge generation/cooldown atomically **before delivery**. Persist outbox command, lease/recovery, retry/backoff and truthful dispatch states. Use cryptographic server OTPs, hashes only, expiry/attempt/rate limits and redacted logs; no runtime devOtp.

**Exit:** Concurrent resends, resend-versus-verify, delayed/out-of-order delivery, provider outage and restart/lost response cannot send unreserved challenges or reuse/redirect proof.

#### AG05.03 - Verified link and patient UI

Complete request/verify/link transactionally with session/visit/person/family/destination/generation binding. Preserve history and one-owner invariants. Provide request/resend/countdown/verify/recovery states and an exact activation/rollback proposal; retain runtime containment until prerequisites exist.

**Exit:** Actual Mongo, cookie-CSRF routes and browser cover self/family, foreign owner/tenant, expired/replayed proof, competing links and failed/retried requests. Approved real handset/provider evidence is separately required for production acceptance.

### AG16 - Whole-site UI, connected journeys and release

#### AG16.D1 - Initial scope and defect inventory

Reconcile current routes, services, schemas, UI callers and historical open findings against this plan. Inspect TODOs/placeholders/mock success for actual behavior. Record reproduction, source, severity and parent package for every confirmed required defect; retain suspicions as unverified. Recheck affected AG00-AG15 acceptance. Fill the section 3 register once.

**Exit:** A route-to-service-to-UI coverage map and combined decision register exist; every confirmed unresolved requirement has an acceptance check and dependency in this same checklist. Search hits alone are not confirmed defects.

#### AG16.D2 - Migration and readiness inventory

Inventory clinical/encounter/person indexes, family-aware admissions, command uniqueness, reservations, finance/stock and LIS tenant/message uniqueness. Prepare explicit dry-run/precondition/backup/apply/recovery tooling; preserve inconsistent legacy records for reviewed repair. Follow section 7.

**Exit:** Current outpatient changes have copy-rehearsed preservation, missing-index readiness failure and guarded recovery. Future enterprise requirements, including global LIS index replacement and ambiguous stock history, are inventoried for rehearsal under their own tasks after policy approval; no startup autoIndex/syncIndexes or production execution.

#### AG16.D3 - Test coverage and isolated fixtures

Prepare a scenario-to-test matrix using actual services/routes and persisted connected actors, local replica set/Redis and disabled provider sinks. Identify dependency-ready preparation while external decisions are pending.

**Exit:** Each required workflow maps to real service/router/browser checks, including denial, race and recovery. External-only evidence has a named owner; preparation does not complete its parent task.

#### AG16.01 - One visual system across every route

Inventory company, Connect, hospital microsites, patient/family, doctor, staff, SaaS administration, assistant, booking/calls and enterprise consoles. Apply shared neutral/deep-teal semantic tokens, reusable cards/forms/tables/dialogs, spacing and hierarchy. Preserve contrast-aware branding and one doctor-name display formatter; remove repeated Dr. prefixes without rewriting historical names.

**Exit:** Filled and empty screens at 360/768/1440 in light/dark pass overflow, contrast, focus order, Escape/return-focus and readable validation. Urgency uses text/icons as well as color; screenshots' red/blue clashes and invisible text are resolved throughout.

#### AG16.02 - Appointment and Google Meet style call journeys

Complete eligible doctor search/specialty/filter, date/session/timezone, mode, self/family, zero/unknown fee, reservation-versus-arrival and reschedule/cancel/refund/retry UI. Improve lobby, device selection, mic/camera, participant layout, fullscreen/fallback, reconnect, leave/rejoin and note-save/end controls.

**Exit:** Actual patient/doctor journeys cover competing booking, reload/lost response, family, zero fee, stale slots, cancellations and call failures without double capacity/charges. Separate physical-device/cross-network TURN evidence exists; synthetic media alone is insufficient.

#### AG16.03 - Arrival, guidance, queues and physical files

Follow online/offline visits through reception, nursing, doctor, lab and pharmacy on one encounter. Show next stage/room, actual file holder and timeline. Preserve recipient accept/refuse custody, persistent queue pause/order/priority and honest ETA uncertainty/staleness; minimize kiosk fields.

**Exit:** Filled multi-doctor/department browser/API/socket journeys agree after reconnect/restart. Paused/terminal visits receive no invented wait; pending handoffs do not prematurely move file custody.

#### AG16.04 - Records, labs and pharmacy

Reverify source/revision-bound qualified note review, released packets/history and clinician composers. Labs allow collection before billing; explicitly approved independent verification controls release/amendment. Preserve critical-result acknowledgement, amendments, prescription qualification, FEFO, partial fills, returns and quarantine.

**Exit:** A patient/family visit completes doctor-to-lab-to-pharmacy-to-released-record flow with critical/amendment/shortage exceptions. Author self-verification, foreign visit, stale review, duplicate allocation and unreleased patient reads have actual denial regressions.

#### AG16.05 - Connect, SaaS and AI reliability

Reverify independent-practice verification/publication/sessions, hospital/practice isolation, communities/moderation/events/pagination/preferences and real outbox callers. Complete tenant onboarding, one-use setup, quota/entitlement/suspension and admin capability flows. Verify the symptom-to-doctor recommendation entry point, consent/provenance, timeouts and no-provider fallback.

**Exit:** Browser/router cases cover dual-practice isolation, moderation, setup expiry/replay, concurrent quotas, revoked access and AI outage. AI cannot invent available doctors or claim diagnosis/clinical validation; core care works without it.

#### AG16.06 - Connected synthetic data and pitch

Reuse AG15 manifest/importer/recovery. Populate related patients/family, doctors/staff/admin, sessions/rooms, active/completed visits, accepted/refused file events, reviewed notes, released/amended labs, partial prescriptions, communities and derived metrics. Add enterprise fixtures as their workflows become valid. Supply a role-by-role pitch script and symptom-guide route.

**Exit:** The outpatient dataset passes isolated dry-run/apply/replay/recovery and reconciles links, stock/money and original fingerprints. Enterprise fixture completion belongs to AG22.06 after its workflows exist. No credential/role/wallet reset or outgoing mail. Production demo insertion needs its own exact approved manifest; preserve owner-controlled accounts without publishing their details.

#### AG16.07 - Domains, deployment, live payments and delivery

Keep medipulse.live company entry, existing /connect, /hospitals/:slug and staff fallback routing; inspect the actual host resolver. Optional connect.medipulse.live needs no extra domain purchase; medipulse.connect.live is not under the owned domain. Verify deep links/reload, API origin/relay, cookie/CSRF/CORS, TLS, Node 24, workers and readiness. Resolve required checkout/subscriptions early; separate virtual credits from live payments.

**Exit:** Exact deployed frontend/backend revisions and approved schema/config are recorded. Required live payments have signed webhook merchant/amount/currency binding and settlement/refund reconciliation. Approved mail/SMS distinguishes queued, accepted and observed delivery. Push/public liveness alone is not deployment acceptance.

#### AG16.08 - Operations, privacy, capacity and full checks

Complete privacy-safe audit/correlation, outbox/worker health, alert/support ownership, policy-approved export/deletion/retention, backup/recovery and rollback. Agree capacity/SLO targets and exercise booking/queues/sockets/worker recovery. Execute section 9 on the final candidate rather than only targeted smoke tests.

**Exit:** Exact revision/lockfiles/environment and actual results cover backend units, registered integrations, frontend units, full portable browsers, lint/build and fresh audits. Required failures/skips are resolved; observed restore/device/delivery evidence is linked independently.

#### AG16.09 - Outpatient operating acceptance

Close outpatient prerequisites with owner/operator acceptance. Reconcile the outpatient coverage audit, filled actor journeys, adversarial/full checks, deployed pair, support and rollback. Record the required final whole-product repetition under AG22.06; this package does not wait for enterprise completion. Add newly discovered required defects to this same checklist.

**Exit:** Dated outpatient scope/evidence and owner/operator acceptance satisfy AG16 prerequisites. Enterprise acceptance stays separately open under AG22.06, which repeats the whole-product checks. Do not generate another final plan.

### AG17 - Enterprise policies and real access model

#### AG17.01 - Qualified requirements and policy decisions

Resolve section 3 with hospital/qualified reviewers: jurisdiction, retention/deletion, witness, escalation, handover/discharge, triage/theatre, finance and recovery policies. Treat ENTERPRISE_PLAN.md and enterprisePlan.js values as proposed until approved. Confirm required vendors and exact scope.

**Exit:** Versioned decisions identify reviewer, date, scope, source and approval state. A generated matrix, statutory assertion, NEWS2/Code Blue/PACU constant or invented SLA is not an approved clinical/operating policy.

#### AG17.02 - Actual principals, assignments and capabilities

Reconcile actual seven HospitalStaff roles with proposed finance/store/anesthetist functions. Implement reviewed capabilities/department/team assignment, trusted doctor-account versus staff mapping, read projections and immediate HTTP/socket revocation. Define per-hospital feature/policy readiness and activation/rollback ownership.

**Exit:** Every operation maps to an actual authenticated principal/capability. HOSPITAL_ADMIN/adminAccess cannot confer clinical signing/witnessing or arbitrary patient access. Global enterprise flag cannot substitute for per-hospital approval; incomplete modules remain clearly unavailable.

### AG18 - Admissions, beds, transfers and discharge

#### AG18.01 - Source and person identity

Validate actual patient/family ownership/active status, hospital department, clinician membership, assigned team, encounter parent/person/hospital and ward/room/bed scope. Derive author from session and resolve doctor-account/staff identifiers.

**Exit:** Missing/foreign/archived/mismatched sources fail without mutation. Concurrent admissions cannot duplicate one person across beds; distinct family members under one account remain independently admissible. Test database-enforced races, not only same-bed prechecks.

#### AG18.02 - Durable admission and bed transitions

Complete key/fingerprint/original outcome and revision/CAS for admit, reserve/release, transfer, cleaning/maintenance and discharge. Define reservation expiry, immutable actor/time history and atomic source/destination updates.

**Exit:** Actual Mongo races, changed replay, process restart/lost response and transfer failure preserve one admission/history and the original bed on failure. Stale/foreign/terminal commands fail; required indexes/readiness are inspected and rehearsed.

#### AG18.03 - Qualified discharge and usable bed board

Implement policy-approved clinical/finance/pharmacy clearance references and signed discharge summary; caller booleans are not sign-off. Provide filled ward/bed/admit/transfer/clean/discharge screens with capability-scoped reads.

**Exit:** Cookie-CSRF browser journeys cover family, stale/denied/failure and successful transitions. Unqualified staff cannot clear/sign; occupancy and patient history reconcile after every operation.

### AG19 - Orders, nursing, medication and handover

#### AG19.01 - Trusted orders and assignments

Bind draft/sign/revise/discontinue to active admission/person, trusted clinician, approved capability and ward/nurse assignment. Preserve allergy/amendment/order version/source and linked lab/pharmacy tasks. Use approved rules without invented treatment/dose defaults.

**Exit:** Service and actual-cookie routes deny forged prescribedByDoctorId, administrator-as-clinician, foreign/unassigned departments, inactive admissions and stale signed versions.

#### AG19.02 - Independent authenticated witness

Build separate authenticated active qualified second-person approval tied to exact patient/admission/order revision/dose/action, expiry/revocation and single-use acceptance. Complete administration/omitted/refused/PRN commands under approved policy. Controlled/high-alert actions stay unavailable until this exists.

**Exit:** Tests cover self-witness, typed ID/signature, foreign/wrong/expired actor, changed dose, revoked approval, duplicate dose and discontinue-versus-administer. Actual two-session UI proves one caller cannot attest for another person.

#### AG19.03 - Incoming handover acceptance

Require the designated incoming nurse to authenticate and accept the exact version/assignment. Preserve outgoing responsibility until approved acceptance; support refusal/reassignment and immutable history.

**Exit:** Wrong recipient, self-ack, stale version, revoked assignment and competing accept/reassign are safe. Actual two-actor UI records genuine pending/accepted state and actor/time.

#### AG19.04 - Escalation delivery and nursing worklists

Implement durable escalation ownership/outbox/channel and acknowledgement. Separate recorded observation, queued dispatch, provider acceptance, observed delivery and clinician acknowledgement. Provide assigned flowsheets, shifts and overdue work without routine raw-ID entry.

**Exit:** Outage/retry/restart/duplicate delivery preserve one task; critical unacknowledged work stays visible. Fake notified flags cannot pass; approved clinical and actual delivery evidence are separate.

### AG20 - Emergency and theatre

#### AG20.01 - Emergency policy and access

Implement approved registration/triage/escalation/handover with real patient/family/source/department/team and qualified actors. Version history, own overdue actions and connect admission/nursing records.

**Exit:** Actual router/browser cases deny forged sources, wrong capabilities, missing approval and stale actions. Scoring constants alone do not establish validated triage; qualified scenario review exists.

#### AG20.02 - Durable theatre reservations

Reserve room/surgeon/anesthetist/equipment with atomic resource fences, holds/expiry and command identity. Handle invalid/overlapping slots/timezones, reschedule/cancel and consent prerequisites.

**Exit:** Actual concurrent requests for every shared resource have a permissible serialized outcome. Cancel/retry/restart releases once; partial allocation rolls back. Query-before-create is insufficient evidence.

#### AG20.03 - Qualified checklist and recovery

Bind consent/checklist phase signatures to actual qualified team members and exact version/prerequisites. Complete recovery/PACU/handover under approved policy and populated operational screens.

**Exit:** One actor cannot sign for another through booleans. Wrong team, revoked permission, stale checklist, missing consent and recovery prerequisites fail; actual authorized journeys and clinical review pass.

### AG21 - Revenue, insurance, procurement and stock

#### AG21.01 - Durable finance and immutable ledger

Add stable commands/fingerprints/original outcomes for tariffs, folio/accrual, invoices, payments, credits, refunds and insurance. Persist UI keys before requests and across reload. Use immutable entries/explicit reversals preserving history, safe whole minor units and trusted admission/person/family sources.

**Exit:** Mongo races, changed replay, restart and crash-after-commit cannot duplicate money or period accrual. Required uniqueness/readiness is proven; balances reconcile to original entries and reversals.

#### AG21.02 - Billing and insurance reconciliation

Approve invoice/folio multiplicity, actual bed history/date/cutoff/timezone/rounding, deposits, patient/TPA liability and settlement/refund adjustment rules. Bind claim/preauth/invoice to the same admission/person; protect terminal history. Implement required approved live gateway contracts distinctly from demo credits.

**Exit:** Bed transfer/accrual, duplicate invoices/claims, terminal edits, changed insurance, credit/refund limits and signed out-of-order events reconcile without fabricated paid status. Finance capability/foreign-source denials use real services/routes.

#### AG21.03 - Procurement, batches and returns

Validate supplier/PO/invoice/GRN and receipt identity, duplicate items, cost/units, actual expiry, quarantine and eligible FEFO batches. Preserve append-only stock movements with matching source/destination and original-batch returns; do not invent expiry.

**Exit:** Concurrent/duplicate receipts, unknown/expired/damaged stock, returns and mid-transaction failure conserve quantities/costs. Audit reconciles batch totals; procurement authority is explicit.

#### AG21.04 - Multiple partial ward transfers and legacy repair

Retain earlier committed keys/fingerprints; validate request/ward/remaining quantity. Reconcile preserved legacy partial records lacking commands before more issuance; never guess or silently trim history. Complete multi-item partial/zero UI, not only its first item.

**Exit:** Retry every earlier partial command; changed payload, concurrent disjoint issue, insufficient/corrupt batches and foreign ward cannot repeat/overissue stock. Explicit zero stays zero; persisted browser retry/reload and guarded legacy recovery pass.

### AG22 - Actual interfaces and enterprise acceptance

#### AG22.01 - LIS protocol and patient/order mapping

Ticket each required analyzer/protocol/version. Implement authenticated bounded HL7/ASTM parsing/framing/ACK/field validation and actual hospital/person/family/order/accession/department mapping. Protect raw payload retention. Receipt hashes alone are not processing.

**Exit:** Actual parser/adapter contract fixtures cover malformed/unknown/foreign identity and protocol reply. Results enter existing draft/version/review services; ingestion cannot bypass independent clinical verification/release.

#### AG22.02 - Durable processing, replay and indexes

Persist protected payload/reference/hash, command, worker lease, clinical outcome, retry/backoff/dead-letter and authorized replay. Preserve tenant/message dedupe and altered-content 409. Rehearse replacing legacy global messageControlId uniqueness with the scoped compound index.

**Exit:** Concurrent duplicates, changed content, out-of-order results, outage/restart and crash-after-commit preserve one valid result/history. Processed means actual clinical commit. Keep replay 503 until implemented; production index replacement requires exact approval after rehearsal.

#### AG22.03 - Authenticated PACS viewing

Implement agreed query/view behavior with real patient/study mapping and clinician/department/assignment access. Validate approved viewer origins, credentials and server fetch targets; prevent script URLs, arbitrary internal fetch/SSRF and private image leaks.

**Exit:** Authorized clinician views the correct study; anonymous/foreign/unassigned access and mismatches fail. Contract tests and browser demonstrate imaging, not just metadata or a stored WADO URI.

#### AG22.04 - Real federation and provisioning

Implement selected SAML/OIDC with approved issuer/audience/signature/state/nonce/PKCE/expiry/replay/tenant checks. Implement required SCIM authentication, reviewed least-privilege role mapping, deprovision/revocation, protected secret references and key/certificate rotation. Preserve account/staff session/CSRF separation.

**Exit:** Actual protocol fixtures cover login, wrong issuer/tenant, replay, logout/revoke, concurrent provisioning and forbidden admin escalation. SSO configuration or client role strings cannot authenticate or authorize.

#### AG22.05 - Required bridges and observed recovery

Resolve required ABDM/other interfaces against real contracts and explicit scope decisions. Exercise agreed store-forward/fail-closed downtime, isolated backup restore, integrity counts/digests, point-in-time evidence and measured RPO/RTO/capacity against approved objectives.

**Exit:** Evidence identifies source/candidate, timing, integrity and reviewer; no blind production overwrite or unsupported certification. Preserve recorded_unverified/not_accepted until actual observed evidence exists.

#### AG22.06 - Enterprise and whole-product acceptance

Generate acceptance from versioned site/scope/revision evidence rather than config counts/hardcoded true. Repeat AG16.09 across the final whole product, including enterprise demo fixtures, all section 6 actors, final full checks and section 10. Preserve historical self-reported audits.

**Exit:** Every required adapter, actor workflow, financial recovery and qualified review is accepted with evidence. Unresolved requirements stay open/blocked in the final report; 23 task labels alone never establish completion.

## 6. Filled-data browser acceptance matrix

Use actual frontend/API and isolated persisted fixtures. Fault mocks help failure testing but cannot be the only end-to-end evidence. Cover loading/empty/populated, validation, denied, stale, pending/retry and offline states where meaningful.

| Actor/context | Required connected journeys |
|---|---|
| Public/company/Connect/hospital | Product/host/deep-link navigation; directory/search/specialty/symptom guide; AI fallback; accessible assistant; correct doctor titles |
| Patient/family | Booking/fee/mode, retry/reload, reschedule/cancel/refund, arrival/room/ETA/file timeline, claim, released records, follow-up and account switch |
| Independent/hospital doctor | Separate sessions/queues, qualified notes/orders/review, scoped records, lobby/fullscreen/reconnect/end and draft preservation |
| Reception/nurse/file recipient | Walk-in/check-in, department/location, persistent pause/order, vitals and send/accept/refuse custody |
| Lab/pharmacy | Collection before billing, approved independent verifier, release/amend/critical acknowledgement, FEFO multi-item partial fill/return/shortage |
| Hospital/SaaS admin | Setup/onboarding, entitlements/quotas/suspension, staff approval/capabilities; no clinical override |
| Inpatient/nursing/team | Admission identity races/family, transfer/clean/discharge, trusted orders/witness, handover and escalation |
| Emergency/theatre | Qualified triage/consent/checklist, reservation conflicts, cancel/reschedule and recovery |
| Finance/store/ward | Invoice/payment/TPA/credit/refund, GRN/batch/quarantine, multiple partial transfers and earlier-key replay |
| Integration operator/clinician | Parser-to-draft lab, failed/replayed message, authorized imaging, real federation/provision/revoke and recovery |

Test denials and success with real cookies/CSRF, REST and affected sockets. For each shell use 360/768/1440, light/dark and keyboard. Capture privacy-safe artifacts. Empty-console rendering alone does not satisfy this matrix.

## 7. Migration and legacy-data procedure

1. Enumerate exact collection/index/validator/version changes and inspect actual data/indexes through an approved read-only procedure. Tests never load production .env.
2. Detect inconsistent references, duplicates and missing command history. Preserve originals; prepare private repair manifests with preconditions/recovery rather than auto-archiving, deleting or guessing links.
3. Explicitly cover LIS global-to-tenant message uniqueness, family-aware admission identity, reservation fences and financial/stock command uniqueness against actual approved policies.
4. Use additive expand/migrate/contract steps with named readiness. Rehearse backup/copy, dry-run, apply/repeat, invariant checks and conditional recovery. Startup syncIndexes/autoIndex is not a migration plan.
5. The production proposal names exact target/revision/counts, compatible/paused writers, event suppression, backup verification, failure/rollback triggers and owner. Obtain exact approval before execution; prior unrelated migration approval does not apply.
6. After approved apply verify schema/app/readiness compatibility. Preserve committed money and clinical events; an old application rollback cannot erase history.

## 8. Evidence, status and interruption rules

The existing ledger is authoritative for status/dependencies and contains `completionChecklist`. Each verified entry needs actual source revision, executed command/result or acceptance artifact and evidence references; include migration/activation records where applicable. Never bulk-check pending entries because a consistency command is green.

After each phase record package IDs, base/current source, behavior/files, actual checks, failed/omitted checks, migration needs, blockers and exact next step in WORK_LOG. Update IMPLEMENTATION_STATUS and LAUNCH_REPORT when claims change. Preserve earlier evidence with context. Commit/push each reviewable phase using the owner's identity.

The current plan checker verifies task IDs, dependency cycles and evidence paths; **it does not enforce subtask completion or prove application/clinical acceptance**. Before closing a parent manually verify every required child exit, prerequisites and actual behavior. Use blocked_external for concrete missing input, identify owner/next action once and continue independent permitted work.

AG16.09 closes outpatient acceptance; AG22.06 repeats that audit on the final whole product after enterprise work. This avoids a hidden dependency cycle. New required defects enter this same plan/checklist, are repaired and trigger affected/final checks. If interrupted leave exact next package/command and concrete blockers. No repeated master-plan generation is necessary.

## 9. Exact final-candidate checks

Prerequisites: Node 24 LTS, locked installs, local Mongo replica set/Redis and Playwright Chromium. Use the handoff's local setup; never import production environment or blindly run old seed scripts. From root PowerShell:

```powershell
docker compose up -d mongo redis
$env:TEST_DATABASE_URL='mongodb://127.0.0.1:27017/medipulse_test?replicaSet=rs0&directConnection=true'
$env:TEST_REDIS_URL='redis://127.0.0.1:6379/15'
node tools/check-implementation-plan.mjs --next
```

Initialize a fresh local replica set using the documented compose initializer if needed. Then execute:

| Directory | Command/check | Required meaning |
|---|---|---|
| backend | npm ci; npm test; npm run test:integration | Locked install, all registered actual suites including enterprise and new adversarial cases; no omitted failing file |
| frontend | npm ci; npm run test:ui; npm run build | Real imported logic and final production compilation; inspect route/chunk loading |
| frontend | npm run lint | Whole-tree lint; resolve release-relevant failures, record unrelated baseline diagnostics explicitly; no blanket suppression |
| root | node tools/run-browser-checks.mjs | Full portable browser suite; single runner, no source/spec edits during run; resolve required failures/skips |
| backend/frontend | npm audit --json | Fresh full audits and documented triage/remediation; no blind audit fix --force |
| root | node tools/check-implementation-plan.mjs; git diff --check | Dependency/evidence-path/whitespace consistency only |
| Isolated actual services | Domain race, restart/fault and agreed capacity checks | Registered regressions exercise Mongo/Redis/services, not only replacement implementations |
| Approved environment | Deployed pair/schema, real delivery, physical device/TURN, restore, qualified/operator/finance sign-off | Separate observed acceptance with exact scope and authorization; not inferred from CI |

Targeted checks run during implementation; all required final checks run against the final unchanged candidate. If source changes after a full run, rerun affected suites and final connected acceptance and record revision/order differences. Never count diagnostic failures, unexecuted tests or skipped required scenarios as passes. Unavailable required environments remain open gates.

## 10. Full-product completion gates

All applicable gates must have actual evidence:

- Every known/discovered required defect is resolved or an exact owner scope change recorded. All required checklist exits and task dependencies are satisfied; no silent deferral to manufacture completion.
- Whole-site visual/mobile/keyboard consistency and every filled actor journey pass, including authorization, stale state, retry/reload and money/stock/clinical recovery.
- Claim delivery, authenticated witness/handover, real financial operations and every agreed adapter work as implemented workflows. Disabled stubs, metadata/config screens and copied service mocks do not satisfy them.
- Final-candidate full checks, fresh audits, index/readiness inspection and rehearsed migration/recovery are recorded with revisions. Physical devices/provider/restore and qualified clinical/operating acceptance have observed evidence.
- Exact approved deployed frontend/backend pair, schema/workers, domains/cookies and per-hospital feature/policy readiness match the accepted scope. Production/provider operations had their exact approval.
- Original records/credentials/balances/archives remain preserved; demo data is reproducible/distinguishable; no patient/secrets are published. Audit, incident/support, rollback and release owners are assigned.
- Ledger, WORK_LOG, implementation status and launch report agree. main is published as Khushal with clean status or an explicit unrelated-edit note. Final handoff states actual scope/revisions/checks, completed schema/provider actions and remaining blockers honestly.

If only outpatient operation is accepted, label it outpatient acceptance and leave enterprise open. A missing external requirement remains real work; describe prepared code and exact remaining action rather than claiming the full product complete.

## 11. Paste once into Antigravity

```text
Read AGENTS.md, docs/ANTIGRAVITY_HANDOFF.md, docs/ANTIGRAVITY_COMPLETION_PLAN.md, docs/IMPLEMENTATION_TASKS.json, docs/IMPLEMENTATION_STATUS.md and Common in docs/MEDIPULSE_CODEX_PROMPTS.md. The consolidated plan starts from code checkpoint 81c951c8; verify current checkout and preserve later work. Continue this same plan through final acceptance, without generating another plan.

Start with AG16.D1-D3 discovery/preparation and the combined decision register, then AG05 and section 2 dependency order. Complete every required completionChecklist package through actual services, scoped APIs, persistence, usable UI, migrations/recovery and meaningful tests. Preserve delivered implementations and 81c951c8 safeguards. Add newly discovered required defects to this same parent checklist, fix and verify them before release. Read targeted files per package.

Use isolated synthetic data and disabled outgoing effects. Keep enterprise production containment until real prerequisites and exact approval exist. Bundle missing owner/provider inputs and continue independent permitted work; never fabricate clinical, delivery, payment, adapter or deployment acceptance. Existing authorization covers ordinary commits/pushes to main as Khushal Midha <khushalmidha24@gmail.com>, no Codex coauthor or force push. Common requires exact concrete approval for production DB/index/demo execution, provider/real mail, DNS and deployment-console actions. Astra, if used, stays Medium.

After each reviewable phase update checklist evidence/status, WORK_LOG and affected status/launch claims, then commit/push. Finish section 6 actor journeys, section 9 exact-candidate checks and every section 10 gate. If interrupted leave exact next package/command and blockers in the same plan. Keep progress/final responses concise; claim only actual verified scope.
```
