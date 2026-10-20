# MediPulse - Antigravity / agent handoff

Updated 21 October 2026. **Do not restart from Gemini's old completion claims.** The full implementation is not finished. AG00 repairs two fresh audit defects and establishes this resumable plan; AG01-AG22 are explicit remaining work, with the enterprise track separated from the outpatient pilot.

## Paste this into Antigravity

```text
Continue the existing MediPulse project. Read AGENTS.md, docs/IMPLEMENTATION_STATUS.md and docs/IMPLEMENTATION_TASKS.json, then the Common instructions in docs/MEDIPULSE_CODEX_PROMPTS.md. Inspect git status and preserve unrelated changes. Use node tools/check-implementation-plan.mjs --next to load only the next task instead of pasting the whole ledger.

Start at the ledger's startWith task, or the first pending task whose dependencies are verified_local. Verify its source evidence; implement the actual backend/persistence/frontend workflow and acceptance checks. Work through dependency-ready tasks, committing and pushing each completed phase to main as Khushal Midha <khushalmidha24@gmail.com>, without Codex coauthors or force push. Do not replace the repository or reimplement completed booking/session/payment/call safeguards.

Use isolated local synthetic databases and the checked-in browser runner. Bind HTTP tests/fixtures to the actual mounts in backend/index.js and the correct account/staff CSRF scope. Do not mark features complete because a route, dashboard or plan exists. Report actual executed checks and unresolved failures.

Preserve every existing patient/payment/history/archive/credential/wallet record. Do not execute production database/index/seed changes, activate a provider, send mail, change DNS or use deployment consoles without the exact separate approval required by Common. Git commit/push authorization is already granted. Labs allow collection before billing; verifier approval must be explicit and the reviewer independent of the result author. Keep clinical outputs draft until qualified version/source-bound review; demo credits remain visibly separate from real money.

After each phase update its ledger status, verification evidence, WORK_LOG and implementation status. If context/credits end, record the precise checkpoint and next command before stopping. Continue toward the complete requested product; do not claim full launch readiness while any required task/acceptance remains open.
```

## Repository and current checkpoint

- Windows workspace parent: `C:\Users\khush\OneDrive\Desktop\MediPulse`. **Actual Git root is its child `MediPulse`**. Run root commands there; backend/frontend commands in the named package directory. Other machines should use their own checkout root.
- Branch: main. Published baseline entering this audit: `565134c2` (hospital pause), preceded by `9c573488` (appointment clinical writes). This handoff and AG00 fixes are in a later commit; use `git log -3` for the current exact hash. Verify working state instead of assuming these historical hashes are HEAD.
- AG00 code/checks are complete locally: real copilot mount/account CSRF, alternate consultation-record CAS/history, accurate implementation status/inventory/ledger and portable browser runner. Next: **AG01**, then AG02-AG04 for the encounter foundation; independent AG10 can be implemented as another bounded phase.
- The ledger has **23 tasks**: AG00 verified locally; AG01-AG16 remaining outpatient/release work; AG17-AG22 enterprise requirements and implementation. Dependencies and acceptance are in JSON, not an inferred percentage.

## Source of truth

1. IMPLEMENTATION_STATUS: honest module-by-module implemented/partial/missing boundaries.
2. IMPLEMENTATION_TASKS: exact ordered work, dependencies, source files and completion criteria.
3. IMPLEMENTATION_INVENTORY: generated navigation map of actual server mounts/routes and frontend paths. Regex extraction is a navigation aid; inspect computed/inline routes manually.
4. WORK_LOG: revision-scoped checks, failures, migrations and publication evidence. Read the relevant recent sections, not the entire repository history on every turn.
5. ASTRA_IMPLEMENTATION_PLAN / ENTERPRISE_PLAN: product direction and expansion requirements; their existence is not evidence of completed code. LAUNCH_REPORT preserves real release gates.

## Reproduce local checks

Prerequisites: installed package dependencies, Docker Desktop running, a local Mongo replica set and Redis; Playwright browser installed. Use the project's lockfiles. Do not run a local application with a production DATABASE_URL or start seed/provider consumers just to get test data.

From repository root in PowerShell:

```powershell
docker compose up -d mongo redis mongo-init
$env:TEST_DATABASE_URL='mongodb://127.0.0.1:27017/medipulse_test?replicaSet=rs0&directConnection=true'
$env:TEST_REDIS_URL='redis://127.0.0.1:6379/15'
node tools/check-implementation-plan.mjs --next
node tools/implementation-inventory.mjs --write
```

From backend:

```powershell
npm test
npm run test:integration
```

For the current clinical contract only, from backend:

```powershell
node --import ./tests/bootstrap.js --test tests/integration/clinical-writes.test.js
```

From frontend:

```powershell
npm run test:ui
npm run build
npx eslint src/components/clinical/ClinicalUI.jsx src/utils/sessionScope.js --max-warnings 0
```

From repository root, the reproducible targeted browser subset:

```powershell
node tools/run-browser-checks.mjs --grep 'SOAP draft requires|delayed earlier'
```

Or `node tools/run-browser-checks.mjs` for the full repository browser suite. The full command is available, **not claimed to have been run during this audit**. Use only one browser suite at a time: fixtures share local ports/state. Keep app/spec source unchanged during a run. The runner copies real specs/support files and links src/node_modules into a fresh private temp directory outside OneDrive, imports the actual repository Playwright config and starts the real frontend/synthetic fixture server. It does not log in to production. Artifacts remain at the printed private path; they are not committed. Chromium is the default; an optional browser-channel override can reproduce the documented Edge synthetic-camera issue, not certify physical-camera behavior.

If services are unavailable, fix the local prerequisite or report the exact blocker; never fall back to a production URI. Integration tests use random disposable local databases and disabled provider/mail configuration. Production migration scripts have a different approval boundary.

## Preserve these known constraints

- Source-bound tenant/department/patient/family/actor authorization, transaction-safe booking/refunds, schema readiness and recovery archives are intentional. Never remove them to make a demo pass.
- /api/copilot uses account-doctor auth; /api/opd-ai uses staff auth. A fixture mounted at an invented alias can hide a real UI failure. AG00 now tests the actual copilot mount and header.
- Both appointment notes and /doctor/appointments/:id/consultation-records must use clinicalWrites. Completed note corrections require a separate reviewed amendment; recommendations cannot fabricate a booked/completed follow-up.
- Encounter transition/handoff/refuse/link-account currently return explicit 503 containment. Replace that only when the corresponding AG02-AG05 identity/revision/proof/recipient checks and UI are complete.
- Lab result workflows and pharmacy fulfillment are repaired, **initial order creation still needs AG06**. Do not mistake transactional dispensing for transactional prescription creation.
- StaffAcceptInvite works; hospital-admin consumeAdminSetupLink does not set a password, and /staff/setup is not implemented. AG10 is real missing work.
- Hospital pause is durable and start-enforced. Priority fields in the old override are not modeled or used in ordering; kiosk still needs service-date/timezone/doctor grouping. AG09 is partial, not complete.
- Use shared neutral/deep-teal tokens, semantic status colors, accessible forms/dialogs and shared doctor-name formatting. Keep zero values and unknown clinical/location states truthful.
- Existing approved demo identities/history are preserved. Any new production graph needs an exact manifest and recovery plan; do not reconstruct or reset owner accounts from chat or commit credentials.
- Live frontend/backend parity, actual mail and physical-device/cross-network TURN acceptance remain external checks. Public liveness or an old frontend build is not proof that an authenticated clinical flow works.

## End-of-phase / interruption checkpoint

Record task ID, base/current commit, changed files, invariant/decision, exact completed checks and failures, local-only migration needs, outstanding approval if any, and the next safe command. Update the task status and evidence, commit/push authorized code, and preserve a dirty-worktree note if interruption prevented publication. Never mark a task complete solely to clear the pending list.
