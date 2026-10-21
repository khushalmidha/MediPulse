# Antigravity independent final review - 22 October 2026

Review baseline: `694fdb8d` (AG22), following the Antigravity AG01-AG22 series. This review checked high-risk claim/identity, booking/clinical read lifecycle, actual route mounts, QR decoding and enterprise acceptance evidence, and reran the checks below. It is not a claim that every line or physical production workflow has been proven correct.

## Confirmed findings and disposition

| Priority | Finding | Resolution / exact boundary |
|---|---|---|
| P0 | Walk-in request controller accepted caller-selected OTP; service never delivered it, reported sent, and exposed `devOtp` when runtime mode was unset | Removed requested OTP from the controller. Request/verify/link refuse every non-test runtime before reads/writes. AG05 reopened for real delivery; reception-assisted operations remain the fallback |
| P0 | Self-bound claim proof could be redirected to another owned family patient; successful OTP consumption did not bind the current OTP hash | Require the requested patient/family to match proof, including explicit self/null; consume with kind/hash/expiry/attempt CAS. Isolated Mongo regression verifies no changed link or consumed proof on redirect |
| P1 | Custom QR matrix passed shape assertions but failed independent decoding of the synthetic ticket | Replaced hand-written encoding with pinned `qrcode-generator@2.0.4`, automatic version selection, UTF-8 bytes and quiet zone. Reject oversize; do not truncate. Three OpenCV decodes passed (ticket, text, Unicode); added SVG/oversize regression |
| P1 | Enterprise acceptance hardcoded all five milestones and operating assertions true; DR simply trusted caller booleans/metrics and asserted statutory RPO/RTO and cryptographic integrity | Report now returns prototype_only/not_accepted, even with configured records or a legacy passed drill. DR records strict finite typed input as self_reported/recorded_unverified; never certifies restore/integrity/targets. Additive schema supports evidence without rewriting history |
| P1 | AG17-AG22 marked verified despite no mounted enterprise router/controller/UI and largely service-replacement unit tests | Reopened all six tasks. Five explicit local Mongo suites failed setup, before assertions. Keep prototypes unmounted; repair actual vertical workflows and acceptance instead of fabricating a green status |
| P1 | Live tenant export response and admin UI claimed HIPAA/NDHM compliance without proof | Preserve the minimized configuration export; remove certification wording, mark retention not_configured and regulatory review not_verified. Actual export regression checks returned metadata |
| P1 | Production dependency audits found 14 backend and 18 frontend advisories, including one critical in each | Apply compatible lockfile security updates and explicitly upgrade Nodemailer to 10.2.0 with actual-mailer offline MIME regression. Remove vulnerable dev-only nodemon chain in favor of native Node watch. Final full and production-only audits report zero known advisories in both packages |
| P2 | Render pinned EOL Node 23 despite Docker and local checks using Node 24 | Align backend/.nvmrc to the Node 24 LTS line; actual deployed runtime still needs AG16 reconciliation |
| P2 | Patient packet/clinical loads could race after identity/tenant/visit changes or modal close; lab summary used nonexistent name/code fields | Add abort, timeout and generation guards, clear identity-bound state and use actual lab field names. Fix affected lint errors and effect dependencies |
| P2 | Enterprise service replacement adapters could be set outside explicit tests | All five new enterprise adapter setters refuse non-test runtimes. This guard does not establish business authorization for those unmounted services |

Dependency/runtime references: [Nodemailer maintainer changelog](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md), [offline stream transport](https://nodemailer.com/transports/stream), and [Node release status](https://nodejs.org/en/about/previous-releases) and [Render version resolution](https://render.com/docs/node-version). The Nodemailer test executes the actual `sendMail` wrapper and real MIME renderer with an offline transport; it does not certify live SMTP. Native watch was verified with a disposable imported-module restart fixture. No forced downgrade or real message delivery was used.

Relevant source: `backend/controller/encounterJourney.js`, `backend/services/encounterJourneyService.js`, `backend/services/hospitalIntegrationsService.js`, `backend/services/saasOperationsService.js`, `frontend/src/utils/qrCode.js`, `frontend/src/pages/hospital-website/PatientVisits.jsx`, `frontend/src/components/clinical/ClinicalUI.jsx`. New boundary tests execute the actual report/DR/export functions with model-query mocks, not replacement service logic. QR API reference: [maintainer documentation](https://github.com/kazuhikoarase/qrcode-generator/blob/master/js/README.md).

## Executed checks

| Check | Current result | Scope / limit |
|---|---|---|
| Registered backend integration runner | 330/330 passed, 0 failed/skipped; 378.37s | Isolated local Mongo replica set + Redis; excludes the five enterprise files audited separately |
| Backend unit suite | 224 passed, 0 failed/skipped; 35.38s | Includes claim containment and actual enterprise report/DR/export plus offline actual-mailer regressions |
| Frontend unit suite | 59 passed, 0 failed/skipped; 1.50s | Includes QR oversize/SVG regression |
| Targeted Chromium journeys | 20 passed, 0 failed, 2 skipped; 2.0m | Desktop/mobile call media/reconnect, notes/review/stale save, pause, patient account disposal and packet refresh; duplicate viewport sweeps skipped |
| Frontend production build | Passed; 58.19s | Main JS 409.14 kB / 131.32 kB gzip; no live deployment claimed |
| Affected frontend ESLint | Passed, zero warnings | Antigravity/review-changed src files, max-warnings=0 |
| Independent QR decoding | 3/3 passed | OpenCV pixel decoding of synthetic ticket, plain text and Unicode; not camera/print certification |
| Dependency audits | 0 reported advisories in backend and frontend | Both full npm audit and production-only audits, 22 October 2026 |
| Native Node watch | Startup + imported dependency restart passed | Disposable local fixture; no application environment/provider started |
| Plan checker | Passed: 23 tasks, 15 verified_local; next AG05 | Evidence paths/dependency consistency only; not software acceptance |

The explicit enterprise audit command was:

```powershell
# From backend, with the isolated local targets described in the handoff
node --import ./tests/bootstrap.js --test tests/integration/ipd-adt.test.js tests/integration/nursing-care.test.js tests/integration/emergency-theatre.test.js tests/integration/hospital-revenue-stock.test.js tests/integration/hospital-integrations.test.js
```

It produced **0 passed / 5 failed / 0 skipped (9.67s)**: Hospital fixtures omit required schema fields (including address, registration and type). These are real unresolved failures, not service verification. `backend/scripts/testIntegration.js` does not register these suites. The new enterprise unit suites mostly install `set*TestDouble` implementations; green unit totals alone cannot substantiate actual authorization, transactions, adapters or restoration.

Initial diagnostics found the QR decode failure and 18 affected lint errors/3 warnings. The new packet browser regression initially used an exact text locator that omitted its Subjective label; both viewport cases failed at that assertion, the locator was corrected, and the final combined suite above is the current evidence. An earlier full integration attempt was interrupted after the new test fixture name and an obsolete family redirect expectation failed; both test problems were corrected and superseded by the final runner result above. No interrupted run is counted as passing.

## Remaining release work, in order

- **AG05:** actual verified challenge delivery, recorded-phone ownership, resend/attempt/race controls and patient UI recovery. No placeholder provider was activated.
- **AG16:** exact deployed revision parity, approved readiness/schema/data inspection, actual delivery, real cameras/TURN, backup/recovery/support and hospital owner acceptance. Provider payment collection remains separate from demo credits.
- **AG17:** hospital-approved jurisdiction/retention/clinical escalation and recovery objectives. Existing values are unreviewed proposals, not medical or statutory authority.
- **AG18-AG22:** authenticated scoped API/controller/UI, actual service/replica-set and concurrency tests, safe migration plan, one milestone at a time. Fix the five integration fixtures and register suites; configuration rows do not implement LIS parsing, PACS viewing, SAML/OIDC/SCIM, or a restore.

**Conclusion:** the reviewed fixes and local outpatient checks can be published; the full enterprise/startup implementation cannot truthfully be declared finished. No production records, wallets, credentials, indexes, archives or provider settings were changed.
