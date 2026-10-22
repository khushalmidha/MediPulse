# AG22 verification review - 22 October 2026

Reviewed **32c85bde**, including the six new commits after 621fcdcd. The new enterprise controllers, mounted routes and consoles are real additions. The earlier review's absent-route and broken-fixture findings are historical: the five enterprise Mongo files now run, and this review reproduced **31/31 passes** plus **225/225 baseline backend units**. Those checks still did not establish complete clinical/financial/interface workflows.

## Confirmed findings and changes

| Priority | Finding | Change / remaining boundary |
|---|---|---|
| P0 | New enterprise services were mounted while actor/source access, clinical-policy and financial retry requirements remained unresolved | All five enterprise service boundaries now require explicit ENTERPRISE_PILOT_ENABLED=true outside isolated tests; default is false. This is containment, not approval or feature completion. Existing outpatient routes are unaffected |
| P1 | LIS logged arbitrary payload hashes as processed, without protocol parsing or a clinical write; replay marked success without a worker/payload | New records are received with no processedAt and processingImplemented=false. Replay returns 503 without changing history. UI calls these receipt metadata and explains processing is unavailable |
| P1 | Message-ID retries accepted changed content; read-then-create could duplicate; IDs were globally unique across tenants | Compare canonical payload hash/type/accession, reject changed requests, and use deterministic tenant/message _id upsert for concurrent deduplication. Model declares compound tenant/source uniqueness. Legacy global indexes require reviewed migration; none was applied |
| P1 | Ward issues accepted unrequested/excess items; only the latest partial transfer key survived, allowing older retries to move stock again | Validate unique whole quantities and remaining requested items, preserve bounded key/fingerprint history, reject changed-command replay, invalid ward, corrupt totals and insufficient unexpired batches. Legacy partial history without durable commands fails closed for reviewed reconciliation |
| P1 | Insurance could be applied to another admission's invoice; payment/credit quantities accepted fractional/infinite values | Bind TPA/invoice admission and patient; check invoice/preauth source identity; reject terminal insurance edits and unsafe minor-unit inputs. Durable payment/credit command keys and reconciliation still need implementation |
| P1 | Caller-entered witness ID/signature authorized controlled/high-alert medication; ordinary doses did not serialize against order discontinuation or check active admission | Controlled/high-alert administration now refuses with 503 until independent authenticated approval exists. Require literal true bedside checks, active matching order/admission/patient, and a transactional order write to serialize discontinuation. Existing records are preserved |
| P1 | Vitals falsely claimed escalation was notified; one nurse could create an already-acknowledged handover | New observations do not claim notification, and handovers remain unacknowledged. Real dispatch and recipient acceptance are still required |
| P1 | Frontend sessionScope omitted every new enterprise API family, sending account CSRF on staff-cookie writes; bearer-only router tests missed it | Map all eight new API mounts to staff scope and test an actual browser write/retry with the staff token, retaining the same receipt command |
| P2 | Integration GET failures were swallowed, leaving stale data/empty-success screens; role changes did not reset console state; mobile layouts overflowed | Show server errors and clear integration resources on denied reads; include role/admin access in workspace identity, scope integration tabs, use shared theme tokens, contain tabs and make grids/ward controls responsive |
| P2 | PACS accepted unsafe viewer schemes and regex search interpreted user text as a pattern | Reject script/credential-bearing viewer URLs and escape bounded literal searches. PACS dialog still displays metadata; a real authenticated imaging viewer is not implemented |

Regression tests exercise the actual Mongo-backed functions and HTTP routes. Existing positive tests were corrected where they asserted fake processing or accepted an unauthenticated witness. Service-replacement unit tests alone are not domain acceptance.

## Executed evidence

| Check | Result | Scope |
|---|---|---|
| Registered integration runner | 376 passed, 0 failed/skipped; 463.43s | Core/Connect/outpatient plus repaired enterprise files and new adversarial cases |
| Latest stock follow-up | 7 passed, 0 failed/skipped; 15.99s | Final source also rejects ambiguous legacy partial-command history |
| Backend units | 226 passed, 0 failed/skipped | Includes new non-test enterprise boundary regression |
| Frontend units | 60 passed, 0 failed/skipped | Includes new enterprise staff-CSRF/account-scope regression |
| Chromium browser subset | 18 passed, 0 failed, 2 duplicate viewport sweeps skipped; 1.1m | Four empty enterprise consoles at 360/768/1440, role/denial cleanup and actual staff-CSRF write/retry, plus existing clinical note/review/pause and two-participant call checks |
| Affected frontend lint | Passed, zero warnings | Four modified staff consoles and sessionScope helper |
| Production build | Passed; 24.40s | Main JS 414.75 kB / 132.52 kB gzip |
| Dependency audits | Backend 0, frontend 0 reported advisories | Fresh full npm audits; no dependency changes in this review |
| Plan consistency | 23 tasks; 15 verified local, next AG05 | Evidence/dependency consistency only, not software or clinical acceptance |

The registered runner includes the repaired enterprise files. A final targeted stock rerun additionally covers preservation of legacy partial-command ambiguity added after the full runner started. No omitted suite is being reported as passed. Local fixtures are synthetic; mail/provider dispatch is disabled except the existing explicit offline mail-rendering test.

Initial focused run: 20 passes / 2 failures because a new unchanged-witness assertion expected undefined rather than the model's null default; corrected. Initial browser checks found real mobile overflow, and the new nurse check used the wrong heading label. Corrected layouts and locator, then reran. Earlier failed/superseded runs are not included in final pass totals. Logs are private local files named medipulse-ag22-review-*.log under TEMP.

## What still prevents a full-product completion claim

| Task | Exact remaining work |
|---|---|
| AG05 | claimDelivery.js has only synthetic dispatch and an unconfigured runtime stub; request/verify/link still reject all non-test runtimes. Implement the approved provider adapter and atomic challenge reservation/outbox/resend handling before activation; credentials alone cannot enable it |
| AG16 | Exact deployed pair/readiness, approved schema/data inspection, actual mail/SMS, physical devices/TURN, observed recovery and owner acceptance remain unperformed |
| AG17 | A governance document/matrix is not actual hospital approval. Record qualified decisions; do not activate unapproved clinical thresholds/retention rules |
| AG18 | Validate admission patient/family/department/clinician/encounter references and actor assignments; complete command replay and admission identity invariants, including family cases. Existing source admits typed IDs without proving all references |
| AG19 | Independent witness authorization, explicit incoming handover acceptance, observed escalation delivery, trusted clinician identity and department/source access remain required |
| AG20 | Approved clinical/team workflows, actual source/actor/capability enforcement and replay/recovery evidence remain required; checklist booleans and role labels alone are insufficient |
| AG21 | Add durable invoice/payment/credit command identity, immutable financial/reversal evidence and complete source/role/reconciliation safeguards; a stock retry fix does not complete financial operations |
| AG22 | Implement and contract-test actual HL7/ASTM adapters, source-patient mapping, authenticated imaging viewing and SAML/OIDC/SCIM behavior. The current code records metadata/configuration. Observe a real restore/integrity exercise; not_accepted and recorded_unverified remain correct |

## Operating and migration instructions

Keep ENTERPRISE_PILOT_ENABLED=false for production. It is an explicit exposure guard, not hospital approval; do not enable it to bypass the unresolved checks above. A controlled local synthetic pilot may be enabled only with the isolated local environment and disabled outgoing providers. Ordinary outpatient operation does not need this flag.

LIS model changes remove the global messageControlId uniqueness declaration in favor of hospitalId/messageControlId. Before any approved production migration: inspect actual indexes and malformed/duplicate records, preserve a backup, pause writers, rehearse additive/index replacement and guarded recovery against a copy, and obtain exact execution approval. Do not use startup autoIndex or syncIndexes to silently replace production indexes. Deterministic _id deduplication protects new receipts even before the separately managed secondary index is installed; a conflicting legacy global index returns a clear 409. Stock command-history fields are additive; ambiguous legacy partial transfers are preserved and refused for review.

No production records/indexes/credentials/balances/archives, provider settings, DNS or deployment consoles were changed. The reviewed safety and UI changes are publishable; **the requested full enterprise product is not yet complete**. Continue through the corrected ledger instead of rebuilding the delivered controllers/consoles.
