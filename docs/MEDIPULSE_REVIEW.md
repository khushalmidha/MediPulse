# MediPulse repository review

Reviewed 8 October 2026. This is a static review with deeper tracing of the core workflows, not a claim that every endpoint has been executed. No application code, production data, DNS, or dependencies were changed. No tests were run. `https://medipulse.live` returned HTTP 200 and the Vite application shell; rendered desktop/mobile UI and authenticated live workflows were not inspected. The working Git tree was clean before these documents were added.

## Existing architecture and scope

- React 19, Vite, React Router, Tailwind v4, Axios, Lucide, Socket.IO client, WebRTC, and PDF generation.
- Express 4, Mongoose/MongoDB, JWT/cookies, Google authentication, mail providers, Redis, and Kafka consumers.
- Independent doctor profiles, communities, events, immediate appointment queues, video calls, triage, SOAP/copilot tools, virtual payments/refunds, and reviews.
- Hospital registration/approval, departments, seven staff roles, branding/custom-domain configuration, OPD tokens, nurse/doctor consoles, staff messages, and patient/family timelines.
- External ML integrations are referenced. The Python ranking-engine source described in README is absent from this checkout; README and PRODUCTION_ROADMAP describe different ML implementations. Forecast generation currently calls Gemini. Documentation does not establish production model quality.
- Appointment, hospital, video-call, signup, and login files contain hundreds of lines and mix many responsibilities. Shared global CSS has almost no design tokens or reusable primitives. Most visual styling is repeated in page markup.

## Evidence and fix order

| Priority | Finding | Code evidence and consequence |
|---|---|---|
| Immediate | Embedded database credentials | `backend/sync_indexes.mjs` and `backend/check_tokens.mjs` contain credential-bearing connection URIs. `sync_indexes.mjs` is tracked by Git. Rotate the affected database credential, replace literals with environment lookup, and assess repository history exposure. Never copy the credential into reports. |
| Immediate | Public hospital response is unrestricted | `backend/controller/hospital.js:getHospitalProfile` returns a full lean hospital document. `backend/model/hospital.js` includes subscription and onboarding password ciphertext/IV/tag fields. Any populated fields can reach the public response. Use a public field allowlist and invalidate existing public caches. |
| High | Patient identity can be supplied by the client | `backend/controller/opdToken.js:issueToken` checks duplicates/payment against authenticated ID but writes `patientId: patientId || req.auth?.id`. The patient route uses middleware accepting patient and doctor roles. Bind patient identity to the authenticated patient and validate family ownership. Validate assigned doctor's department membership as well as hospital membership. |
| High | Booking is not one consistent operation | OPD sequence increment, ledger debit, appointment creation, and token creation happen separately. The OPD payment reference includes `Date.now()` and direct appointment references use fresh IDs, so request replay is not stable. OPD has no equivalent of the direct appointment creation compensation. Even direct booking reports “Payment reversed” if its refund attempt fails. |
| High | Queue transitions can race | OPD start checks for another active token before saving. Independent appointment start reads queue order before saving, with no explicit active-appointment constraint. Vitals, completion, and no-show use ordinary document saves, permitting overlapping or invalid transitions. Atomic counters alone do not solve these races. |
| High | Queue identity and indexes need product decisions | Sequence scope is hospital/doctor/date; token-number uniqueness includes department. Active-token uniqueness is patient/doctor, with no family or service date distinction and no exclusion of missing patient IDs. A missing patient ID is indexed like null, risking walk-in conflicts. Active appointments similarly treat all family members as the same user/doctor pair. Confirm actual installed indexes and MongoDB version before migrations. |
| High | Refund eligibility can race | `backend/services/virtualLedger.js:refundVirtualPayment` reads cumulative refunds before the transfer locks/transaction, and updates refund/original records after transfer. Different requests can validate the same remaining amount. Completed replay is checked after rejecting a fully refunded original. The ledger also runs parallel wallet operations within a transaction. |
| High | Authorization/session handling is inconsistent | CORS always accepts all origins through `backend/config/corsOrigins.js`; auth/staff cookies set `httpOnly: false`; frontend socket selects staff cookie before patient cookie. Broad hospital rooms receive full tokens, vitals, notes, and diagnosis events. Socket staff messages do not visibly verify all referenced records belong to the tenant. Review public response allowlists and identity exposure, including anonymous reviews. |
| High | Community access and doctor messages are incomplete | REST message reads/writes check community existence without a membership check. `createMessage` resolves only a User, even though doctors are meant to lead communities. REST and socket policies need a shared rule. Event creation also needs an explicit organizer permission rule. |
| Definite bug | Forecast routes do not execute forecast controllers | `backend/routes/forecast.js` mounts `StaffVerifier`, which sends a session response and never calls `next()`. Replace with authorization middleware. `generateBedForecast` also interpolates an undefined `opdVolume`. Generated forecasts should not be advertised as measured predictive performance. |
| High | Background work can be lost | Kafka publishers catch errors or silently return when unconfigured; mail consumers catch delivery errors. Review worker removes failed jobs in `finally`. Consultation timers/presence are process-local. Multiple replicas/restarts require persistent deadlines, claiming/retry rules, and a Socket.IO adapter if horizontally scaled. |
| High | Local/production infrastructure differ materially | Docker Mongo is standalone while the ledger requires multi-document transactions. Production compose inherits local `DATABASE_URL` values without an Atlas override. Docker does not explicitly select real Redis in the shown configuration. Nginx image lacks SPA deep-link fallback. `render.yaml` declares only the API, while email depends on a consumer process. Actual hosting configuration remains unverified. |
| Medium | Hospital date boundaries depend on server timezone | OPD uses local `setHours()` combined with UTC date slicing. Queue cache/date filters should use an explicit hospital timezone and service/session date, with midnight coverage. |
| Medium | Product contexts are combined | `appointment.js:getLinkedDoctorIds` merges independent and hospital staff identities. Hospital token actions also start linked online appointments. The frontend displays video UI for an active linked appointment. Model visit mode and practice/session context explicitly so an in-person visit does not automatically become a video appointment. |
| Medium | New product needs backend capabilities | Appointment model has queued/active/completed/cancelled states but no scheduled slot, practice context, or capacity reservation. Department timings are configuration, not a complete scheduling engine. Online booking immediately records arrival. ETA is initially stored as queue count times average duration plus five minutes, with no patient-specific continuously updated estimate. |
| Medium | Marketing exceeds verified implementation | Home contains hardcoded named testimonials and claims QR-verified prescriptions. Dedicated prescription/lab/pharmacy/room/file-handoff models were not found in this checkout. Verify evidence before presenting these as real testimonials or shipped capabilities. |
| Medium | Verification baseline is weak | Backend `npm test` is a placeholder. Two ad hoc scripts exist, including ledger operations against a database; they are not a safe regression suite. Establish isolated tests for money, authorization, concurrent operations, and critical user journeys. |

## Recommended product boundaries using the existing domain

| Address | Product surface | Fallback before DNS/hosting setup |
|---|---|---|
| `medipulse.live` | Company home with Connect and Hospitals products | `/`, `/products/connect`, `/products/hospitals` |
| `connect.medipulse.live` | Independent doctors, patients, communities, online consultations | `/connect/*` |
| `app.medipulse.live` | Authenticated hospital staff workspaces | `/hospital/*` |
| `<hospital-slug>.medipulse.live` | Hospital-branded public website and visit tracking | `/hospitals/:slug/*` |
| `api.medipulse.live` | API if configured on the existing backend host | Keep configured backend URL until DNS/TLS works |

These names are subdomains of the owned `medipulse.live`; they require DNS and hosting configuration but no additional domain purchase. `medipulse.connect.live` is under `connect.live`, a different parent domain. The current hostname resolver defaults to `medipulse.com`, does not reserve `connect`, and App returns HospitalWebsite before other routes on hospital hosts. Fix these together, including unknown hosts and custom-domain verification. Do not assume wildcard DNS/TLS or live settings are already configured.

Retain the current stack and start with a modular backend and separate product shells. Share doctor identity only where permissions allow; keep practice availability, visits, records, and queues scoped to their actual care context. A doctor may work independently and at several hospitals without combining those queues by default.

Suggested pilot assumption: one hospital's OPD, each doctor's session as the queue boundary, India/Asia-Kolkata as an initial configurable locale. These are provisional; launch country and whether current wallet balances represent real money have not been confirmed. Keep virtual credits explicitly marked as demo until a real payment flow is specified.

## Expansion sequence

1. Credentials/public data exposure, authorization, and reproducible development infrastructure.
2. Reliable OPD/booking/ledger state transitions and payment reconciliation.
3. Product context separation and design system; rebuild appointment and staff workflows.
4. Patient visit journey: check-in, room directions, current file handoff, live queue/ETA, persistent notifications, and secure timeline.
5. Independent doctor availability, community leadership, and reliable online consultations.
6. Lab orders/results and pharmacy fulfillment as separate modules with human approval and audit trails.
7. SaaS onboarding, subscriptions/entitlements, support, operational metrics, and staged hospital pilot.
8. Enterprise expansion: branches, wards/IPD, admissions/transfers/discharge, billing and procurement, integrations, department permissions, SSO, disaster recovery, and performance targets established with pilot hospitals.

An OPD product is a feasible first sellable milestone. The final enterprise hospital suite needs requirements from operating hospitals; menus and inventory schemas alone do not complete those workflows.

## Model guidance sources

The prompt assignments are project-specific recommendations, informed by [official model selection](https://developers.openai.com/api/docs/guides/model-selection) and [reasoning effort guidance](https://developers.openai.com/api/docs/guides/reasoning), checked on 8 October 2026. Product availability and limits depend on the account. Use the exact model/effort exposed by your Codex picker; no API pricing is assumed to equal Codex plan consumption.

## P05 verification update — 9 October 2026

The session/CORS, community/message/event and forecast findings above were verified against source and addressed in the P05 checkout. User's unchanged-password rehash, invite expiry/replay and reset-attempt races were also corrected. See [WORK_LOG.md](WORK_LOG.md) for executed checks and [P05_SESSIONS.md](P05_SESSIONS.md) for rollout, index initialization and re-login requirements. This review remains the historical audit; these code fixes have not been deployed to the live website. Durable/distributed delivery, verified host routing and the broader UI/product work remain later batches.

## P06 verification update — 9 October 2026

The background-work findings were reproduced in the source: review jobs were removed in a `finally` block after failed delivery; consultation endings used a process-local universal five-minute timer; OTP success could follow disabled mail; call configuration referenced provider secrets in VITE variables. These paths are replaced by persisted transactional outbox jobs/challenges, lease/retry/failure visibility, persisted configurable online deadlines and authorized backend TURN credentials. Current critical patient delivery includes booking, doctor-ready, cancellation/refund and review mail plus queue invalidation jobs. Analytics no longer receives/stores OTP bodies, and Kafka availability no longer gates clinical API readiness.

Authorized queue snapshots carry revisions; clients recover through reconnect/visibility/polling and reject reversed responses. Hospital patient call alerts use their own token snapshot. Calls preserve active visits on disconnect, recover participant presence/signaling, expose truthful device errors/audio fallback, and end through the doctor REST transition. Current runtime explicitly supports one API instance; no Redis adapter or distributed presence claim is made.

See [P06_DURABLE_WORKFLOWS.md](P06_DURABLE_WORKFLOWS.md) for migration, private backup/rollback, failed-job operations, legacy backlog boundaries and provider/deployment verification limits. Executed check results are recorded in [WORK_LOG.md](WORK_LOG.md). No deployment data, DNS or providers were changed.

## P07 verification update — 9 October 2026

Verified the default `medipulse.com` parser, lack of reserved Connect/app names, hospital-host early return and provider routing-only verification. Replaced them with normalized explicit product resolution, nested patient routing, exact preview aliases and fail-closed unknown/disabled/inactive hosts. Hospital custom domains now use canonical unique Mongo reservations, a fresh hospital-specific DNS TXT challenge, provider project ownership and DNS routing verification. Provider failure/removal withdraws routing, and stale verification cannot grant a recreated reservation.

Visits persist explicit practice/mode metadata while retaining P03 queue identities. The independent doctor session is the default; each active accepted hospital membership is an explicit queue choice. Revoked memberships and inactive hospitals are excluded. Connect/patient surfaces hydrate account sessions and the staff surface hydrates staff sessions. Hospital booking now opens its own form and tracking route; the former doctor-id triage navigation was verified as incorrect.

See [P07_PRODUCTS.md](P07_PRODUCTS.md) for the private migration, conflict/stale guards, rollback, legacy-domain re-verification and DNS/TLS/hosting/API/CORS/cookie/Google steps. [WORK_LOG.md](WORK_LOG.md) records executed checks. These are local checkout changes; the live website/configuration has not been changed. The complete visual overhaul remains P08 onward.

## P08 verification update — 9 October 2026

Verified the absence of shared visual tokens/component conventions and the legacy Home page's unverified named testimonials and unsupported QR-prescription claims. Replaced that marketing source with the honest two-product company page, added company/care/staff shells and hospital branding with derived readable contrast, and established reusable controls and accessible loading/empty/error states. The existing heart mark and Lucide icons are reused consistently.

Representative patient visits and the nursing station now render actual authorized API responses with clearer arrival/status guidance and labeled forms. Initial patient refresh failure no longer leaves a permanent spinner. Nursing context reads current auth state rather than a frozen storage snapshot, and blank vitals are omitted instead of submitting empty numeric measurements. Existing queue revisions, owner filtering, idempotency and demo-credit boundaries remain intact.

See [P08_DESIGN_SYSTEM.md](P08_DESIGN_SYSTEM.md) for component conventions and bounded page migration; [WORK_LOG.md](WORK_LOG.md) records actual checks. Remaining legacy page bodies, real appointment availability and comprehensive waiting-room redesign are P09–P11 work. No live deployment or DNS/provider/database changes were performed.

## P09 verification update — 9 October 2026

Verified that queue bookings were limited to the current service date, had no persisted availability/slot-capacity contract and could not represent future online reservations separately from arrived patients. Added configured dated sessions, real slots/breaks, doctor leave, expiring capacity holds and typed appointments for scheduled online, online OPD and hospital visits. Canonical doctor locks protect overlapping sessions across practices; patient/family locks and conditional capacity writes protect competing reservations. Confirmation, demo-credit payment and linked visit creation share one Mongo transaction.

Scheduled reservations remain excluded from the ready queue until their actual arrival/start. Staff must confirm physical hospital arrival; patients can check in online within the defined window. Cancellation and rescheduling apply frozen policy/fee constraints, retain stable request identities and synchronize capacity with existing visit/refund transitions. Future bookings do not receive the immediate-queue auto-refund timer. Tracking returns actual reservation/admission/payment state, arrival-based queue positions when available and explicit unknown room/ETA values.

See [P09_SCHEDULING.md](P09_SCHEDULING.md) for API examples, default rules, additive schema initialization, guarded rollback and P10 integration. Existing immediate bookings remain compatible. Appointment UI, recurring calendar templates, bulk absence notifications and broader tracking remain later tasks. No existing database or live service configuration was migrated; [WORK_LOG.md](WORK_LOG.md) records isolated checks and Git publication results.


## P10 verification update — 10 October 2026

Verified the appointment pages still used current-day queue booking without a published-slot flow, and the profile/history UI needed the P08 controls. Rebuilt doctor discovery/profile, shared independent/hospital booking, appointment history and private reservation tracking using the actual P09 APIs. Care type, self/family, actual date/slot, server fee/policy review and confirmation are explicit. Guest discovery returns to the chosen booking after patient sign-in. Hospital doctor profiles and direct booking retain the hospital care context; affiliation names use the API’s actual hospitalName/hospitalId fields.

Holds and uncertain payments are not shown as paid visits. Stable original requests survive lost responses/reloads, stale capacity preserves selection and unavailable slots are not fabricated. Tracking distinguishes reservation from arrival, displays actual payment/status/freshness/next step and provides eligible reschedule/cancel/online arrival. Hospital visits offer staff arrival guidance and no video. Unknown room/ETA remain unavailable. Existing queue cancellation and draft-summary downloads are preserved; calendar downloads contain the actual visit times without claiming delivered email reminders.

Private resource scopes dispose old-owner responses and clear loaded details on access denial. Network refresh errors retain explicitly stale details. See [P10_APPOINTMENT_UI.md](P10_APPOINTMENT_UI.md) for implementation/recovery boundaries and [WORK_LOG.md](WORK_LOG.md) for executed checks. This is frontend work; P09 schedule configuration/initialization remains required. P11 migrates remaining page bodies, and P12/P13 supply actual room/file/ETA workflows. No live website, database, DNS or provider changes were performed.
