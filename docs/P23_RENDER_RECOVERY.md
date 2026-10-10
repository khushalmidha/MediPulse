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

Counts can overlap across checks. Missing references are not replaced with invented patients, doctors, tokens or transfers. No balance, consultation status or record has been changed by this inspection. **The owner confirmed this is real patient/payment history and instructed preservation for reviewed repair.** No archive, deletion, status correction, balance adjustment or production migration was performed.

## Code recovery

Runtime preserves the recent URI whitespace/quoted-assignment and MONGODB_URI compatibility. For a URI with an omitted database path, only API/consumer runtime validation selects the owner-approved medipulse name. Existing explicit database paths remain unchanged. Migration utilities still require an explicit database target. Standard credentialed MongoDB URIs retain their prior admin authentication source when adding that omitted database path. No cluster-specific hostname is embedded in this recovery. Missing and malformed configuration produce distinct errors without printing the URI.

Startup checks schemas through read-only inspections. Mongo connection autoIndex and autoCreate are disabled; startup no longer creates indexes opportunistically or swallows migration failures. If the database connection is available but schema/dependency readiness fails, the HTTP server exposes /health/live (200), /health/ready reports 503 with aggregate schema/dependency states, and care requests return SERVICE_NOT_READY (503). Socket operations and financial, scheduling, refund, review and outbox workers start only when readiness passes. Restart after approved migrations so the API and workers share the same verified schema.

## Render configuration and completion

Use Render's Environment tab to set DATABASE_URL (or MONGODB_URI) privately with an explicit **/medipulse** path before the query options; retain the existing credentials, host and authentication source. No secret values belong in render.yaml or a commit. Existing explicit /test configuration is preserved by code, so the operator must change that explicit path to complete the cutover. Render account/environment access is not available in this workspace. [Render's environment-variable documentation](https://render.com/docs/configure-environment-variables) describes Save and deploy versus Save, rebuild, and deploy. [MongoDB authentication options](https://www.mongodb.com/docs/manual/reference/connection-string-options/#authentication-options) explain authSource independently of the application database.

The current safety gate intentionally does not claim the imported database is operationally migrated. Complete the reviewed legacy repair, then P03/P04 migrations, followed by product context initialization and schema/readiness verification. Existing recovery procedures and writer-pausing requirements remain in P03_MIGRATION.md, P04_MIGRATION.md and P07_PRODUCTS.md. Do not rerun an import over a migrated database: the unchanged test copy is historical source evidence, not an ongoing synchronization target.

### Required individual repair evidence

Use original hospital records, prior backups and payment-ledger evidence to recover the missing patient/doctor/family identities and original links. Review cancelled appointments linked to waiting tokens with the responsible operator; do not infer that a cancellation should be reversed. Reconcile the completed refund with its actual committed transfer, and the completed appointment with its original payment. Record each proposed correction and its source privately, with before/after fingerprints and clinician/operator review where applicable. Do not put identifiers or clinical/payment details in Git. The verified import does not contain the missing references, so repeating the same import cannot repair them. Run the migration dry runs again after reviewed corrections; apply only when they report no unresolved issues and all writers are demonstrably paused.

The competitor-informed UI is published separately as 76ee0658 and was rendered on both www.medipulse.live and medi-pulse-gamma.vercel.app, with the expected build-revision meta tag. UI publication does not prove database migration readiness.
