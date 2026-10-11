# Astra review: recent MediPulse implementation

Reviewed 11 October 2026. Baseline: `c42c3529d8b38a3f8dee283148dac7fb881bc5a3`; compared with `d0539640`. This covers the later P11 batches and P12–P20. Findings below describe that baseline, even if subsequent repairs change the working tree. Review scope is source and isolated checks, not production inspection. No application edits, production writes, emails, provider activation, or credential/patient output were performed for this review.

**Verdict: useful screens and models were added, but the P20 launch approval is unsupported. Repair the new authorization and clinical integrity defects before using these modules with operational data.** The earlier queue, ledger, session and preservation work should be retained. The approved P23 preservation migration is already complete; it does not authorize another seed or migration.

## What exists, and what remains incomplete

| Area | Verified implementation | Missing or unsafe connection |
|---|---|---|
| P11 visual migration | Shared controls are used across newer clinical, staff, hospital-admin, community, financial and policy screens | Dashboard and floating assistant retain the red/blue legacy appearance; several new screens use undefined color variables. A successful build does not establish responsive/accessibility quality |
| P12 encounter | Journey/location schemas, stage and custody endpoints, token-issue initialization | Tenant guards, actual transition invariants, recipient acknowledgement, durable creation, scheduled-booking integration and real patient guidance are incomplete |
| P13 queue | ETA calculation, kiosk projection and pause/override endpoints | Pause is process-local display state; priority does not change queue order; patient visit screen does not consume the new live timeline |
| P14 independent/community | Practice fields/endpoints; organizer announcements, report/removal/preferences endpoints | Self-verification is allowed; publication is unenforced; affiliated doctors remain excluded from independent discovery; new controls have no matching complete frontend workflow |
| P15/P16 labs/pharmacy | Models, controllers, worklists, result/dispense dialogs | Permissions, cross-record identity, real persistence on failure, concurrency, safe stock accounting, order-entry and patient-result journeys are incomplete |
| P17 operations | Entitlement helper functions, metrics/export/support UI, setup-token generator | Administrative API is public; helpers are not enforced by operations; setup-link consumption and setup page are absent; old recoverable-password onboarding remains |
| P18 AI | SOAP draft flags, one timeout wrapper, deterministic SOAP fallback, capability metadata | Approval authorization is broken; minimization/schema helpers are not applied across clinical provider callers; fixtures are not clinical validation |
| P19/P20 | Enterprise roadmap and launch document | IPD/ADT/eMAR/insurance/PACS/SSO are plans. Launch claims conflict with executable code and do not establish external service/customer readiness |

## Prioritized findings

Line references point to the reviewed baseline. Each trigger can be reproduced with synthetic fixtures; none requires probing production.

### A01 — Critical: tenant operating API has no authentication

`backend/index.js:109` mounts `routes/saasOperations.js`; that router has only `nosqlGuard` before tenant routes (`:29`). Anonymous callers can list tenants, read details/export, modify subscription, suspend/restore a tenant and generate setup links. `controller/saasOperations.js:37` uses a narrow denylist rather than an explicit response projection; setup verification returns the full hospital (`:114`). `saasOperationsService.js:264` exports staff names/email/phone. Global CORS/origin middleware does not authenticate non-browser requests.

**Trigger:** request a tenant export or PATCH a tenant subscription without a session. **Repair:** existing platform-operator policy for cross-tenant lifecycle actions; hospital-admin policy bound to the authenticated tenant for local operations; public setup responses with a minimal allowlist. Verify anonymous, ordinary account, foreign admin, suspended tenant and platform-operator cases through the real router.

### A02 — Critical: labs/pharmacy cross-tenant access and false clinical attribution

`middleware/validateStaff.js:5` supplies `req.staff`. Lab (`controller/lab.js:17`) and pharmacy (`controller/pharmacy.js:11`) instead prefer caller-supplied hospital IDs and look for nonexistent `staffUser`/`staffHospital`/`req.auth` staff properties. Detail reads omit the tenant predicate entirely if no hospital was supplied (`lab.js:101`, `pharmacy.js:129`). Every staff workflow route uses authentication alone (`routes/lab.js:26`, `routes/pharmacy.js:28`), so reception can verify/release results or create a prescription labelled approved by a clinician. Actor IDs come from nonexistent `req.auth` and doctor/patient/encounter references are accepted from the body.

**Trigger:** staff A requests B's order by ID, supplies B's hospital ID, or posts an approved prescription as reception. **Repair:** derive tenant and actor from the session; enforce task capabilities and department/assigned-clinician access; resolve patient, family member, doctor, catalog and encounter server-side. Every referenced record must belong to the same visit/tenant; do not let a body-supplied doctor name establish approval.

### A03 — Critical: any account can approve another patient's SOAP note

`routes/appointment.js:48` applies only `userValidation`. `controller/appointment.js:1018` loads any appointment, performs no doctor-role or assignment check, reads approver from nonexistent `req.doctor`/`req.user`, and marks the note approved. It does not require the reviewed note version.

**Trigger:** an authenticated patient calls approval with another appointment ID. **Repair:** reuse assigned-doctor authorization, require a persisted note revision and explicit clinician confirmation, record the real actor, and invalidate approval after edits/regeneration. Test patient, unrelated doctor, assigned linked doctor and concurrent note replacement.

### A04 — High: private encounter data is public; staff can modify foreign encounters

`routes/encounter.js:26` exposes guidance/ticket anonymously. `routes/opd.js:39` exposes live timeline anonymously; `queueTrackingService.js:162` returns full stage history and physical-file history, including notes/reasons/staff identities. Encounter stage/handoff/refusal services use `findById` without tenant/department predicates (`encounterJourneyService.js:111`, `:183`, `:231`). Hospital location creation similarly trusts the path hospital (`controller/encounterJourney.js:126`). Pause and priority endpoints accept arbitrary queue/token identifiers (`routes/opd.js:45`).

**Repair:** owned-patient or permitted-staff reads with distinct minimal DTOs; keep only the explicitly public kiosk projection public. Bind all writes and referenced locations/recipients to the authorized visit. Add negative cross-tenant/department tests including REST reads, not only service tests.

### A05 — High: database disconnection produces fabricated success

Lab service branches on `mongoose.connection.readyState !== 1` before persistence (`labService.js:30`, `:89`, `:114`, `:205`, `:248` and later); pharmacy does the same (`pharmacyService.js:30`, `:99`, `:206`, `:260`). An arbitrary QR becomes `verified: true` when disconnected. SaaS returns invented metrics, a valid sample hospital or a ticket without persistence (`saasOperationsService.js:95`, `:162`, `:227`). These are production branches, not injected test adapters. Readiness captured at startup does not justify a successful response after a later disconnect (`index.js:60`, `:85`).

**Repair:** fail with explicit service-unavailable before promising a write; keep test doubles in tests. Distinguish a truly empty dataset from unavailable data. Verify disconnect after successful startup and prove no fabricated IDs/results or acknowledgements reach callers.

### A06 — High: stock and dispensing are not atomic or bounded

`pharmacyService.js:149` says “atomically” but mutates a loaded batch and saves inventory before independently saving the prescription (`:187`). There is no transaction, conditional quantity update or request idempotency. Quantity is not bounded to the prescription remainder (`:123`); an unknown inventory item is considered dispensed (`:163`). `allDispensed` considers only requested items, so supplying one item of a multi-item prescription can finish the entire prescription (`:117`, `:174`). A specified invalid batch silently falls back to another batch (`:137`). Returns allow negative quantities (`:221`) and retain only one batch per prescription item, losing earlier allocations when partial fills use different batches.

**Repair:** immutable per-batch dispense/return allocations, positive bounded unit quantities, conditional stock claims and one Mongo transaction with idempotent operation records. Derive overall status from all prescription items. Reject unapproved substitutions/unknown stock; audit explicit exceptions if the hospital requires them. Test two dispensers, duplicate retries, partial multi-batch fills, omitted items, negative/over returns, expiry and crash between writes.

### A07 — High: encounter lifecycle and physical custody disagree with actual care

`opdToken.js:62` initializes the journey after booking and swallows errors; replay skips initialization. No initialization call exists in scheduled confirmation. There is no unique token/appointment identity constraint (`model/encounterJourney.js:9`). `transitionEncounterStage` accepts any schema stage without checking required steps or terminal state (`:117`); incrementing `revision` is not a conditional save. Normal `transitionVisit` only sets stage/revision (`visitTransitions.js:112`), leaving destination/history stale. Lab/pharmacy update `steps.step`, but the encounter schema has `requiredSteps`, not `steps`; those integrations cannot advance a schema-conforming encounter.

Custody defaults to acknowledged by the sender (`encounterJourneyService.js:181`) with caller-supplied recipient identity. No recipient acceptance endpoint proves receipt. Concurrent handoffs can overwrite current custody.

**Repair:** one durable encounter identity per visit, shared transactional/recoverable stage events updating destination and history, required-step/override rules, terminal protection, conditional revisions, and separate send/recipient-accept/refuse operations. Keep digital access distinct from physical possession.

### A08 — High: walk-in account linking is broken and lacks a safe claim protocol

`controller/encounterJourney.js:82` reads `req.user`, while `validateUser.js:5` supplies `req.auth`, so authenticated linking returns 401. `PatientVisits.jsx:67` passes a token ID to a route that treats it as an encounter ID. Its owned-token list cannot discover an unlinked walk-in. The underlying service (`encounterJourneyService.js:262`) accepts an encounter ID and user ID with no claim secret/staff proof, uses separate encounter/token saves, and does not reconcile `personKey`, family identity or any linked appointment.

**Repair:** staff-mediated verified linking or a short-lived one-use claim credential with explicit patient/family selection, atomic identity reconciliation and audit. Fixing only the request property would expose an unsafe claim operation. Test concurrent claims, replay, unrelated family/tenant and preservation of original walk-in history.

### A09 — High: laboratory verification, critical alerts and amendments are incomplete

Lab transitions are load/check/save without revision conditions (`labService.js:93` onward). Sample collection can bypass billing (`:126`); sample rejection can replace any state, including released (`:166`). Result parameters/reference ranges and critical flags come from the request rather than validated catalog definitions (`:188`). A critical value sets `notifiedAt` without creating a notification/acknowledgement task (`:229`). Amendments replace results and immediately mark them verified (`:345`) without recalculating critical status or recording a new verification. Labs/prescriptions omit family member identity and rely on body patient snapshots.

**Repair:** explicit clinical workflow permissions and conditional transitions; catalog-versioned parameter/result validation; a durable responsible-clinician acknowledgement work item; immutable report versions with amended/released provenance; preservation of prior released versions. Billing prerequisites and verifier qualifications are hospital requirements to confirm, not assumptions to encode from this review.

### A10 — High: P17 setup and entitlement claims are helper stubs

`checkStaffLimit`, `checkDepartmentLimit`, `checkFeatureEntitlement`, `assertTenantNotSuspended` have no production callers. Existing paths that already check active hospitals are useful but do not establish universal suspension enforcement. `createAdminSetupLink` makes `/staff/setup` links from the API request host; that frontend route is absent (`App.jsx:67`). Verification never consumes the token. `controller/hospital.js:348` still stores recoverable initial-admin password ciphertext; the old approval flow remains.

Operational waiting metrics query nonexistent token status `queued` (`saasOperationsService.js:188`; token enum uses `waiting`), and “staff setup completion” actually measures department coverage, not accepted invitations.

**Repair:** complete or disable the new setup path; remove new recoverable-password writes, use an approved frontend origin and atomic one-use setup; explicitly preserve/review historical ciphertext cleanup. Integrate one entitlement policy at all mutations with atomic capacity enforcement, and define continued patient access/support during suspension. Name metrics according to what they measure.

### A11 — High: publication and professional verification are not enforced

New doctor records default to verified/published (`model/doctor.js:98`); a doctor can set their own verification status (`controller/doctor.js:517`). Searches show publication/practice-enable flags are not consulted by scheduling or discovery. Independent discovery still excludes doctors with hospital affiliations (`controller/doctor.js:143`). Practice availability fields do not publish real CareSessions.

**Repair:** separate doctor-submitted credentials from operator-reviewed status, default to pending where evidence is absent, enforce explicit practice publication and booking eligibility, and let an affiliated doctor publish a separately scoped independent practice. Preserve existing identities; do not bulk invent verification. Provide a usable schedule/publication UI and test dual-practice isolation with real bookings.

### A12 — High: ETA/pause/priority are not reliable operational controls

Pause lives in a process-local Map (`queueTrackingService.js:7`), disappears on restart and is ignored by actual consultation starts. An arbitrary extra 15 minutes is added for a pause (`:77`). Priority override records a sentence but changes no ordering (`:173`). Kiosk groups by department across all dates and doctors (`:96`), allowing old tokens and multiple active sessions to collapse into one “now serving”. Current consultation remaining duration and terminal target status are not handled accurately in ETA.

**Repair:** durable queue-session state used by the same ordering/start service as ETA and kiosk; restrict the display to explicit current service dates/sessions; show unavailable/paused estimates truthfully. Add observed timestamp/confidence and stale state. Test restart/two-process pause, real priority order, several doctors per department and rollover.

### A13 — High: AI guarantees exceed the paths actually protected

`minimizePatientContext` is used by the new preview controller, not the clinical provider paths. `validateAiBriefSchema` is not called by production clinical handlers. Direct provider calls remain in `opdAi.js:91`, `:231` and `appointment.js:1006`; the bounded wrapper added to `gemini.js:40` does not cover them. Rough free text is still sent for SOAP (`gemini.js:82`); selecting fields alone cannot guarantee text contains no PII. The public Gemini route remains unbounded and accepts caller-selected instruction type; errors expose provider messages (`:69`). The evaluation test checks fixture expectations, never runs the actual red-flag engine (`tests/ai-reliability.test.js:97`).

**Repair:** one real provider boundary with bounded validated input/output, explicit provenance/consent policy and abort/time limits; clinician review/versioning from A03; fallback labels distinguishing generated notes from deterministic templates. Run fixtures against the real routing rules. Clinical validation, provider data-processing terms and jurisdictional requirements remain external questions.

### A14 — High: new schema constraints are not deployed by the existing migration gates

`connection.js:11` disables automatic indexes. `startupReadiness.js:8` only gates earlier queue/ledger/auth/durable/scheduling schemas. The new catalogs/inventory/prescription indexes have no reviewed bootstrap/migration path. Accession barcode is indexed but not unique (`model/labOrder.js:99`); encounter token/appointment uniqueness is absent. P20 asserts these indexes exist and require no migration, which the source cannot establish.

**Repair:** additive schema inspector/dry-run with duplicate/reference report; named partial uniqueness constraints where appropriate; explicit apply/recovery plan and readiness gate. Rehearse on an isolated copy. Never run syncIndexes or assume successful model validation created indexes in production.

### A15 — Medium: patient UI demonstrates invented guidance and a decorative QR

`PatientVisits.jsx:202` guesses destination from token status; `:218` claims “With Attending Clinician” from consultation status without custody evidence. `:289` renders a Lucide icon plus truncated record ID, then tells users to present it as a QR. The page calls neither guidance nor live-timeline APIs. No frontend callers create lab orders/prescriptions or consume patient-results/patient-prescriptions; the downstream worklists therefore do not constitute a connected clinician-to-patient journey. The new worklists also lack the actor-change disposal/denial clearing used in the earlier clinical workspaces.

**Repair:** consume the authorized encounter projection; render a real scannable opaque payload and printable ticket; create orders from an authorized consultation; show released report/prescription history in the correct patient's record; clear stale private data on session changes. Verify complete browser journeys, including empty/error states and mobile dialogs.

### A16 — Medium: design consistency and doctor-name formatting remain unfinished

`Dashboard.jsx:103` uses a red hero; `AiBot.jsx:145` and `:151` use red controls and a red/blue gradient. `AiBot.jsx:195` prepends `Dr.` to already titled source names; `utils/appointments.js:2` returns the raw name. New pages use variables such as `--mp-text-muted`, `--mp-primary`, `--mp-surface-subtle`, while the established stylesheet defines `--mp-muted`, `--mp-accent`, `--mp-surface-muted`.

**Repair:** complete one semantic color system across every shell, assistant, dashboard, public page, dialog and dark mode; add one display-only doctor-name formatter accepting repeated prefixes without changing stored names. Include repeated `Dr.`, plain names, missing names and whitespace cases. Red should consistently mean danger/urgent status, not general navigation.

### A17 — Medium: community moderation/preferences need lifecycle completion

`controller/community.js:9` returns full Message documents including reports to ordinary members; reporting adds embedded reporter/reason metadata. Removal overwrites original content (`:188`) rather than preserving a separately restricted moderation record. Preferences are updated by separate pull/push operations (`:199`), and no delivery caller consumes them. Pagination remains optional and defaults to unbounded history. New announcements/moderation/preferences have no complete frontend interaction.

**Repair:** member/organizer DTOs, bounded default history, idempotent reporting, restricted preserved moderation audit, atomic preference updates and actual delivery filtering. Preserve original message evidence under the agreed retention policy.

## Check provenance and launch-document correction

Executed against `c42c3529` during this audit:

| Command | Result | What it establishes |
|---|---|---|
| `backend: npm.cmd test` | 142 passed, 0 failed/skipped; runner duration 31.656 s | Current configured unit suite passes; test bootstrap removes DATABASE_URL and disables mail/providers |
| `frontend: npm.cmd run test:ui` | 37 passed, 0 failed/skipped; runner duration 0.556 s | Configured helper/unit suite passes |
| `frontend: npm.cmd run build` | Passed; 2,318 modules; 25.80 s; main JS 804.07 kB (228.79 kB gzip), chunk-size warning | Compilation only; not a browser or clinical acceptance test |

P12 backend tests largely mutate in-memory Mongoose documents rather than calling transitions. P15–P17 tests take the disconnected fake-success branches. P13 privacy/ETA cases assert objects invented inside the test. `frontend/e2e/encounter-journey.unit.mjs` defines its own format/link functions rather than importing the application. These tests can stay green while the reported defects exist. No fresh integration suite, browser journey, production health check, external-provider delivery, clinician assessment or legal review was performed in this audit. Earlier 120 integration/77 browser results precede these commits and must not be presented as evidence for P12–P20.

`docs/LAUNCH_REPORT.md` should be replaced with evidence-based status before release. Concrete contradictions include public operations routes despite security sign-off; claims of single-use setup and atomic dispensing; invented barcode uniqueness; obsolete queue index; `/health` and `/ready` instead of `/health/live` and `/health/ready`; `/api/saas/metrics` instead of `/api/saas/tenants/:id/metrics`; configuration names that do not match executable configuration; and Strict/Lax cookie claims where production uses SameSite=None. A generic `git revert -m 1` is not a valid rollback recipe for these ordinary commits. Declare exact release commits and data compatibility after repair/rehearsal.

Read for context: Common in MEDIPULSE_CODEX_PROMPTS, MEDIPULSE_REVIEW, BUG_BACKLOG, WORK_LOG recent phases, P11 coverage, ENTERPRISE_PLAN and LAUNCH_REPORT. Inspection focused on new routes/controllers/models/services and their frontend/test callers, while preserving prior reports as history. External clinical permissions, jurisdiction/country, billing provider, retention/consent, support staffing, hospital operating requirements and recovery objectives are not established by repository text.

## Follow-up review of Gemini remediation `edd47814`

The baseline findings above remain historical evidence. Gemini's later P21 commit was reviewed again on 11 October 2026; it does **not** establish full closure of A01–A17.

Verified residuals: the guidance guard checks `hospitalId/patientId` on a DTO that contains neither field; encounter mutation services ignore the newly supplied `hospitalId`; walk-in linking is still an unproved pair of separate saves; the common visit transition uses undeclared `mongoose`; laboratory role names `LAB_TECHNICIAN/LAB_SUPERVISOR/PATHOLOGIST` do not match the current staff enum; SOAP's `version` is absent from its schema and its check is optional; pharmacy stock/prescription saves remain separate; setup consumption does not set a password or supply the missing frontend; pause is not used by real consultation starts. These were verified in source, not inferred from the P21 work-log claims.

The follow-up contains the unsafe encounter commands with explicit 503 responses, authorizes encounter/timeline reads from actual source identity and existing department/assigned-doctor policy, rejects doctor accounts as platform operators, repairs the common transition import and the actual LAB_TECH role, and revises naming/visual presentation. Containment is **not** completion of the encounter lifecycle. The connected demo plan remains preparation only. No operational database was seeded, no mail was sent, and no professional verification was invented.

The complete isolated integration run before the transition-import repair reported **109 passed / 18 failed (127)**. This is stronger contrary evidence than the passing 145-unit helper suite; exact post-repair results are recorded in WORK_LOG. The initial targeted integration command also failed because the Docker replica advertised `mongo` to a Windows host client; rerunning with the explicit local `directConnection=true` target reached the actual database. The browser fixture's simulated host origins required explicit CORS matching; that correction affects fixtures only.

Astra wrote the review/plan before its agent hit a usage limit, so a final agent completion message was unavailable. The parent checked the resulting documents and the later implementation directly. **Owner preference: future Astra reviews use Medium effort.** Do not retrospectively describe this earlier review as a Medium run.
