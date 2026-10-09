# MediPulse Codex prompt pack

Use this checkout's root: `C:\Users\khush\OneDrive\Desktop\MediPulse\MediPulse`. Review `docs/MEDIPULSE_REVIEW.md` first. All domain examples use the existing `medipulse.live`; no extra domain purchase is needed.

## How to use without repeating the whole project

Select the model and effort in Codex yourself. Run one numbered task at a time. A model assignment below is my recommendation for this project, not a promise of quality or plan usage. Use a new chat for a new module; retain the same chat for fixes to that module. Start each task with this launcher, replacing the task ID:

```text
Read docs/MEDIPULSE_CODEX_PROMPTS.md. Execute task P01 using the Common instructions and its prerequisites. Read docs/MEDIPULSE_REVIEW.md as existing evidence and verify the relevant code before editing. Complete this task and its necessary checks; record your results in docs/WORK_LOG.md. Keep your final response concise.
```

If these files are unavailable in another checkout, paste Common instructions followed by the specific task block. Keep work logs free of secrets and patient details. Do not repeatedly paste the README or earlier reports. Escalate a Sol task to Astra only when a specific unresolved concurrency, authorization, or architecture problem remains. Avoid Max and Extra high as defaults. The architecture and difficult fixes get High; ordinary implementation gets Medium. Use Luna for clearly specified small edits. No multi-agent work is requested by this pack.

## Common instructions

```text
Work in the existing MediPulse repository. Inspect applicable AGENTS.md, the relevant code, the existing review, and prior work log. Verify findings rather than assuming documentation is correct. Preserve unrelated user edits. Implement the requested task fully in a reviewable change; keep scope bounded and list follow-up issues separately. Prefer the current React/Vite/Express/Mongoose stack and cohesive reusable modules.

Use targeted searches and reads. Never print secrets, patient data, or credential-bearing connection strings. Use isolated fixtures/databases for tests and migration rehearsals. Do not run diagnostic, seed, index-sync, or wallet scripts against production. Prepare migrations with dry-run checks and rollback/recovery steps; production execution, DNS changes, provider activation, purchases, and deployment require separate authorization.

For money, permissions, concurrent writes, and workflow changes, add meaningful regression/integration tests and run appropriate checks. For UI changes, check build, affected lint, responsive layout and keyboard behavior; use a browser if available and state what was actually rendered. Do not claim unexecuted checks passed. Keep clinical outputs draft until clinician review. Keep existing virtual payments visibly separate from real payment collection.

Update docs/WORK_LOG.md with task ID, changed behavior/files, checks and results, decisions, migration needs, and unresolved blockers. Final response: outcome, verification, and remaining actionable items. Avoid repeating the full plan or generating unrelated documentation.
```

## Order and settings

| Task | Model | Effort | Prerequisite |
|---|---|---|---|
| P00 Remaining module audit | GPT-6.1 Sol | High | Existing review |
| P01 Credentials, public data, authorization | GPT-6 Astra | High | Run immediately |
| P02 Reproducible dev and regression baseline | GPT-6.1 Sol | Medium | P01 |
| P03 OPD/appointment concurrency | GPT-6 Astra | High | P02 |
| P04 Ledger, refunds, booking reconciliation | GPT-6 Astra | High | P03 |
| P05 Sessions and community/forecast bugs | GPT-6.1 Sol | High | P01-P04 |
| P06 Durable events, mail, realtime and calls | GPT-6.1 Sol | High | P03-P05 |
| P07 Two products, domain routing and care context | GPT-6.1 Sol | High | P03-P06 |
| P08 Visual system and product shells | GPT-6.1 Sol | High | P07 |
| P09 Appointment scheduling backend | GPT-6.1 Sol | High | P03-P07 |
| P10 Appointment and waiting-room UI | GPT-6.1 Sol | High | P08-P09 |
| P11 Remaining UI pages, one batch per run | GPT-6.1 Sol | Medium | P08-P10 |
| P12 Hospital visit, rooms and file handoffs | GPT-6.1 Sol | High | P07-P10 |
| P13 Live ETA, patient tracking and messages | GPT-6.1 Sol | High | P06, P12 |
| P14 Independent doctor and community product | GPT-6.1 Sol | Medium | P05-P10 |
| P15 Labs | GPT-6.1 Sol | High | P12-P13 |
| P16 Hospital pharmacy | GPT-6.1 Sol | High | P12, P15 |
| P17 SaaS onboarding and operating tools | GPT-6.1 Sol | High | P07-P14 |
| P18 AI reliability and truthful feature claims | GPT-6.1 Sol | High | P05-P06, P12 |
| P19 Enterprise hospital expansion plan | GPT-6.1 Sol | High | Pilot feedback, P15-P17 |
| P20 Launch preparation and critical journey verification | GPT-6.1 Sol | High | Chosen pilot scope complete |
| P21 Small UI/text/docs corrections | GPT-6 Luna | Low | A precise local task |
| P22 Critical change review when needed | GPT-6 Astra | High | P03/P04 or disputed design |

P00 can document unresolved modules while P01 is prioritized, but finish tasks sequentially. P15-P19 are expansion tasks after a stable OPD pilot; they are not prerequisites for selling the initial OPD product.

## P00 - Remaining module audit

```text
Perform the remaining repository audit using docs/MEDIPULSE_REVIEW.md as the starting point. Trace every route module against authentication, controller validation, model/index behavior, frontend callers, and socket policies. Cover user/doctor profiles and deletion, hospital onboarding/staff permissions, appointments/OPD, communities/messages/events, reviews, virtual payments, AI/triage/copilot, patient/family records, forecasts, and deployment/workers. Record inspected modules explicitly and distinguish verified defects, suspected risks, missing features, and configuration unknowns.

Produce docs/BUG_BACKLOG.md with priority, file/line evidence, reproducible trigger, impact, fix scope, and verification criterion. Validate gaps in the earlier review, especially anonymous-review output and family identity. Do not modify application code or run production scripts. Avoid duplicating the architecture narrative; add only new evidence and corrections.
```

## P01 - Credentials, public data and authorization

```text
Fix the concrete exposure and authorization issues first. Replace embedded DB credentials in backend/sync_indexes.mjs and backend/check_tokens.mjs with required validated environment configuration; report credential rotation/history cleanup as external actions without reproducing secrets. Give public hospital and review endpoints explicit field allowlists and invalidate affected public caches. Keep onboarding ciphertext, subscription internals, patient identifiers, and anonymous reviewer identities out of public output.

Bind patient OPD booking identity to req.auth and require the patient role. Validate family ownership, doctor/department membership, and all hospital record references used by REST and socket operations. Restrict clinical events to staff authorized for that visit, including each payload's fields; preserve minimal public queue displays. Add cross-user, cross-hospital, unauthorized-role, public-field, and socket regression tests. Document any migration or frontend response adjustment. Cover the verified issues before expanding to speculative security work.
```

## P02 - Reproducible development and verification baseline

```text
Make the existing project reproducibly runnable with a dedicated local database. Inspect package scripts, Docker/Compose, Redis selection, Kafka consumer bootstrapping, and frontend Nginx routing. Configure a local MongoDB replica set suitable for ledger transactions; make API and consumer use the same real local Redis when intended. Correct production Compose so local Mongo settings do not override the configured production database. Add SPA deep-link handling to the Docker frontend and readiness/error reporting for dependencies.

Establish a small isolated integration-test setup for backend money/permissions/queue behavior and a critical frontend journey verification setup. Replace the placeholder backend test command with the real runner. Prevent test utilities from defaulting to production. Run local checks if prerequisites are available; report missing services precisely. Keep fixtures small and synthetic. Document only the commands and configuration needed to reproduce the environment.
```

## P03 - OPD and appointment concurrency

```text
Make OPD and appointment queues consistent under simultaneous requests, multiple API processes, and browser retries. Start with a written invariant list and existing API contracts. Default to one queue per hospital/practice, doctor, service date and session; make the boundary configurable if confirmed product rules differ. Use hospital timezone explicitly. Align sequence, token uniqueness, family identity, walk-ins, queue queries and indexes. Handle concurrent first sequence upserts and E11000 recovery. Sequence gaps after aborted issuance are acceptable; duplicate numbers are not.

Implement stable request idempotency, atomic conditional status transitions, and a database-enforced single active consultation per intended care session. Keep linked token/appointment states consistent, with one shared transition service rather than competing saves. Separate remote reservation from physical arrival. Prepare safe index/data migrations with duplicate detection. Test concurrent issuance, repeat requests, two family members, multiple walk-ins, competing starts, terminal-state edits, midnight boundaries, and stale client actions. Coordinate booking/payment consistency with P04 and record remaining cases.
```

## P04 - Ledger, refunds and booking reconciliation

```text
Fix wallet/payment/refund correctness across virtualLedger, virtualPayment, appointments, and OPD booking. Inspect P03 invariants first. Make stable booking idempotency keys persist across HTTP retries. For virtual money in MongoDB, prefer one transaction encompassing the ledger and booking records where feasible; otherwise persist a recoverable operation state and compensation job. Prevent a post-commit Redis/cache/event failure from reporting a successful debit as failed and causing another debit.

Enforce cumulative refund limits atomically across different idempotency keys and automatic/manual refunds. Return completed replay before rejecting the original's refunded status. Make refund accounting and original-state updates consistent; avoid parallel operations inside the same Mongo transaction. Represent amounts consistently and report actual compensation status instead of always saying payment was reversed. Test concurrent partial refunds, duplicate bookings, crash/failure windows, restart recovery and balance conservation. Keep demo credits explicitly demo; prepare real gateway interfaces without activating a provider or treating credits as money.
```

## P05 - Sessions, communities and forecast defects

```text
Fix auth/session and the identified module defects. Adopt an intentional session approach compatible with hospital subdomains, patient/doctor accounts and staff workspaces. Harden CORS and cookie/CSRF policy together; update frontend and socket auth when removing readable JWT cookies. Add server logout/revocation behavior as needed and prevent an old staff session from overriding a patient session. Ensure public/auth responses omit password hashes. Audit User/Doctor pre-save password hooks for double hashing on non-password saves.

Use real authorization middleware in forecast routes instead of the response-only StaffVerifier; fix undefined opdVolume and validate forecast output. Share community read/write/membership permissions between REST and sockets, allow authorized doctor authors to communicate, and enforce organizer permissions for events. Cover invite expiry/replay, reset OTP attempts, session switching, profile edits followed by login, nonmember messages, and tenant-scoped forecasts with regression tests. Use existing backlog to keep this batch limited to these modules.
```

## P06 - Durable events, mail, realtime and calls

```text
Make persisted workflow success independent of Kafka/mail availability. Add a durable outbox or equivalent persisted jobs for booking confirmations, cancellations, refunds, review requests and critical patient notifications. Provide claim/lease, retries/backoff, deduplication and failed-job visibility. Correct review jobs removed on failure and successful OTP responses without confirmed enqueue. Keep secret OTP payloads out of general analytics. Recover persisted consultation deadlines after restart and define configurable duration; remove the universal five-minute forced end assumption.

Make queue clients recover from missed/out-of-order events through authorized snapshots and revisions. Verify socket rooms and session refresh. Add a Redis adapter only if multiple API instances are intended. Improve WebRTC reconnect, device permission and doctor disconnect handling; supply short-lived TURN credentials from the backend instead of exposing service secrets in VITE variables. Test restart/replay/failure behavior and both participants' call lifecycle in the available environment.
```

## P07 - Two products and domains

```text
Implement separate product contexts using only the existing medipulse.live domain: company home at medipulse.live; independent care at connect.medipulse.live; hospital staff app at app.medipulse.live; branded patient sites at <hospital-slug>.medipulse.live. Keep path fallbacks /connect/*, /hospital/* and /hospitals/:slug/* working before DNS is configured. Support the current backend URL; api.medipulse.live is an optional configured alias.

Replace ad hoc hostname parsing with explicit normalized host resolution, reserved names, verified custom domains and unknown-host handling. Ensure hospital hosts can render login, visit tracking and nested routes instead of always returning a single page. Introduce explicit independent/hospital practice and visit-mode context. A doctor's independent queue and each hospital session must remain distinct despite shared doctor identity. Prepare backward-compatible data migration. Document DNS/TLS/hosting/CORS/cookie/Google redirect changes; do not change live configuration. Add host-routing and context-isolation tests.
```

## P08 - Visual system and product shells

```text
Create and implement a cohesive MediPulse visual direction after inspecting current routes and user workflows. Default to warm white/slate surfaces, deep teal primary actions, restrained blue accents, readable typography, generous patient-screen spacing and compact staff-screen density. Use the existing heart mark consistently. Design three shells: company marketing, patient/independent doctor, and hospital staff, plus hospital branding overrides with accessible contrast. Establish tokens and reusable buttons, inputs, dialogs, cards, tables, status badges, navigation, loading/empty/error states and form validation.

Build the root company page with two clear products and honest calls to action, and representative patient/staff screens using real data. Remove unverified named testimonials and unsupported claims. Use Lucide consistently, semantic HTML, keyboard focus, responsive navigation and reduced-motion behavior. Check 360px, tablet and desktop layouts. Record the component conventions so later page migrations reuse them. Implement this foundation without repainting every remaining page in the same change.
```

## P09 - Appointment scheduling backend

```text
Extend the current queue-only appointment backend into explicit appointment types: scheduled online consultation, online OPD session, and hospital in-person visit. Add practice/session identity, timezone, availability, doctor breaks/leave, slot capacity, reservation expiry, cancellation/rescheduling rules and check-in state. Keep existing immediate queue bookings compatible. Distinguish a scheduled reservation from an arrived patient and define admission into the appropriate queue.

Protect slot capacity and session overlap under concurrent booking/rescheduling, use stable idempotency, persist fee snapshots, and integrate payment outcomes from P04. Validate patient/family ownership and doctor eligibility. Return real availability and complete confirmation/tracking payloads; never fabricate selectable slots. Test competing slot reservations, retries, expired holds, cancellation, doctor absence, independent/hospital context isolation and timezone boundaries. Prepare additive migrations and API examples needed by P10.
```

## P10 - Appointment and waiting-room UI

```text
Rebuild doctor discovery/profile, AppointmentBooking, hospital booking, MyAppointments and the waiting room with P08 components and P09 APIs. Provide a clear flow: care type and doctor -> patient/family member -> actual session/date/slot -> fee and details review -> confirmation. Preserve form input after recoverable errors. Show visit mode, location or video requirement, availability, itemized actual fee, cancellation terms and verified doctor information. Support guest discovery with a return to booking after sign-in.

Create a useful confirmed-visit screen with token/slot, queue position, ETA range when available, status freshness, next step, room or video join, reschedule/cancel, and accessible help. Include double-submit prevention plus server replay handling, stale availability, failed/pending payment, offline states and reminders. Avoid showing video for in-person visits. Verify the complete journey on mobile and desktop using synthetic records; report screenshots only when actually captured.
```

## P11 - Remaining UI migration (repeat per batch)

```text
Migrate the next incomplete UI batch to the P08 design system. Read WORK_LOG first and select the earliest unfinished batch: A login/signup/profile/staff invites; B patient health/family records and hospital discovery; C doctor appointments/OPD workspace; D receptionist/nurse/staff communication; E hospital administration/website editor; F communities/chat/events; G wallet/refund/notification/admin pages; H about/privacy/terms/other public pages. Complete one batch per run and record coverage.

Improve information hierarchy, task-focused navigation, mobile/tablet behavior, forms, tables, filtering/pagination, dialogs, feedback and accessible focus. Staff screens should support frequent operational actions with clear next steps and patient context. Use real endpoints and consistent state labels. Extract reusable components where warranted. Check all changed routes and failure states, build and affected lint. Keep a route checklist so the entire project eventually receives the redesign.
```

## P12 - Hospital visit, room guidance and file handoffs

```text
Build an explicit hospital encounter journey: booked -> checked in -> reception/registration -> vitals -> doctor consultation -> ordered lab/pharmacy steps -> completion/follow-up. Adapt actual step requirements by department; authorized staff must confirm transitions. Add configurable buildings/floors/rooms, doctor session room assignment, service desk locations and patient instructions. Guide the patient to the next required destination using maintained hospital data.

Track digital workflow responsibility and, where physical files are used, current file holder/location through acknowledged handoff events. A record view alone must not count as physical custody. Show 'not recorded' when location is unknown. Support printed token/QR ticket, walk-ins with optional later account linking, family identity and an authorized visit tracking page. Record timestamp, actor and reason for transitions and overrides; handle refused, repeated and concurrent handoffs. Test two departments and separate hospitals with synthetic visits.
```

## P13 - Live queue, ETA, timeline and notifications

```text
Add continuous patient-specific queue tracking for P12 visits and remote sessions. Define deterministic ordering for checked-in versus remote/scheduled patients, missed turns, doctor pauses and authorized priority changes. Store reasons for overrides. Return now-serving token, patients ahead, ETA range, last updated time and next destination without public patient identities. Update estimates from recent real consultation durations, active elapsed time, session availability and pauses; use a transparent fallback with low confidence when data is sparse. Avoid claiming a precise guaranteed turn time.

Build the patient live timeline and privacy-safe hospital display/kiosk using P08 UI. Email confirmations/reminders should summarize token, intended arrival, destination and latest estimate, with a secure link to changing visit status; include a print view and optional calendar file. Use durable P06 delivery jobs, preferences, deduplication and rate limits. Keep medical details behind authentication. Test estimate changes, offline/reconnect, missed turn, doctor absence, failed email and family-member visibility.
```

## P14 - Independent doctors and communities

```text
Complete MediPulse Connect for doctors independent of hospital employment. Implement doctor onboarding, professional credential verification status, profile publication, fees, practice availability, online OPD sessions, patient booking, waiting room and consultation history through P07/P09 contexts. A linked hospital affiliation must not be required and must not merge clinical records or sessions. Provide a doctor workspace for availability, session queue, patients authorized for that practice, draft notes and follow-ups.

Complete doctor-owned communities with permissioned membership, announcements, member chat, moderation/reporting, pagination and notification preferences using P05 policy. Use the new visual system and make the independent-care entry point distinct on the company page. Verify one independent doctor, one doctor also employed by a hospital, and a patient using both products without information or queue leakage. Ship the operational core before additional community engagement features.
```

## P15 - Laboratories

```text
Build a tenant-scoped laboratory workflow integrated with an encounter: doctor-approved order -> billing/authorization state -> collection -> sample accession/barcode -> processing -> technician entry -> authorized verification -> result release -> patient/doctor notification. Include a configurable test catalog, specimen type, units/reference ranges, timestamps, responsible staff and secure report storage. Manage rejected/recollected samples, cancelled tests, critical-value acknowledgement and versioned corrected reports.

Implement doctor order entry, collection queue, lab worklist, verification screen and patient result view using P08 components. Enforce role permissions, private signed downloads, duplicate request protection and audit history. Do not convert a lab_alert chat event into a completed laboratory module. Add workflow/tenant/result-release tests and synthetic scenarios. Mark unsupported analyzer integrations explicitly; do not fabricate integrations or clinical interpretation.
```

## P16 - Hospital pharmacy

```text
Build hospital pharmacy fulfillment from clinician-approved prescriptions linked to encounters. Model prescription versions, medication directions entered/approved by clinicians, pharmacy queue, catalog, batch/expiry/stock, dispensing, partial fulfillment, returns and bill linkage. Reserve/decrement inventory atomically and record dispensing actor/time. Handle out-of-stock, expired batches, cancelled prescriptions, duplicate dispensing and audited corrections.

Provide doctor prescription entry, pharmacist worklist, stock/expiry views and patient collection status with P08 UI. AI suggestions require clinician approval before prescription or fulfillment. QR prescription verification should reveal only necessary information through controlled access. Test tenant boundaries, conflicting stock consumption and dispense/reversal rules. Keep external chemist partnerships as a separate future integration boundary; do not automatically expose a patient's records or assume a standalone retail pharmacy business is in this scope.
```

## P17 - SaaS onboarding and operations

```text
Make hospital onboarding and ongoing operation coherent: hospital application/verification, admin invitation and password setup, branding/site preview, department/room setup, staff roles/invites, doctor session setup, and a first usable booking. Replace emailed recoverable passwords with expiring setup links. Build server-enforced plan entitlements, subscription/trial states, tenant suspension rules, usage visibility and a platform operations workspace with audited access.

Add support issue reporting, delivery/job failure visibility, staff activity audit, tenant export and agreed retention controls. Define transparent operational metrics such as bookings, completed visits, no-shows, observed waiting time and staff setup completion. Avoid exposing health records in general analytics. Prepare billing-provider integration interfaces using confirmed launch country and provider; keep payment activation pending until those are specified. Verify that a new synthetic hospital becomes operational without manual database edits.
```

## P18 - AI reliability and truthful claims

```text
Audit current triage, ranking, Hugging Face integration, Gemini copilot/SOAP and forecasting against source code and available external services. Resolve README/roadmap discrepancies and enumerate missing external repositories/configuration. Remove unsupported medical accuracy claims, unverified testimonials and feature claims without working user journeys. Treat generated notes/prescriptions as drafts requiring clinician approval and clearly distinguish forecasts with limited evidence from validated predictions.

Implement schema validation, bounded timeouts/retries, provider error handling, human-review state, context/permission limits, explicit consent and appropriate data minimization. Booking and OPD operation must continue when optional AI is unavailable. Establish a small clinician-reviewable evaluation fixture and regression checks for fallback behavior; do not invent clinical validation or regulatory compliance. Report external clinical review and jurisdiction-specific requirements separately rather than claiming code alone satisfies them.
```

## P19 - Enterprise hospital expansion plan

```text
Use the shipped pilot workflows, BUG_BACKLOG and actual hospital feedback to create a phased enterprise plan. Cover multi-branch organization, department delegation, wards/IPD, admissions/transfers/discharge, beds, nursing tasks, billing/insurance, procurement, laboratory/pharmacy integrations, medical records, imaging integration boundaries, SSO, audit, backups/disaster recovery and support expectations. Identify existing capabilities versus missing workflows.

Write docs/ENTERPRISE_PLAN.md with dependencies, bounded implementation milestones, acceptance criteria, data ownership, migration needs and operational targets proposed for customer agreement. Flag clinical/legal decisions requiring qualified review without inventing requirements. Keep service separation and infrastructure choices proportional to measured scale. Do not attempt a full hospital system in one change. Provide short implementation task prompts for the first agreed enterprise module once requirements exist.
```

## P20 - Launch preparation

```text
Prepare a reviewable launch candidate for the selected pilot scope. Trace real patient discovery/booking/payment or demo-credit flow, offline registration/check-in, queues, staff transitions, consultation, result collection where shipped, cancellation/refund, record access, and notification delivery. Run meaningful isolated regression tests and browser journeys, including two hospitals, concurrent requests, family members, independent/hospital contexts, mobile and staff tablet screens, restarts and dependency failures. Record exactly what was verified.

Fix release-blocking defects in scope. Prepare migrations/index checks, backup/restore rehearsal, health/readiness checks, redacted logs/alerts, environment checklist, deployment and rollback instructions, DNS/TLS/auth redirect checklist and operator onboarding. Confirm frontend deep links and API/consumer deployment. Check the dependency lockfiles and current official advisories where relevant. Produce a concise launch report with passed checks and unresolved launch blockers. Prepare artifacts/configuration but do not deploy or execute production migrations in this task.
```

## P21 - Small corrections (Luna)

```text
Complete this bounded MediPulse change: [exact page/component and desired correction]. Read its current implementation and P08 design conventions. Edit only the files required for the requested behavior, preserve accessibility and responsive layout, and check affected build/lint or behavior as appropriate. Do not redesign the module or change payment/auth/queue rules. Record the result in WORK_LOG and return a short summary with verification.
```

## P22 - Critical review (optional Astra)

```text
Review the current diff for [P03/P04 or exact critical change], its migrations and regression tests against the documented invariants. Focus on simultaneous requests, retries after commit, process crash/restart, cross-tenant access, family identity and data loss/payment imbalance. Inspect tests for whether they reproduce real failure windows rather than merely matching implementation. Report only actionable findings with severity, file/line evidence, concrete trigger and required correction. Do not rewrite correct code or repeat the full repository audit. If fixes are needed, make the smallest complete correction and run the relevant regression checks.
```

## Official sources

[OpenAI model selection](https://developers.openai.com/api/docs/guides/model-selection) supports using Luna for bounded work, Sol for complex work with cost constraints, and Astra for demanding analysis. [Reasoning effort documentation](https://developers.openai.com/api/docs/guides/reasoning) explains the speed/token tradeoff; available settings vary by model and product. Checked 8 October 2026. Choose the closest listed setting in your Codex account rather than assuming every API option appears in the app.
