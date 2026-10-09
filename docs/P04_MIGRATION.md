# P04 demo ledger migration and recovery

P04 moves demo credit accounting to integer hundredths and commits booking/payment/refund records together. This task has not migrated production or the existing local P02 containers. Real payment collection remains disabled.

## Rollout with existing data

1. Stop all API, consumer, refund and other financial/visit writers. Take the normal database backup. Complete the reviewed P03 queue migration first; keep writers paused between migrations.
2. From `backend`, supply an explicit approved `DATABASE_URL` through the environment and run `node scripts/migrateMoney.js --dry-run`. The script does not load deployment `.env` or print records/connection strings.
3. Resolve reported counts privately: invalid precision/units, duplicate wallet/reference/refund identities, unmatched refund transfers, excess refund totals, inconsistent integer accounting, and incorrect appointment payment references. No duplicate financial record is deleted automatically.
4. An authorized operator sets `MONEY_MIGRATION_APPROVED=true` and `MONEY_WRITES_PAUSED=true`, then runs `node scripts/migrateMoney.js --apply`. Production execution requires separate authorization. Automatic approval exemption is limited to credential-free localhost `medipulse_test*` targets.
5. Preserve the recovery run ID privately. Verify queue and ledger readiness, then restart matching P04 API/worker/frontend versions. Do not run old financial writers after migration.

Private `p04_backup_<run>_*` collections preserve original wallet, transaction, refund and appointment rows/indexes. Migration normalizes major-unit display fields and adds integer fields; it does not move wallet funds. Cumulative refunds derive from committed, direction-checked refund transfers. A historical refund incorrectly marked failed is completed only when its matching successful transfer is verified. Uncommitted legacy refund records remain failed and require a reviewed retry. Historical wallets lacking credit provenance are marked credited to prevent silently granting a new starting balance.

Data/index backfill is not one transaction. Interrupted runs remain `applying`: keep writers stopped and recover from the regular backup/private snapshots. For a completed run with no subsequent changes, `node scripts/migrateMoney.js --rollback <run-id>` restores original rows and indexes using the same approval/paused flags. Fingerprints refuse automatic rollback after later financial or appointment writes. Rehearsals used isolated synthetic databases only.

## Fresh local setup

The existing local `queue-init` now also initializes empty demo-ledger collections. It refuses nonempty legacy data or a reachable writer when schema changes are needed. Existing P02 data requires reviewed migrations; retain Docker volumes. Existing containers still use their previous images until explicitly rebuilt/restarted.

## Runtime and API behavior

- `balanceMinor`, `amountMinor`, totals and `refundedMinor` use integer hundredths of **demo INR credits**. Existing numeric major-unit response fields remain. Requests accept positive values with at most two decimals; zero, invalid precision and unsupported units are rejected.
- Payment/top-up/refund HTTP actions accept `Idempotency-Key`, legacy `x-idempotency-key`, or `requestId`. Keys persist in Mongo through transaction references/refund records and are scoped by actor and action. Changed successful request input conflicts; matching retries replay, including fully refunded originals. Completed operations do not expire with Redis.
- New bookings commit visit records, wallet movement, ledger/notification records and operation completion in one Mongo transaction. First sequence allocation remains outside it; gaps are permitted. A lost commit acknowledgement is resolved from persisted state. Optional post-commit delivery failure cannot reverse financial success; wallet dashboards read authoritative records.
- Appointment cancellation uses one refund identity across patient/doctor/manual/automatic/recovery paths, with linked clinical changes and refund accounting in the same transaction. Generic `/vpay/refund` cannot bypass appointment eligibility; use its cancellation endpoint. Empty generic refund amount means **remaining refundable balance**.
- Booking and demo top-up/refund pages preserve keys after network/uncertain errors and reload. Definitive rejection permits a new attempt; confirmed success clears the key. No raw form/clinical input is stored by the key helper.

## Recovery and limits

The API runs a bounded recovery pass at startup and every 30 seconds. Mongo transactions arbitrate concurrent workers; no Redis financial lock/lease is needed. New booking intents contain private recovery data and fixed resource IDs. Legacy provisional visits with a verified committed debit finalize without another debit; financial holds with a verified completed refund cancel without another refund. Expired incomplete intents never charge; existing debits are refunded before recording completed compensation. Insufficient merchant funds or unknown outcomes stay pending with retry backoff. Missing/inconsistent legacy references become `review_required`; operator correction is required. Records are retained, including terminal failures and compensation status.

P06 still owns durable event/cache/mail delivery and consultation/refund scheduling across restarts. Recovery scans persisted unfinished operations/holds; it does not reconstruct an auto-refund schedule lost from Redis or guarantee notification delivery. Provider activation, real-money settlement, dependency upgrades and historical records requiring human review remain separate work. `paymentGateway.js` exposes only the demo adapter and rejects real collection.
