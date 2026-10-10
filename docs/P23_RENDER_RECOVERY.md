# Render startup and imported database recovery — 10 October 2026

## Verified evidence

The supplied Render log for a88b38fa shows a successful build followed by a DATABASE_URL validation failure. The port warning follows that failure. Recent commits 0748f1fc and a6ca21d8 add URI/key compatibility and start through schema warnings; both are retained in history.

The owner selected the medipulse database and imported the former test data. A read-only comparison verified **46 collections / 781 documents / 164 indexes** in each database. Canonical Extended JSON fingerprints match for all 46 collections, including IDs and BSON types. No repeated copy or production database write was necessary. A complete Extended JSON snapshot of medipulse, including collection options, indexes and documents, is held in the current account's private LocalAppData MediPulse backup folder outside the repository and OneDrive. Its Windows ACL is restricted to the current account. Do not commit this backup or send its contents.

## Legacy-data blockers

Read-only schema and migration inspection found:

| Check | Result |
|---|---|
| Auth, durable jobs and scheduling indexes | Ready |
| Queue schema/data | Migration required |
| Ledger schema/data | Migration required |
| Unresolvable token context | 10 records: 3 completed, 3 waiting, 2 vitals_done, 1 in_consultation, 1 no_show |
| Unresolvable appointment context | 26 records: 17 completed, 2 cancelled, 1 pending_approval, 6 queued |
| Hospital appointments without linked tokens | 8 records: 5 completed, 3 cancelled |
| Linked state mismatch | 2 waiting tokens linked to cancelled appointments |
| Invalid refund link | 1 record marked COMPLETED |
| Invalid appointment payment | 1 completed appointment |

Counts can overlap across checks. Missing references are not replaced with invented patients, doctors, tokens or transfers. The owner initially selected real history/preservation, then clarified that the records are **synthetic but realistic, for pitches**, with no earlier source available. Initial inspection and rehearsal performed no production mutations. The subsequent approved execution is recorded below; full originals remain preserved.

## Code recovery

Runtime preserves the recent URI whitespace/quoted-assignment and MONGODB_URI compatibility. For a URI with an omitted database path, only API/consumer runtime validation selects the owner-approved medipulse name. Existing explicit database paths remain unchanged. Migration utilities still require an explicit database target. Standard credentialed MongoDB URIs retain their prior admin authentication source when adding that omitted database path. No cluster-specific hostname is embedded in this recovery. Missing and malformed configuration produce distinct errors without printing the URI.

Startup checks schemas through read-only inspections. Mongo connection autoIndex and autoCreate are disabled; startup no longer creates indexes opportunistically or swallows migration failures. If the database connection is available but schema/dependency readiness fails, the HTTP server exposes /health/live (200), /health/ready reports 503 with aggregate schema/dependency states, and care requests return SERVICE_NOT_READY (503). Socket operations and financial, scheduling, refund, review and outbox workers start only when readiness passes. Restart after approved migrations so the API and workers share the same verified schema.

## Render configuration and completion

Use Render's Environment tab to set DATABASE_URL (or MONGODB_URI) privately with an explicit **/medipulse** path before the query options; retain the existing credentials, host and authentication source. No secret values belong in render.yaml or a commit. Existing explicit /test configuration is preserved by code, so the operator must change that explicit path to complete the cutover. Render account/environment access is not available in this workspace. [Render's environment-variable documentation](https://render.com/docs/configure-environment-variables) describes Save and deploy versus Save, rebuild, and deploy. [MongoDB authentication options](https://www.mongodb.com/docs/manual/reference/connection-string-options/#authentication-options) explain authSource independently of the application database.

The initial safety gate did not claim the imported database was operationally migrated. Approved preservation and P03/P04/P07 execution now pass database readiness; live deployment verification follows below. Existing recovery procedures and writer-pausing requirements remain in P03_MIGRATION.md, P04_MIGRATION.md and P07_PRODUCTS.md. Do not rerun an import over a migrated database: the unchanged test copy is historical source evidence, not an ongoing synchronization target.

### Individual repair evidence if real records are introduced

Use original hospital records, prior backups and payment-ledger evidence to recover the missing patient/doctor/family identities and original links. Review cancelled appointments linked to waiting tokens with the responsible operator; do not infer that a cancellation should be reversed. Reconcile the completed refund with its actual committed transfer, and the completed appointment with its original payment. Record each proposed correction and its source privately, with before/after fingerprints and clinician/operator review where applicable. Do not put identifiers or clinical/payment details in Git. The verified import does not contain the missing references, so repeating the same import cannot repair them. Run the migration dry runs again after reviewed corrections; apply only when they report no unresolved issues and all writers are demonstrably paused.

The competitor-informed UI is published separately as 76ee0658 and was rendered on both www.medipulse.live and medi-pulse-gamma.vercel.app, with the expected build-revision meta tag. UI publication does not prove database migration readiness.

## Published recovery and rehearsed synthetic-data plan

Recovery commit **ac55d1b0**, authored and committed by Khushal Midha directly on main, is deployed. Both frontend domains report that revision. The direct Render API and company backend proxy return liveness 200; readiness 503 reports queue/ledger migration-required and auth/durable/scheduling ready. A read-only care request returns SERVICE_NOT_READY, no-store and Retry-After 60. These are observed live responses, not inferred deployment success. The current Render database name cannot be confirmed from public health responses or changed without provider access.

The maintenance utility `backend/scripts/recoverDemoData.js` defaults to an aggregate-only dry run. Its plan preserves full BSON originals with fingerprints in `p23_preserved_demo_records`, with a transactional run manifest in `p23_demo_recovery_runs`. It moves connected broken visits together rather than inventing identities or reversing cancellations. Unrecognized issue types, changed data, an unmatched backup or missing approval stop the operation. Archives have no application API route; keep database access restricted.

The isolated rehearsal of the private 781-document snapshot produced this bounded plan:

| Collection | Originals preserved outside active collections | Valid records retained |
|---|---:|---:|
| OPD tokens | 12 | 6 |
| Appointments | 36 | 28 |
| Refund records | 1 | 14 |
| Wallets | 0 | 80 |
| Transfers | 0 | 68 |

All **49** original moved records match their BSON-aware canonical hashes. The source test database and private full backup remain untouched. Queue/ledger dry runs then report zero issues; P03/P04/P07 succeed and all five schema checks become ready. Rollback of P07, P04 and P03 followed by original-record restoration reproduces every source document across all 46 collections. No provider clients, mail delivery or production-connected API workers are started by rehearsal.

### Execution and recovery boundary

The prompt pack's **Common instructions require separate authorization for production data execution**. The owner explicitly approved this exact plan and confirmed no separate consumers or scripts were writing. The live API maintenance gate was also verified before execution. Future operations still require an unchanged private backup, reviewed plan and paused writers; do not treat this completed execution as approval to change additional records.

Using privately supplied explicit DATABASE_URL, apply requires DEMO_RECOVERY_APPROVED=true and `node scripts/recoverDemoData.js --apply --synthetic-data --writers-paused --backup <private-full-backup>`. Then apply P03 and P04 with their reviewed migration/writer flags and private recovery IDs; inspect/apply P07 with its private backup and paused-writer flag. Verify schema readiness before restarting Render. If Render is still explicitly targeting test, change its environment to medipulse before restart; do not migrate the historical test source to make a misconfigured service ready.

For recovery, stop writers; roll back P07, P04 and P03 in that order using their recorded private plans/run IDs. Then `node scripts/recoverDemoData.js --restore <preservation-run-id> --synthetic-data --writers-paused` with DEMO_RECOVERY_APPROVED=true restores originals transactionally. Changed collection fingerprints or damaged/incomplete originals refuse restoration. Recovery archives remain available after restoration. Keep full private backup evidence; do not restore over subsequent clinical or financial activity.

## Approved production execution — 10 October 2026

Revalidated the explicit **medipulse** target, unchanged full private backup and exact previously reviewed 49-record plan. API readiness was 503 with failed queue/ledger schemas; the owner confirmed no other writers. The guarded CLI preserved all 49 originals transactionally and verified every archived record's BSON-aware fingerprint. P03 and P04 then completed from zero-issue dry runs. P07 inspection found zero changes/issues/warnings; its private plan was saved and its schema initialization completed. No DNS, domain ownership or provider configuration was changed.

Final production database checks pass:

- Queue, ledger, auth, durable-job and scheduling assertions: **all ready**.
- Queue dry run: **6 tokens / 28 appointments / zero issues**.
- Ledger dry run: **80 wallets / 68 transfers / 14 refunds / 28 appointments / zero issues**.
- All original archived records match their saved fingerprints.
- All wallet owners/roles and original balance, total-sent and total-received amounts match the approved snapshot after exact minor-unit conversion; transfer IDs, actors, roles, amounts, types and related/reference identities are preserved.
- The historical **test** database's complete document/index/options fingerprint is unchanged across execution. The original private backup was read only.

Private production checkpoints include preservation and P03/P04 recovery IDs plus the P07 rollback plan, outside Git/OneDrive in the restricted backup folder. No credentials, record identifiers or patient/payment contents are included here. Publication of this result triggers the authorized main-branch deployment so startup can recheck the migrated database; live readiness is checked separately rather than inferred from database success.
