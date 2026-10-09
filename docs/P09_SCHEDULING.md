# P09 — Appointment scheduling contract

## Invariants and defaults

- Explicit types: `scheduled_online` (an online time slot), `online_opd` (a capacity window, not a promised consultation time), and `hospital_in_person` (an in-person slot). Existing current-day queue endpoints remain available. Legacy online records without a type are presented as online OPD; their original queue identity is preserved.
- Each configured session has its own practice, doctor, service date, timezone and `s_<session ObjectId>` queue session ID. Hospital sessions use the staff doctor for the queue and the linked doctor account for identity/payment. An active hospital, active department and accepted active doctor membership are required. Independent practice does not require hospital employment.
- A doctor's dated sessions cannot overlap across independent practice or hospitals. Mongo transaction writes to a canonical doctor lock serialize schedule creation, holds, confirmation, leave, rescheduling and admission across API processes. Patient/family locks also fence overlapping holds. One live booking per patient/family per queue session remains the P03 invariant.
- Slots exist only after authorized session configuration. Scheduled slots default to 15 minutes, capacity 1; duration is bounded to 5–120 minutes and capacity to 1–100. Breaks remove intersecting slots. Online OPD has one actual window/capacity; split windows around breaks. Pausing a session does not discard its existing reservations or allow another overlapping session to be created.
- Timestamps require explicit ISO offsets. The configured practice timezone determines the service date. Sessions are bounded to 12 hours and one local calendar day; split at local midnight. Offset-aware instants support daylight-saving transitions. The configuration horizon is at most 366 days; availability requests span at most 31 days.
- Holds reserve capacity without taking credits. Default expiry is five minutes (configurable 1–15), bounded by the slot start or online OPD window end. Expiry releases capacity transactionally. The worker retries every 30 seconds; booking/availability also recover expired holds. Records are retained for audit/replay rather than deleted by TTL.
- Confirmation atomically writes appointment/token, frozen fee, demo-credit transfer, reservation and request identity. A failed write rolls back all financial/resource writes. Insufficient funds retain the hold until expiry. Completed request retries return the existing reservation; an expired key cannot reserve a new slot. Fees are frozen when the hold is created.
- Scheduled appointments keep the legacy `queued` storage status and add `admissionState="reserved"`. They are excluded from the ready queue until check-in and their actual start/window. Hospital tokens remain `reserved` until authorized staff confirm arrival. Patient requests cannot assert physical hospital arrival.
- Online patient check-in and hospital staff arrival default to 15 minutes before the slot until 30 minutes after its start; online OPD check-in lasts through its window plus the configured grace. Consultation cannot start before its real slot or after the session grace, without arrival, or while the doctor/practice is unavailable. Existing single-active-consultation and queue-order constraints remain authoritative.
- Default cancellation/rescheduling is allowed strictly before the reserved start, configurable with earlier cutoffs. Provider absence/pause/revocation permits cancellation or eligible rescheduling after the cutoff. Cancellation before care starts returns the full demo payment and releases capacity atomically; legacy refund requests use the same policy and accounting hook. Active/completed visits cannot be refunded by this flow. A missed-turn/no-show retains the existing refund workflow; it is not an automatic money refund.
- Rescheduling requires an unarrived confirmed reservation, current revision, same doctor/practice/department/type and identical frozen fee. It moves appointment/token queue metadata and slot capacity in one transaction, retaining the payment identity. A full target or stale revision leaves the source unchanged. To change provider, practice, fee or modality, cancel under the applicable policy and make a new booking.
- Future reservations have no immediate-queue refund timer. Online arrival starts the existing missed-response refund deadline, no earlier than the reserved start. Consultation completion/no-show/cancellation synchronize reservation state and release capacity through the shared visit transition service.

Doctor account leave applies across that doctor's practices. Hospital administrators can pause only their hospital sessions; they cannot create global leave for an independent practice. Leave/pause prevents new bookings and admission. Existing paid reservations stay visible with a reschedule/cancel next step; this batch does not silently cancel or email every affected patient. Bulk leave notifications and appointment UI are later work.

## API for P10

Base: `/api/scheduling`. Existing session cookies, Origin and CSRF protections apply to authenticated writes. Patient writes require a stable `Idempotency-Key` (8–128 letters/digits or `._:-`); use a new key only for a new intent. Rescheduling also requires the current reservation `revision`.

| Method/path | Caller | Result |
|---|---|---|
| `GET /availability?doctorId=...&from=YYYY-MM-DD&to=YYYY-MM-DD` | Public | Real independent sessions/slots, remaining capacity, timezone, fees, policy and freshness. Empty until configured. |
| `GET /availability?hospitalId=...&departmentId=...&doctorId=...&from=...&to=...` | Public | Only that hospital/department/staff doctor's configured availability. |
| `POST /sessions` / `PATCH /sessions/:sessionId` | Independent doctor | Create dated availability / set `state` to open or paused. |
| `POST /hospital/sessions` / `PATCH /hospital/sessions/:sessionId` | Assigned staff doctor or same-hospital administrator | Configure/pause hospital availability. |
| `POST /absences` / `DELETE /absences/:absenceId` | Doctor account | Set/revoke cross-practice leave. |
| `POST /holds` | Patient | Hold actual `slotId`; optionally select an owned `familyMemberId`. |
| `POST /reservations/:reservationId/confirm` | Owner patient | Confirm an unexpired hold and settle demo credits atomically. |
| `GET /reservations?limit=20` / `GET /reservations/:reservationId` | Owner patient | Up to 50 recent visits / full confirmation and tracking envelope. Removed family ownership is not disclosed. |
| `POST /reservations/:reservationId/cancel` | Owner patient | Policy-bound cancellation/full demo refund. |
| `POST /reservations/:reservationId/reschedule` | Owner patient | `{ "slotId": "...", "revision": 1 }`; atomic move with no second charge. |
| `POST /reservations/:reservationId/check-in` | Owner patient | Online arrival within the configured window. |
| Existing `PATCH /api/opd/tokens/:tokenId/check-in` | Authorized hospital staff | Physical arrival; updates the linked appointment too. |

Session example (IDs are placeholders; dates must be future dates in the configured practice timezone):

```json
{
  "doctorId": "<doctor-account-id>",
  "appointmentType": "scheduled_online",
  "startsAt": "2026-10-20T09:00:00+05:30",
  "endsAt": "2026-10-20T11:00:00+05:30",
  "slotMinutes": 15,
  "capacity": 1,
  "breaks": [{"startsAt":"2026-10-20T10:00:00+05:30","endsAt":"2026-10-20T10:15:00+05:30"}],
  "policy": {"holdMinutes":5,"cancelBeforeMinutes":60,"rescheduleBeforeMinutes":60}
}
```

Hospital configuration supplies `hospitalId`, `departmentId`, a staff doctor ID and `appointmentType="hospital_in_person"`. Fee/timezone come from the actual practice, not caller overrides. Session management is configuration; if an ambiguous create response is retried, the overlap guard prevents duplicate sessions. Patient intent operations have explicit replay identities.

Hold example: `{"slotId":"<returned-slot-id>","familyMemberId":"<owned-family-member-id>"}`; omit familyMemberId for self. Confirmation/cancellation/check-in need no caller-supplied price, doctor or arrival fields. Rescheduling returns the same appointment identity with a higher revision and new actual queue metadata.

Confirmation/tracking includes reservation state/revision/expiry, actual start/end, fee with `demo=true`, care type/context/timezone/policy, appointment/admission/payment state, token when applicable, next step, permitted actions and server timestamp. Queue position is computed from actual admitted visits in arrival order (token order for hospital queues); reserved/unavailable positions, ETA and room remain null. P10/P13 can use the existing authorized queue snapshots when relevant. Do not render a hold as a paid visit, a future reservation as an arrived patient, or an online OPD window as a guaranteed appointment time.

`400` means invalid input, `402` insufficient demo credits, `403/404` unauthorized or unavailable identity/context, `409` stale/full/expired/absent/policy conflict, and `428` missing/invalid request identity. Refresh actual availability after a conflict; retain the original key after a lost response.

## Additive initialization and recovery

New collections: CareSession, CareSlot, CareReservation, ScheduleOperation, ScheduleLock and DoctorAbsence. Existing appointment/token fields are optional; no visit backfill or replacement of P03 uniqueness indexes is needed. Initialize P09 after the earlier phase migrations. API startup refuses missing/conflicting P09 indexes. Empty local bootstrap includes these indexes but refuses nonempty uninitialized scheduling data or a running API.

Run only with an explicitly selected `DATABASE_URL`; private backup paths must be outside the repository. Stop API/consumer writers for apply/rollback. No existing development/production initialization was run as part of this phase.

```powershell
node backend/scripts/initSchedulingSchema.js --explicit-target
node backend/scripts/initSchedulingSchema.js --explicit-target --apply --writers-paused --backup <private-new-file>
node backend/scripts/initSchedulingSchema.js --explicit-target --rollback --writers-paused --backup <same-private-file>
```

Dry run reports counts/index names only. Apply creates missing collections/indexes and an exclusive backup of the prior index plan. Retry after partial index creation is safe with a new backup; retain the first plan for a reviewed rollback. Rollback validates database, definitions and unchanged indexes and removes only indexes added by that plan. It refuses once any scheduling data exists: keep P09, pause booking, diagnose accounting/records privately and recover forward. Removing indexes or reverting to an API that ignores scheduled arrival would permit unsafe operations on future visits.

Mongo transactions protect interrupted confirmation/rescheduling/cancellation. A retry reads its committed operation or repeats an aborted transaction safely. Outbox jobs use P06 persisted delivery. Expiry restart recovery does not depend on an in-memory timer. No real payment provider, SMTP delivery, live DNS, deployment or production migration was activated.

## Reproduce checks

From `backend`, `npm test` runs pure/mocked regressions; `npm run test:integration` runs the full isolated suite with the existing explicit local TEST_DATABASE_URL and TEST_REDIS_URL (Redis database 15). P09 uses generated `medipulse_test_p09_*` databases, synthetic accounts and disabled mail/AI/Kafka. The integration suite covers separate API processes, ledger rollback/retry, capacity/expiry, ownership, doctor absence/revocation, queue admission, rescheduling and empty schema rollback. Read WORK_LOG for the exact executed totals.

P10 should build the appointment and waiting-room UI with P08 components and these actual availability APIs. Recurring calendar templates, external calendar synchronization, mixed-fee/provider rescheduling, bulk absence messages and enterprise scheduling optimization remain separate extensions.
