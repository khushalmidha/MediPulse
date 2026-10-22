# MediPulse - bounded final wrap-up handoff

Latest verification: **23 October 2026**, application source 74c5243f plus two test-only corrections: all 35 registered integration files now **377/377 passed** against real local Mongo/Redis; critical browsers **59 passed / 1 redundant skip**. The earlier missing-daemon integration omission is resolved. See implementation status/launch report for exact evidence; enterprise remains incomplete/disabled and production account/device acceptance is separate.

Updated **23 October 2026**, after source inspection of **780bdd07**. Immediate scope: finalize the existing demo candidate quickly. The full [completion plan](ANTIGRAVITY_COMPLETION_PLAN.md) remains in place for uncompleted product requirements; this handoff does not silently remove them or claim the product production-ready.

Read [current implementation status](IMPLEMENTATION_STATUS.md) before historical reviews. AG00-AG15 retain existing local evidence; AG16-AG22 are reopened for incomplete package/upstream acceptance, with source-specific notes in the ledger. Eleven detailed checklist exits remain unverified. Keep enterprise default off; actual claim adapters now exist, so the older statement that claim delivery has only a runtime stub is superseded. Provider activation/observed delivery still needs its own evidence.

## Paste into Antigravity

```text
Perform one bounded finalization pass for the existing MediPulse demo candidate. Read AGENTS.md, current docs/IMPLEMENTATION_STATUS.md, docs/IMPLEMENTATION_TASKS.json, docs/LAUNCH_REPORT.md and Common in docs/MEDIPULSE_CODEX_PROMPTS.md. Verify current main; preserve later/unrelated edits. Use the existing completion plan for context; do not generate another master plan or add features.

Exercise patient/family booking, doctor consultation/call/fullscreen/reconnect, hospital queue/room/file guidance, released lab/pharmacy records, Connect and account/role-switch behavior using isolated connected fixtures. Fix only reproduced release-blocking regressions. Run backend units and the full registered integrations with isolated replica-set/Redis, frontend units/lint/build, the full portable browser suite and fresh dependency audits on the exact final candidate. Use one browser runner at a time; no source/spec edits during a run. Investigate required skips; never count missing services or skipped integration files as passes. Record exact commands, revision, results and omissions.

Keep ENTERPRISE_PILOT_ENABLED=false in production. Do not mark metadata/configuration or containment as implemented LIS processing, authenticated witness, PACS viewing, SSO/SCIM or observed recovery. Preserve incomplete enterprise checklist entries and the full roadmap; local checks cannot replace provider/hospital/production acceptance. Correct any remaining unsupported completion or clinical-policy approval claims, preserving historical evidence.

Update WORK_LOG, ledger, implementation status and launch report to one truthful verdict: verified demo candidate or exact release blockers. Leave one combined external-action list for deployed revision/schema, actual delivery/payments, physical devices/TURN, restore and owner acceptance as applicable. Commit/push ordinary changes to main as Khushal Midha <khushalmidha24@gmail.com>, no Codex coauthor/force push; existing authorization applies. Production DB/index/demo changes, providers/real delivery, DNS and deployment-console execution require Common's exact approval. Use no production secrets/data in tests; Astra, if selected, Medium only. Finish with a concise scope/verification/blockers report, not a new plan.
```

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

The registered integration runner now includes the five repaired enterprise files. Historical independent results and follow-up regressions are in AG22_VERIFICATION_REVIEW.md; reproduce checks on the current candidate.

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

Run **one browser command at a time**; keep app/spec files unchanged until completion. The runner copies real specs and links the app/dependencies in a private directory outside OneDrive; it uses synthetic local fixtures, never production login. The prior independent targeted results are historical. Antigravity later reported a full browser run; this wrap-up still requires exact-candidate evidence. Synthetic media does not certify real cameras/TURN.

Production release still needs the exact deployed pair, approved schema/data inspection, observed delivery/recovery, physical device acceptance and owner sign-off. No production operation occurred in this review.
