# MediPulse release status — 21 October 2026

**Status: Outpatient pilot candidate verified locally; production deployment and enterprise expansion remain separate approval gates.** The previous P20/P21 blanket claims are superseded by the source-backed implementation and executable verification recorded across AG00 through AG16. This document is engineering evidence, not clinical or legal sign-off.

---

## Candidate verification summary — 21 October 2026

Baseline: `565134c2`. All 16 outpatient pilot tasks (**AG00 through AG16**) have been implemented, tested, and verified locally with zero test failures, zero regressions, and clean production builds.

| Test Category | Suite Count / Description | Pass Rate | Execution Time |
|---|---|---|---|
| **Full Integration Runner** | 329 comprehensive real-router & isolated replica set integration tests (`backend/scripts/testIntegration.js`) | **329 / 329 (100%)** | 383.17 s |
| **Backend Unit Tests** | 171 unit tests covering auth, models, queues, money, clinical, AI boundary (`backend/tests/`) | **171 / 171 (100%)** | 38.46 s |
| **Frontend UI Tests** | 58 UI unit tests covering clinical workspace, encounter journey, laboratory, pharmacy, account forms (`frontend/src/`) | **58 / 58 (100%)** | 308 ms |
| **Browser Journey Checks** | Chromium desktop & mobile viewports outside OneDrive (`tools/run-browser-checks.mjs`): clinical SOAP review/invalidation, route recovery, design system contrast/traps | **21 / 21 passed** (1 redundant mobile sweep skipped) | ~99 s total |
| **Frontend Production Build** | Vite production bundle (`frontend/dist/`), main JS bundle 387.45 kB / 124.25 kB gzip | **Clean build (0 errors)** | 23.74 s |

---

## Outpatient pilot implementation scorecard (AG00 – AG16)

| Task ID | Component & Milestone | Verification Evidence |
|---|---|---|
| **AG00** | Audit, production API contract and consultation write bypass | 19 integration, 163 backend unit, 49 frontend UI, 6 browser scenarios |
| **AG01** | Clinical and encounter schema inspection/repair gates (named indexes) | 6 integration, CLI rehearsal (dry-run, apply, rollback) |
| **AG02** | Durable encounter initialization, replay recovery and linking | 7 integration cases covering immediate, assisted walk-in, and scheduled bookings |
| **AG03** | Shared encounter transitions, locations and required steps | 6 integration cases covering multi-step transitions and location administration |
| **AG04** | Physical file custody handoff, recipient acceptance and refusal | 6 integration cases covering sender custody, recipient transfer, and refusal reason |
| **AG05** | Walk-in account claim challenge, signed proof and replay recovery | 8 integration cases covering OTP rate limiting, signed proof, and multi-document linking |
| **AG06** | Transactional clinical order creation, idempotency and consultation coordination | 7 integration cases covering command keys, idempotency replay, and race serialization |
| **AG07** | Connected clinician ordering, resilient command keys and critical tasks | 7 integration cases covering doctor ordering, service worklists, and critical alerts |
| **AG08** | Patient released documents, printable care packet, QR ticket and scan verification | 8 integration cases covering privacy-safe bearer scan, released lab reports, approved Rx |
| **AG09** | Queue order, priority override, public kiosk and ETA semantics | 9 integration cases covering urgent priority preemption, privacy kiosk, and truthful ETA |
| **AG10** | Atomic hospital-admin password setup and registration replacement | 12 integration cases covering 48h expiring setup links, single-winner consumption, bcrypt |
| **AG11** | Real entitlement/quota/suspension callers and activation checklist | 7 integration cases covering department/staff tier limits, tenant suspension, 5-stage activation |
| **AG12** | Independent practice publication and booking eligibility | 10 integration cases covering operator verification, publication gating, zero-fee preservation |
| **AG13** | Complete community moderation, pagination and preference delivery | 11 integration cases covering bounded pagination, organizer queue, and durable outbox delivery |
| **AG14** | One clinical AI boundary and honest evaluation | 11 integration cases, 10 AI reliability unit cases, 6 clinical evaluation fixtures (EVAL-001–006) |
| **AG15** | Repeatable connected synthetic dataset and pitch journey | 11 integration cases, 6 pitch journey cards, real derived metrics, guarded rollback |
| **AG16** | Final verification and production acceptance reconciliation | 329 integration runner cases, 171 backend unit, 58 UI, browser runs, clean build |

---

## Operating requirements and guardrails

1. **Schema and Index Administration**:
   - Explicit named indexes (`ag01_`) must be applied using `node backend/scripts/initClinicalSchema.js --explicit-target --apply --writers-paused --backup <file>`. Startup `autoIndex` is disabled across clinical collections.
   - Guarded rollback drops only `ag01_` indexes without modifying existing collection documents or archives.
2. **Synthetic Data and Demo Preservation**:
   - Demo fixtures use `backend/scripts/prepareFoxoDemo.js` with `--explicit-target`, `--date`, `--plan`, `--apply`, or `--rollback`.
   - Guaranteed `suppressOutgoing: true`: rehearsal never invokes live payment gateways, sends real emails, or executes external provider calls.
   - Pre-condition hash checks protect existing wallets, accounts, and clinical edits from being overwritten or destroyed during rollback.
3. **Session and Authentication Security**:
   - Host-only HttpOnly session cookies with origin and CSRF validation on all non-safe requests.
   - Single-winner consumption on staff invites and hospital-admin setup proofs with `authVersion` invalidation.
4. **Resilient Clinical Writes**:
   - Strict CAS revisions on appointment notes, consultation records, encounter stages, lab orders, and pharmacy dispensations. Stale edits are rejected with HTTP 409 Conflict.

---

## Explicit production acceptance gates (external dependencies)

The following capabilities are deliberately kept open and must NOT be claimed as active in production without their exact environment verification:

1. **Physical Devices and Cross-Network TURN**:
   - Synthetic desktop and mobile browser runs pass in bundled Chromium. Real physical mobile cameras, hardware codecs, and restrictive enterprise NAT/firewall traversal over TURN remain release gates.
2. **Real Outbox and Mail Delivery**:
   - Outbox persistence, retry scheduling, and failure quarantine are tested locally. Live SMTP credentials and verified inbox delivery require owner environment configuration.
3. **Payment Provider Settlement**:
   - Demo wallet credit and transaction reconciliation are verified. Real payment gateways (e.g. Razorpay, Stripe) remain inactive until country-specific business accounts and webhooks are authorized.
4. **Enterprise Expansion Track (AG17 – AG22)**:
   - Inpatient bed management, ADT, nursing medication (eMAR), theatre operations, revenue procurement, and HL7/FHIR interfaces belong to the enterprise expansion track documented in `docs/ENTERPRISE_PLAN.md` and are pending subsequent development.
