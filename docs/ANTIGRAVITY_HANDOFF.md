# MediPulse - Antigravity / agent handoff

Updated **22 October 2026**, independent review of Antigravity's AG22 revision `694fdb8d`. The 22-phase delivery added useful outpatient code, but **the whole project is not finished**. This review fixes confirmed security/QR/lifecycle/claim defects and reopens unsupported completion states. Read `docs/ANTIGRAVITY_FINAL_REVIEW.md` before continuing.

## Paste into Antigravity

```text
Continue the existing MediPulse checkout on main. Read AGENTS.md, docs/ANTIGRAVITY_FINAL_REVIEW.md, docs/IMPLEMENTATION_STATUS.md and the Common instructions in docs/MEDIPULSE_CODEX_PROMPTS.md. Inspect git status and preserve unrelated changes. Run node tools/check-implementation-plan.mjs --next and load only the selected task.

Next is AG05, not AG22: walk-in account claim is deliberately disabled outside isolated tests because no verified phone-delivery provider exists. Never remove containment just to make the demo pass. Implement the approved real delivery contract, server-generated OTP and delivery/failure evidence with recorded-phone/patient/family binding, expiry/attempt/resend race handling and real-router tests. Provider activation and production data execution need separate exact approval. If the provider contract is unavailable, record the blocker and keep the safe containment.

AG16 release reconciliation is open. AG17-AG22 are unapproved requirements and unmounted service/model prototypes, not finished enterprise modules. Their five actual Mongo integration files fail fixture setup and are not in the registered runner. Unit suites that replace service behavior do not verify the real service. Approve hospital policies, complete one vertical workflow, repair fixtures and test actual authorization/transactions/UI before mounting or marking complete. Caller-reported DR figures and configured SSO/LIS/PACS rows are not proof of restoration or working integrations.

Use the actual mounts in backend/index.js and correct account/staff CSRF/session scope. Keep existing booking/money/clinical safeguards, draft/source/version review, neutral/deep-teal tokens and shared doctor-name formatting. Labs allow collection before billing and require explicitly approved independent verification. Preserve all patient/payment/history/archive/credential/wallet records. No production DB/index/seed/provider/mail/DNS/deployment-console operation without Common's separate approval. Git commits/pushes to main are already authorized as Khushal Midha <khushalmidha24@gmail.com>, without Codex coauthors or force push.

After each bounded phase update its ledger status, WORK_LOG and implementation status with actual commands/results, then commit/push. Do not clear pending work by redefining completion. If interrupted, record the exact checkpoint and next safe command.
```

## Checkpoint and evidence

- Actual Git root is the workspace's child `MediPulse`; root commands run there. Use `git log -3` for the published review commit and `git status --short` before editing.
- Ledger: 23 tasks; **15 retain verified_local evidence, AG05 and AG17-AG22 pending, AG16 implemented_pending_final_checks**. Verified_local is not production or hospital acceptance.
- QR replacement passed independent decoding; claim containment, family binding, stale packet/clinical read cleanup and truthful enterprise/tenant export metadata are recorded in the final review.
- Generated IMPLEMENTATION_INVENTORY: 25 mounts, 244 route declarations, 70 frontend route declarations. Regex output is navigation only, not completeness evidence.
- WORK_LOG keeps historical phase claims; the latest independent review supersedes unsupported all-complete assertions.

## Reproduce local checks

Prerequisites: Node 24 LTS, installed locked dependencies, Playwright Chromium, local Mongo replica set and Redis. `npm run dev` now uses native Node watch instead of nodemon; startLocal still validates the isolated medipulse_dev target. Never load a production environment into these commands or start seed/provider consumers for fixtures.

From root (PowerShell):

```powershell
docker compose up -d mongo redis
$env:TEST_DATABASE_URL='mongodb://127.0.0.1:27017/medipulse_test?replicaSet=rs0&directConnection=true'
$env:TEST_REDIS_URL='redis://127.0.0.1:6379/15'
node tools/check-implementation-plan.mjs --next
node tools/implementation-inventory.mjs --write
```

For a fresh local Mongo volume, initialize the replica set using the documented local compose initializer first. The review reused the existing local rs0. Integration tests create random disposable synthetic databases and disable outgoing providers/mail.

From backend:

```powershell
npm test
npm run test:integration
node --import ./tests/bootstrap.js --test tests/claim-security-boundary.test.js tests/enterprise-acceptance-boundary.test.js tests/integration/encounter-walkin-claim.test.js
```

The registered integration runner excludes the five enterprise files. The explicit audit command and its **five setup failures** are in ANTIGRAVITY_FINAL_REVIEW.md. Do not claim those passed or skipped merely because the runner is green.

From frontend:

```powershell
npm run test:ui
npm run build
```

From root:

```powershell
node tools/run-browser-checks.mjs --grep 'SOAP draft requires|delayed earlier|queue pause|pausing the hospital|both participants|clinical pages fit'
node tools/run-browser-checks.mjs --grep 'old account responses|record errors are independent|patient routes fit|hospital visit deep links|refreshing a record clears'
```

Run **one browser command at a time**; keep app/spec files unchanged until completion. The runner copies real specs and links the app/dependencies in a private directory outside OneDrive; it uses synthetic local fixtures, never production login. Current targeted results are in the review. The full browser command is available but was not run during this independent review; synthetic media does not certify real cameras/TURN.

Production release still needs the exact deployed pair, approved schema/data inspection, observed delivery/recovery, physical device acceptance and owner sign-off. No production operation occurred in this review.
