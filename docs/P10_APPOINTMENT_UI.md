# P10 — Appointment and waiting-room UI

## Journey and contracts

Doctor discovery/profile and independent/hospital booking reuse the P08 controls. Guests can inspect published availability; patient sign-in returns to the chosen doctor, care type, date and slot. Self/family selection uses only the authenticated family API. A configured session is required for scheduled online, online OPD and hospital in-person bookings. Existing immediate queues remain an explicit alternative.

Booking reads `/api/scheduling/availability`, creates a capacity hold, reviews the server fee/timezone/policy and confirms through the P09 reservation API. A hold is not payment or arrival. Confirmation opens `/appointments/reservations/:id`, or the hospital's `/reservations/:id`. My appointments and hospital visits link to owned reservations. See [P09_SCHEDULING.md](P09_SCHEDULING.md) for backend invariants and initialization prerequisites.

The tracker displays actual slot/token, payment, admission, queue position when known, refresh time and next step. Unknown ETA and room remain unavailable. Hospital patients check in with staff; only online visits offer the configured online arrival action and active consultation panel. Rescheduling uses real matching availability and the current reservation revision. Cancellation uses the server policy and demo-credit refund. Existing immediate queue cancellation retains the P04 canonical refund endpoint and completed/pending distinctions.

## Recovery and privacy

Synchronous submission guards prevent repeated local clicks. P04/P09 request keys survive reloads; interrupted holds replay their original body even if their own hold fills the slot. Interrupted confirmation recovers by reading the reservation. Reschedule/cancel/check-in retain the original mutation intent until acknowledged or recovered through tracking. Known conflicts refresh actual availability and preserve recoverable selection.

Only minimal owner/provider-scoped selection, reservation IDs and mutation metadata are stored locally; names and medical input are not added to these drafts. Owner changes dispose pending reads and rendering scopes. Private 401/403/404 responses clear previously loaded details and prevent a held receipt from falling back after denied access. Network/server refresh failures retain details with an explicit stale/error notice. Offline mutation controls are disabled.

Downloads include a real UTC calendar event with a 15-minute reminder; users must import it into their calendar. The UI does not claim email reminders were sent. Existing consultation summaries download as drafts unless clinician review is recorded. jsPDF is loaded on demand. Doctor verification is reported only when recorded; ratings, credentials, room directions and availability are not fabricated.

## Components and checks

Shared implementation: `BookingFlow`, `DoctorSummary`, `CallPanel`, `LegacyVisitActions`, `useCareResource`, appointment formatting/calendar helpers and lazy consultation-summary download. Hospital booking uses an inline review within its native modal and focuses/scrolls its review heading after a hold. Queue revision guards retain the latest accepted revision across manual retry. Public/owned resources refresh on visibility/online signals; private live views also listen to socket invalidation and poll.

`npm run test:ui` runs design and appointment utility checks. `npx playwright test` uses the synthetic local API and actual React routes for desktop/mobile booking, retry, privacy, management and responsive checks. `npm run build` and affected ESLint comparisons cover the UI implementation. [WORK_LOG.md](WORK_LOG.md) records executed results and captured screenshots.

No backend schema, dependency, DNS, provider or deployment change is part of P10. Published schedules require P09 configuration. Real room/file guidance and ETA ranges depend on P12/P13; the current API returns unknown values. Remaining page bodies are P11 batches. Real provider/device verification and a comprehensive accessibility audit remain launch work.
