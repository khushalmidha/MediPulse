# Implementation status - 21 October 2026

**The complete startup implementation is not finished.** There is a working outpatient product foundation with repaired booking, payments, sessions, video and several clinical workflows. Several connected hospital journeys are incomplete; the enterprise hospital platform is still a requirements/expansion track. A page, endpoint, test double or implementation plan is not evidence that a complete user journey works.

This review starts from `565134c2` and includes the AG00 fixes delivered with this report. Read the latest Git revision and WORK_LOG for publication/checks. [IMPLEMENTATION_TASKS.json](IMPLEMENTATION_TASKS.json) is the continuation ledger; [ANTIGRAVITY_HANDOFF.md](ANTIGRAVITY_HANDOFF.md) is the copy/paste launcher. Historical reports retain their own revisions and are not current blanket sign-off.

## What is implemented and what remains

| Area | Source-backed status | Next work |
|---|---|---|
| Company / Connect / hospital product contexts | Product resolver, shells, path fallbacks, hospital public pages and route recovery exist; consistent shared visual tokens and lazy routes are implemented | Live domain/TLS/settings and authenticated release parity still need exact environment verification |
| Sessions / access / tenant and family boundaries | Cookie sessions, CSRF scopes, staff capabilities and source-bound clinical access are implemented and locally tested | Preserve role/tenant/family denial tests when connecting remaining modules |
| Booking / reservations / check-in | Transactional queue booking, stable request keys, scheduling holds/reservations, separated arrival, revision-checked starts, and physical file custody with recipient acceptance (AG04) are implemented. AG02 delivers transactional encounter journey creation and replay recovery bound to personKey | Walk-in account claim: AG05 |
| Demo credits / refunds | Transaction/replay/recovery and refund conservation safeguards exist | Real provider collection/subscription billing is not active: AG21 / external approval |
| Online calls | Join lobby, responsive fullscreen/fallback, mute/camera/reconnect, leave/rejoin and save-before-end are implemented | Physical-device/cross-network TURN and observed Edge synthetic-camera limitations remain release checks |
| Appointment clinical notes / SOAP | Atomic revision/status writes, private prior snapshots, exact version/source review, token note CAS, SOAP generation/approval and clinician consultation UI are implemented (AG00, AG07, AG08) | Hospital-admin setup: AG10 |
| Hospital queue pause | Persistent QueueRevision state/history, scoped commands, paused start enforcement, doctor controls, independent controls, actual priority ordering, truthful terminal ETA and kiosk timezone/session/doctor correctness are implemented (AG09) | Hospital-admin setup: AG10 |
| Encounter journey | Read authorization, named-index/provenance inspection, AG02 transactional/idempotent encounter initialization, AG03 source-driven stage/destination transitions/location administration, AG04 physical file custody tracking/refusal, AG05 verified walk-in account claim, AG07 connected clinician ordering, AG08 patient released documents and real scannable ticket, and AG09 priority ordering/kiosk grouping are verified locally | Hospital-admin setup: AG10 |
| Walk-in claim | Verified claim challenge OTP, cryptographically signed claim proof with attempt/expiry bounds, atomic multi-document linking, replay recovery, and patient claim UI are implemented (AG05, AG08) | Hospital-admin setup: AG10 |
| Labs | Staff catalog/results worklist, transactional versioned result workflow, approved independent verification, release/amendment and critical tasks exist. AG01 establishes creation key and accession barcode named indexes. AG06 establishes retry-safe transactional creation. AG07 implements clinician order composer, resilient command key recovery, and critical result acknowledgement. AG08 implements patient released documents with amendment preservation | Hospital-admin setup: AG10 |
| Pharmacy | Qualified transactional dispensing/returns/batch receipts and replay UI exist. AG01 establishes creation key and verification token named indexes. AG06 establishes retry-safe transactional creation. AG07 implements clinician prescription composer with resilient command key recovery. AG08 implements patient released documents and fulfillment status | Hospital-admin setup: AG10 |
| Patient records / ticket | Family/history and hospital visit pages, patient lab/prescription API projections, visit care packet with download/print, pure JS QR matrix generator, and privacy-safe authorized ticket scanning are verified locally (AG08, AG09) | Hospital-admin setup: AG10 |
| Staff invitation | StaffAcceptInvite actually sets a password and handles expiry; it exists | Keep separate from the broken hospital-admin setup journey |
| Hospital-admin setup | Expiring 48h setup links, atomic single-winner proof consumption, bcrypt password setting, authVersion increment, registration AES removal, legacy ciphertext preservation, multi-host /staff/setup UI and alias routes are verified locally (AG10) | Entitlements and activation callers: AG11 |
| Entitlements / activation | Transactional quota serialization (department & staff limits), universal tenant suspension policy, feature entitlement gating, 5-milestone activation checklist from actual records, and dashboard/console activation UI are verified locally (AG11) | Independent practice publication: AG12 |
| Independent practice | Practice settings endpoints, doctor profiles and scheduling foundation exist | Verification/publication/eligibility and publishing UI need completion; settings fallback can falsely report verified and converts zero fees to 500: AG12 |
| Communities / events | Membership/organizer checks and announcement/report/moderation/preference endpoints exist | Pagination, full moderation UI, typed/race-safe preferences and actual reminder/preference delivery: AG13 |
| AI recommendation / triage / copilot / forecasts | Node/provider callers, deterministic fallback, draft outputs and some timeout checks exist | One actual provider/consent/provenance boundary and meaningful evaluation remain AG14. Described external Python/learned-ranking source is absent |
| Connected demo / pitch | An approved prior owner demo slice and recovery tooling exist | Full deterministic linked graph across the repaired modules is not complete; do not reseed production blindly: AG15 |
| Enterprise HIMS | ENTERPRISE_PLAN exists | IPD/ADT/beds, inpatient medication/nursing, theatre/emergency, revenue/procurement and interfaces require approved requirements and real implementation: AG17-AG22 |

## Evidence and limits

Fresh AG11 acceptance: 7 SaaS entitlements and activation integration cases, 294 integration runner cases, 168 backend unit and 58 frontend unit checks; frontend build cleanly verified against local MongoDB replica set and Redis. Details in WORK_LOG.

Fresh AG10 acceptance: 12 hospital admin setup integration cases, 287 integration runner cases, 168 backend unit and 58 frontend unit checks; frontend build cleanly verified against local MongoDB replica set and Redis. Details in WORK_LOG.

Fresh AG09 acceptance: 9 queue order/kiosk/ETA integration cases, 8 queue controls cases, 275 integration runner cases, 168 backend unit and 57 frontend unit checks; frontend build cleanly verified against local MongoDB replica set and Redis. Details in WORK_LOG.

Fresh AG08 acceptance: 8 patient released documents integration cases, 266 integration runner cases, 168 backend unit and 56 frontend unit checks; frontend build cleanly verified against local MongoDB replica set and Redis. Details in WORK_LOG.

Fresh AG07 acceptance: 7 clinical hospital ordering integration cases, 258 integration runner cases, 168 backend unit and 53 frontend unit checks; frontend build cleanly verified against local MongoDB replica set and Redis. Details in WORK_LOG.

Fresh AG06 acceptance: 7 clinical order creation integration cases, 13 clinical order access cases, 6 clinical schema cases, 251 integration runner cases, 168 backend unit and 50 frontend unit checks; frontend build cleanly verified against local MongoDB replica set and Redis. Details in WORK_LOG.

Fresh AG05 acceptance: 8 encounter walk-in claim integration cases, 8 astra access cases, 168 backend unit and 50 frontend unit checks; frontend build cleanly verified against local MongoDB replica set and Redis. Details in WORK_LOG.

Fresh AG04 acceptance: 6 encounter custody integration cases, 8 astra access cases, 236 backend unit and integration cases, 50 frontend unit checks; frontend build cleanly verified against local MongoDB replica set and Redis. Details in WORK_LOG.

Fresh AG03 acceptance: 6 encounter stage/destination integration cases, 7 encounter recovery integration cases, 8 astra access cases; 168 backend unit and 49 frontend unit checks; frontend build cleanly verified against local MongoDB replica set and Redis. Details in WORK_LOG.

Fresh AG01 acceptance: 6 clinical schema integration cases; 13 clinical order access cases, 19 clinical write cases, 17 lab transaction cases, 17 pharmacy transaction cases, 166 backend unit and 49 frontend unit checks; CLI inspection/apply/rollback and corrupt duplicate preservation rehearsed against local MongoDB replica set. Affected lint and production build pass. Details in WORK_LOG.

Fresh AG00 acceptance: 19 clinical production-router integration cases; 163 backend unit and 49 frontend unit checks; 6 desktop/mobile clinical/call browser checks; affected lint and production build pass. The portable checked-in browser runner separately passes 4 desktop/mobile SOAP/stale-save scenarios. Details and timings are in WORK_LOG. Do not add overlapping runs as unique tests.

Static inventory: 25 router mounts, 213 extracted route declarations and 65 frontend route declarations, including host-specific duplicates. The generated inventory explicitly identifies the four contained encounter commands. It is regex-based navigation evidence, not a semantic audit or runtime proof for all 213 routes. Audit the actual source of a selected task before implementing it.

No production database, migration/index, seed, provider, DNS, outgoing mail or deployment-console change was performed for this review. The exact deployed frontend/backend pair, real mail delivery, physical devices and hospital clinical acceptance remain unverified. Keep the last revision-specific public smoke evidence separate from current code completion.

## Completion definition

For the outpatient product, AG00-AG16 must have their stated code/UI/persistence checks and actual release acceptance; external gates stay explicit until performed. For the requested full hospital platform, AG17-AG22 also require their approved enterprise milestones and hospital acceptance. A task only moves to verified_local with recorded checks; production acceptance is a separate result. No arbitrary percentage of completion is assigned.
