# MediPulse release status — 20 October 2026

**Status: launch approval withheld.** The P20/P21 “all phases and A01–A17 resolved” statements are superseded by the source review and executable integration checks below. This document is engineering evidence, not clinical or legal sign-off.


## Current candidate summary — 20 October

**Published frontend candidate: `d58def4a`.** Anonymous live Chromium checks verified that build, company/Connect rendering and 390px reload with zero page errors, horizontal overflow or write requests. The initial private probe omitted the owned canonical www host and was corrected. This is public-page acceptance, not authenticated clinical or real-device/provider acceptance. The subsequent documentation-only commit records this evidence; application code is unchanged.

Booking/fullscreen consultation fixes are published as `2358b356`. The following route-loading wrap-up reduces main JS from **802.20 to 386.50 kB**, adds explicit loading/focused error recovery, and removes the floating assistant from consultation/triage screens. **34/34 targeted Chromium desktop/mobile checks**, build and affected lint pass. Detailed commands, scope and the earlier interrupted attempt are in WORK_LOG.

The public frontend and alias advertised `2358b356` before this wrap-up publication. API liveness/readiness were HTTP 200 with MongoDB/Redis ready; optional Kafka was degraded and actual mail/TURN delivery is unverified. These public probes are not full authenticated production acceptance. Historical checks below belong to their stated revisions; launch approval remains withheld for the unfinished workflows listed in the table.

Appointment clinical write/review fixes are published as `9c573488`; the following hospital queue-pause repair adds durable controls and start enforcement. WORK_LOG records the local tests. These code publications have not established authenticated production parity or completed the remaining launch gates. The public build verification above remains limited to its stated revision.

## Reviewed revisions

- `c42c3529`: Gemini P11–P20 baseline reviewed by Astra; [findings](ASTRA_REVIEW.md) and [ordered repair plan](ASTRA_IMPLEMENTATION_PLAN.md).
- `edd47814`: Gemini's subsequent remediation was inspected independently. Useful authentication, tenant filtering, disconnected-database errors and visual aliases were retained. It does not complete every audit item.
- Follow-up working changes: source-record encounter authorization, staff department checks, temporary containment of unsafe new encounter commands, account-kind restriction for operators, shared doctor-name formatting, and cohesive dashboard/assistant/hospital surfaces. Exact checks and published revision belong in [WORK_LOG](WORK_LOG.md).

## Required work before expanding a pilot

| Boundary | Current limitation / required evidence |
|---|---|
| Established OPD/booking/refund transitions | Gemini introduced an undeclared `mongoose` reference into the common transaction path. The import is repaired and all 128 isolated integration tests pass; unit checks alone missed this regression |
| Encounter identity and custody | Reads must authorize against the actual encounter/token. New transition, file handoff/refusal and account-link commands are temporarily unavailable; complete durable stage events, recipient acceptance, location scope, conditional revisions and verified identity linking before enabling them |
| Labs | R1 now enforces actual staff roles, assigned visit/department/service scope, patient/family and catalog identity. New source-linked orders use transactional command keys/revisions, configured catalog snapshots, independent approved verification, preserved released versions and version-bound clinician tasks. Historical workflow provenance stays read-only; creation replay, catalog setup/repair tooling and connected patient/encounter UI remain pending. WORK_LOG contains local evidence; this is not live deployment verification |
| Pharmacy | Qualified dispensing/returns and receipts now use one Mongo transaction, revision/key replay and immutable batch allocation history with quarantine returns. Local real-router race/crash/replay checks pass and the pharmacist UI sends proper staff CSRF and resumes pending commands. Legacy unproven fills remain blocked; creation replay, named index/repair tooling, clinician ordering and connected patient documents still need completion |
| SOAP review | Appointment notes, documents and SOAP now use atomic revision/status checks with prior clinical snapshots; review requires the exact generated version and source-note hash. The independent clinician UI supports explicit review and resists delayed stale snapshots. Completed note correction UI, hospital OPD review and released patient documents remain pending; see WORK_LOG for local evidence |
| Onboarding/operations | StaffAcceptInvite already implements staff password setup; the earlier blanket absence statement was inaccurate. This does not complete the separate hospital-admin setup journey or entitlement mutation callers. Hospital registration/approval still writes/decrypts administrator password ciphertext and needs the reviewed replacement |
| Queue controls | Hospital pause/resume now persists in the existing QueueRevision document with actor/history and required revision. Both hospital start paths check it transactionally; the doctor UI supports pause/resume and paused patient estimates withhold invented numeric delays. Cross-process/restart/race checks pass locally. Independent pause controls, priority ordering, terminal-visit ETA and multi-doctor/date/session kiosk repair remain open |
| Patient experience | Decorative QR, inferred room/file location, and missing released lab/prescription journeys need the actual authorized encounter graph |
| Independent/community/AI | Publication and booking eligibility, complete moderation/preferences delivery, provider boundary/consent and actual failure-path coverage remain required |
| Demo data | The connected synthetic graph and preservation plan exist in the repair plan. No new production records or mail/provider jobs are authorized by this report |

## Verification policy

Record commands, revisions, synthetic fixture scope and observed outcomes. Existing unit suites include injected adapters and helper-only tests; these cannot validate complete clinical journeys. The new access regression uses mounted production routers, actual session middleware and a disposable local database. Browser fixtures prove rendered UI/API contracts, not production provider delivery.

Use `/health/live` and `/health/ready` for the backend. Production health, deployed revision, schema/index readiness and external service delivery must be checked against the exact approved release; this follow-up has not redeployed or seeded production. A successful local bundle build does not prove a live website has updated.

Keep the prior P23 originals, archives, wallets and patient/family history intact. Production database additions/index changes, provider activation and DNS changes need the concrete reviewed execution boundary in Common. Preserve additive-data compatibility when preparing rollback; do not apply a generic merge-revert command to ordinary commits.

## Follow-up check results

145 backend unit, 128 isolated integration, 38 frontend unit and 60 Edge browser tests pass with no failures/skips. Build passes; affected lint has no errors and three existing warnings. Browser checks use the production-like same-origin API relay; raw simulated public-host to loopback requests are blocked by Edge private-network policy. See WORK_LOG for commands, scope, earlier failures and residual gates. These results do not close the unfinished clinical expansion listed above.

R1 backend follow-up: 21 targeted real-router/local-database integration checks and 145 backend unit checks pass. Full integration/frontend/browser results above belong to the earlier P22 revision. Exact scope, containment and preservation evidence are in WORK_LOG. New order creation is source-bound but not yet retry-safe or coordinated transactionally with consultation completion.

Pharmacy R2 follow-up: 145 backend unit, 158 full isolated integration, 41 frontend unit and 16 pharmacy workflow browser checks passed; the repaired visual/readability subset passed 2/2. Build/affected lint passed. These are local synthetic checks, not a live deployment or hospital clinical acceptance. Exact commands, failures, transaction/return policy and remaining boundaries are in WORK_LOG.


## Booking / online consultation follow-up — 20 October 2026

The interrupted appointment/call batch now includes an explicit device-join lobby, responsive teal meeting room, native fullscreen with accessible expanded fallback, bounded reconnect, preserved mute/camera intent, genuine audio-only camera recovery, authorized media/chat signaling, visit information without the broken reports fetch, and parent-controlled note-save/completion confirmation. Family hold review and completed scheduled-visit filtering are repaired. WORK_LOG records the actual tests and earlier failed/interrupted attempts; this is not blanket clinical expansion or production-call acceptance.

Remaining release gates above continue to apply. No production data/schema/provider/DNS or deployment-console changes occurred in this batch. Real mobile devices, cross-network relay behavior, deployed frontend/backend parity and the large initial JS chunk still need release attention.

Edge 155 synthetic-camera repeats sometimes produced zero source/encoded video frames despite enabled tracks; foregrounding and separate browser processes did not reliably resolve it. Bundled Chromium comparison passed the targeted flows. See WORK_LOG for final canonical-suite evidence and the remaining real-device/relay acceptance gate; no blanket Edge video guarantee is claimed.

Final bounded batch evidence: 163 backend unit + 43 targeted local integration + 48 frontend unit + **54/54 canonical Chromium browser scenarios** passed; final build and affected lint passed. Initial JS is 802.20 kB / 231.36 kB gzip. Full product launch gates and the Edge/physical-device limitations above remain open. Detailed commands and prior failures are in WORK_LOG.
