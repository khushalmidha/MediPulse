# P03 queue migration and release notes

The deployed site and existing local Docker containers have not been migrated or replaced by this task. P03 code requires the new indexes and migrated queue metadata before startup. `autoIndex` is disabled for queue models, so application startup cannot silently change these indexes.

## Existing data

1. Stop every API/consumer/other writer that can modify visits, refunds or queue counters. Take the normal database backup. Review timezone/session configuration first: hospital `settings.timezone`/`settings.queueSessionIds` and independent doctor `queueTimezone`/`queueSessionIds`. Defaults are `Asia/Kolkata` and `day`; these are care sessions, not selectable appointment slots.
2. Supply an explicit approved `DATABASE_URL` through the environment. The migration script does not load `.env` and does not print the URI or patient records. Run `node scripts/migrateQueues.js --dry-run` from `backend`.
3. Resolve reported issues privately with clinical/operational review: duplicate numbers within a doctor/session, duplicate live patient/family bookings, competing active consultations, missing doctor/department/patient/family references, hospital appointments without a token, and linked state/identity mismatches. The script reports counts by issue, refuses writes when any issue remains, and never chooses a visit to delete or silently renumbers tokens.
4. With writers still stopped and dry-run clear, an authorized operator sets `QUEUE_MIGRATION_APPROVED=true` and `QUEUE_WRITES_PAUSED=true`, then runs `node scripts/migrateQueues.js --apply`. Production execution requires separate authorization; none was performed for this task.
5. Keep the printed recovery run ID privately. Verify the new indexes, restart matching API/frontend/worker versions and check readiness. Do not restart the old writer version after migration: it lacks the new queue metadata and transition rules.

The script creates private in-database snapshots of queue records and index definitions under `p03_backup_<run>_*`, then backfills explicit queue/date/session/timezone/patient identity and linked token references. Legacy dates are interpreted using the hospital timezone. Existing arrival timestamps are retained because the original code did not reliably distinguish physical arrival; audit that historical ambiguity separately. Records still waiting without arrival become reservations. No token number or existing clinical note is rewritten. Counters are rebuilt to at least the highest persisted number; unused historical counter rows are retained. New indexes replace only the known legacy constraints that conflict with the new boundary.

Already assigned queue dates, timezones, sessions and walk-in identities are preserved on reinspection, including after configuration changes. Inconsistent existing metadata or linked token references require review rather than silent reassignment.

DDL/data backfill is not one Mongo transaction. If a migration is interrupted, keep writers stopped and use the regular database backup/private recovery snapshots to inspect the incomplete run; do not relaunch or blindly rerun it. The migration record tracks applying/completed state. Backup collections contain private clinical data and need the same access/retention controls as the original database.

## Recovery

With writers stopped, the same approval/paused flags and explicit database target, run `node scripts/migrateQueues.js --rollback <run-id>`. Automatic recovery is allowed only for a completed migration whose queue collections exactly match its post-migration fingerprints. It restores the original rows and index definitions and refuses if visits, notes, requests or counters have changed. After any later write, use a reviewed recovery/data merge rather than discarding new clinical activity. Incomplete runs require backup-based recovery. Rollback was rehearsed on a populated synthetic database; no production recovery was executed.

## Fresh local setup

Compose now has a one-shot `queue-init` service after Mongo replica-set initialization. It prepares indexes only for empty local queue collections and refuses when an existing API is running and changes are needed. A current schema is a no-op. Nonempty legacy data requires the reviewed procedure above. The production override excludes this local initializer.

For an existing P02 local stack with empty queues:

```sh
docker compose stop backend vpay-consumer
docker compose up -d --build
```

Stopping retains all volumes. If initialization refuses because there are records, perform a reviewed local migration with writers stopped; do not delete volumes to bypass the refusal. For host development, build/run `queue-init` after `mongo-init` and before starting API/consumer: `docker compose build queue-init` then `docker compose run --rm queue-init`.

## API/client changes

- Existing paths/IDs and success envelopes remain. Booking POSTs accept `Idempotency-Key` (8–128 ASCII letters/digits/`.`/`_`/`:`/`-`) or `requestId`. The supplied key belongs to actor and endpoint; changing input with the same key returns 409. Legacy patient clients without a key use one implicit key per patient/queue/date; use an explicit fresh key for an intentional repeat visit after a terminal visit. Assisted bookings require a key (428 without one).
- A completed retry returns 200 with `replay: true`. Interrupted/in-progress bookings return 202 with `operationId`; retry the original key. They do not start another debit. Failed attempts replay their failure; the UI clears the key after a definitive payment rejection so a new intentional attempt is possible.
- New visit records expose `queueKey`, `practiceKey`, `serviceDate`, `sessionId`, `timezone`, `visitMode` and `revision`. Body `revision` is optional for older clients; current staff/doctor controls send it. Stale/conflicting transitions return 409. Queue reads use authoritative Mongo rows; writes commit before optional cache/socket/mail work.
- Hospital patient bookings are `reserved` with no `arrivedAt`. Staff confirms physical arrival using `PATCH /api/opd/tokens/:tokenId/check-in`; only then do they enter `waiting`/vitals/consultation queues. Assisted walk-in issuance is check-in. Staff queue responses add `reservations` and configured `sessionIds`; appointment workspace adds separate queue choices.
- Hospital visits are `in_person`; linked appointments represent the same encounter, not a video visit. Video rooms are restricted to independent online visits. P06 supersedes the earlier five-minute timer with manual completion by default and persisted configurable online deadlines; see `P06_DURABLE_WORKFLOWS.md`. Direct independent appointment booking accepts platform doctor IDs; hospital staff IDs must use the hospital OPD endpoint. The hospital profile CTA now points to the existing `/hospitals/:slug` route.
- Live patient uniqueness includes owned family member and session; walk-ins use actor/request identity. Multiple departments share the same doctor's hospital session sequence. Starts obey that session's queue order; terminal visits cannot reopen through vitals, no-show, start or completion.

## P04/P06 follow-up boundaries

The booking operation persists reservation/payment references and holds ambiguous operations for reconciliation. P04 must implement interrupted-operation recovery, fully atomic ledger/booking accounting and cumulative refund correctness. Refunds for queued care first acquire `refund_pending` atomically to prevent a simultaneous consultation start. Paid no-shows/already cancelled visits use a separate refund-processing marker while keeping their clinical status terminal. A failed/interrupted refund keeps that hold for reviewed reconciliation; it is not automatically re-queued or retried with a second refund key. No claim is made that all wallet crash windows are fixed.

P06 must implement durable notification/cache retries, cross-process/restart consultation deadlines and other outbox guarantees. New optional delivery failures do not reverse a committed visit. Slot scheduling, department priority overrides, ETA estimation and full product redesign remain their later tasks.

Database reference used during review: [MongoDB JSON schema behavior](https://www.mongodb.com/docs/manual/reference/operator/query/jsonschema/). P03 uses explicit queue metadata, partial unique indexes and conditional transactions; no collection JSON-schema validator was installed.
