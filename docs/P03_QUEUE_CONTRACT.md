# P03 queue invariants and existing contracts

Written before implementation, 2026-10-09.

- Queue identity is practice (hospital or independent practice), doctor, local service date and configured session. Departments share that doctor's hospital session counter. Hospital timezone defaults explicitly to `Asia/Kolkata`; session defaults to `day`. Session identifiers must be configured, not arbitrary client strings.
- Token numbers are unique within that exact queue. Atomic first counter creation must recover from duplicate-key races. Gaps are allowed.
- A patient identity is account plus owned family member (or self). Different family members can book separately. Anonymous assisted walk-ins receive distinct identities; retry identity comes from the client request key.
- One live booking per patient identity per queue, enforced in MongoDB. One active consultation per queue, also enforced in MongoDB. Independent and hospital visits remain separate even when they share doctor identity.
- A persistent request key belongs to actor and booking endpoint. Identical retries replay the same resource; changed input with the same key conflicts. Processing requests cannot debit again, including across API processes. Payment crash recovery and cumulative refund correctness remain P04 work; ambiguous operations must stay pending for reconciliation.
- Remote hospital reservations have no arrival timestamp and cannot enter consultation/vitals queues until authorized staff check-in. Walk-ins are checked in explicitly by issuance. Independent online visits do not imply physical arrival.
- Status changes use conditional writes and transactions. Linked token/appointment transitions commit together through one service. Terminal visits cannot be reopened by vitals, no-show, start or stale completion requests. Reads, caches and queue ordering use the same boundary.
- Queue order is token number for hospital visits and creation time plus ID for independent visits. Starting later entries requires a future explicit priority/override workflow, not an accidental race.
- Legacy data/indexes require a dry-run migration, duplicate detection and reviewed correction. Never silently delete conflicting clinical visits. Production migration is a separately authorized action.

Existing routes and response envelopes are retained: OPD `book`/assisted `token`, doctor `queue`, patient `my-token`, token vitals/start/complete/no-show; appointment book/pending/queue/history/start/end/refund. Additive fields carry queue context, visit mode and revision. Add a staff check-in route and reservation list. Booking clients send `Idempotency-Key`; response consumers continue receiving token/appointment IDs. Physical hospital visits must not start video calls.

P04 owns atomic ledger/booking reconciliation and recovery of interrupted payment/refund operations. P06 owns durable events, cache recovery and consultation deadlines across restarts. P07/P09 own richer practice/slot scheduling; this task implements configured daily/session queues without inventing slot availability.
