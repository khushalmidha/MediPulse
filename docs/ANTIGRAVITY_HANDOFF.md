# MediPulse - current handoff after AG22 review

Updated 22 October 2026. Latest reviewed Antigravity checkpoint: **32c85bde**; prior published review was 72635cd0. Read [AG22_VERIFICATION_REVIEW.md](AG22_VERIFICATION_REVIEW.md) first. The enterprise APIs/UI and repaired fixtures now exist; earlier absent-route/failing-fixture statements describe older revisions. Their existence still does not complete the clinical/financial/external adapter requirements.

Keep **ENTERPRISE_PILOT_ENABLED=false** in production. Newly mounted enterprise services default off outside tests pending the documented access/policy/reconciliation work. Existing outpatient services are unchanged. Claim delivery is also unimplemented in real runtime; do not remove its containment or assume credentials activate the stub.

## Paste into Antigravity

```text
Read AGENTS.md, docs/AG22_VERIFICATION_REVIEW.md, docs/ANTIGRAVITY_COMPLETION_PLAN.md, docs/IMPLEMENTATION_STATUS.md and Common in docs/MEDIPULSE_CODEX_PROMPTS.md. Continue from the current main checkout, preserving unrelated edits. Run node tools/check-implementation-plan.mjs --next; start with AG05 and the plan's section 3, verifying current code rather than repeating completed work.

Implement one dependency-ready package through actual service/API/persistence/UI and meaningful local checks. Follow sections 4-7 until the requested scope is genuinely complete. Keep walk-in containment and enterprise prototypes closed until their real prerequisites/evidence exist. If an external contract/approval is missing, record the exact blocker and continue independent permitted local work; do not fabricate provider, clinical or production acceptance.

Use isolated synthetic databases, the real route mounts/session scopes and the portable browser runner. Update the ledger/status/work log after each phase and commit/push main as Khushal Midha <khushalmidha24@gmail.com>, no Codex coauthor or force push. Existing Git authorization applies; production/provider/DNS/mail/deployment-console operations retain Common's separate exact approval. If using Astra, Medium only. Keep final updates concise and leave an exact continuation checkpoint if interrupted.
```

## Checkpoint and evidence

- Actual Git root is the workspace's child `MediPulse`; root commands run there. Use `git log -3` for the published review commit and `git status --short` before editing.
- Ledger: 23 tasks; **15 retain verified_local evidence, AG05/AG17 pending, AG16/AG18-AG22 implemented_pending_final_checks**. Actual remaining requirements are in the ledger and latest review.
- QR replacement passed independent decoding; claim containment, family binding, stale packet/clinical read cleanup and truthful enterprise/tenant export metadata are recorded in the final review.
- IMPLEMENTATION_INVENTORY includes the newly mounted enterprise routers and pages. Regex output is navigation only; inspect the real backend/index.js mounts and frontend/App.jsx.
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

The registered integration runner now includes the five repaired enterprise files. Current observed results and follow-up regressions are in AG22_VERIFICATION_REVIEW.md; older fixture failures are historical.

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
