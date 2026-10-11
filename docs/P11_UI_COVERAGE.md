# P11 — UI migration coverage

Complete one batch per run, in A–H order. P08 introduced shells and representative screens; P10 completed appointment/discovery/tracking. Neither phase marked an entire P11 batch complete.

## Batch A — account access and profiles

Migrated to the P08 controls and tokens. Executed results are recorded in [WORK_LOG.md](WORK_LOG.md).

| Route / context | Coverage |
|---|---|
| `/login`, Connect `/login` | Patient/doctor/staff selection, credential forms, password visibility, remembered-session request, failed sign-in and safe internal booking return |
| Patient hospital `/login` | Locked patient identity and hospital basename retained |
| `/hospital/login`, staff host `/login` | Locked staff identity, actual hospital ID, role-specific operational destination |
| Patient/doctor password recovery within login | Queued-email versus failed delivery, actual six-digit OTP, wrong-code retry, password reset and cleared password fields |
| `/signup`, `/signup/user`, `/signup/doctor` | Role selection, actual required fields, optional patient/clinic details, professional details, failure recovery and safe internal return |
| Patient hospital `/signup` | Locked patient identity, hospital visits return |
| `/profile/edit` for patient/doctor, including hospital patient | Authorized owner scope, recorded zero values, nested professional/clinic preservation, save feedback, offline retry and explicit dirty-edit cancellation |
| `/hospital/signup`, `/signup/hospital-admin` | Actual registration/admin/address form, required password validation, conflict recovery, verification status left to workspace |
| `/staff/accept-invite` | Missing/failed/expired/consumed invitation states, retry, actual role/professional information, one-time setup and role-specific destination |

Shared account page, role chooser, labeled fields, password controls and focused feedback replace repeated styles. One form-task hook prevents duplicate local submissions, blocks offline requests and aborts disposed operations. Credentials, invitation tokens and medical form input are not persisted by these forms. Server sessions, CSRF, invite consumption and authentication limits remain authoritative.

Email/Google sign-in reuse existing endpoints. Google controls are shared, dispose old callbacks, disable interaction during another submission and expose load failure/retry. With Google unconfigured, the product displays an email alternative without setup instructions. Real Google/provider and actual email delivery were not exercised by local synthetic browser checks.

Profile PUT sends only account fields already supported by the API. Doctor nested experience/clinic metadata is preserved; blank optional experience/fee/phone does not fabricate a zero or clear stored data. Signup sends explicit zero experience as a supplied value and omits blank optional fields. Fees remain visibly tied to demo credits and frozen scheduled bookings.

## Batch B — patient records and hospital discovery

Migrated to the shared teal controls, warm surfaces and patient page layout. Executed checks are recorded in WORK_LOG.md.

| Route / context | Coverage |
|---|---|
| `/health-records`, Connect health records | Patient gate, completed timeline, family/self/type/search filters, pagination, private details, draft text download, independent read failures and explicit stale refresh |
| Family profiles within health records | Required name/relation, optional known demographics, failed-input preservation, duplicate local submission guard, removal confirmation, offline blocking and focus restoration |
| `/hospitals`, Connect hospital directory | Actual profiles, name/city/care-system URL filters, real result pagination, unknown ratings, empty versus failed search, retry and hospital-product navigation |
| `/triage/:appointmentId` | Explicit language/start, failed-answer preservation, conversation, explicit draft save, access denial and offline states |
| `/smart-booking` | Protected symptom draft, failed-input recovery, returned profiles with actual metadata/demo fees, explicit model uncertainty and urgent-result booking suppression |
| `/review`, hospital patient review | Signed link/owner context, five explicit ratings with no defaults, optional anonymous public display, retry, replay/expired recovery and hospital visits return |

Patient workspaces are keyed by account identity; disposed reads and mutation callbacks cannot populate another account. Denied private requests hide details and close record dialogs. Clinical text and signed review details are not persisted by these forms. Linked completed hospital token/appointment entries count once while preserving consultation notes, draft text and available summaries. The read DTO adds family identity and visit mode without changing stored records.

Pre-visit questions remain optional clinician-review drafts. Explicit start avoids the old automatic conversation reset on page mount. Triage/family creation still lack server request idempotency; local guards cannot guarantee recovery after an interrupted response. The MP02 follow-up replaces family deletion with replay-safe archival, retains historical names and visit records, blocks active visits/holds and rejects new bookings for archived people. History-only identities remain available in record filters and details after reload. Room/file/ETA data, AI validation and hospital staff/body redesign remain their own documented phases.

## Batch C — doctor appointments and hospital OPD

Both /doctor/appointments and /hospital/doctor-opd use shared clinical controls, verified account/staff gates and identity-keyed disposal. Separate queues/sessions, arrived versus held visits, actual family names, ordered search, ready/reservation pagination, actual refresh times, empty/error/stale/denied states and offline blocking are covered. Missing wait/urgency values no longer become invented estimates or routine labels. Staff-doctor no-show buttons were removed because the server reserves that action for reception/nursing/admin roles.

Current consultations retain unsaved notes through polling, detect observed remote edits, require explicit draft discard before switching queues, and dispose drafts when the actor/visit changes. Completion and demo refunds use confirmations and actual revisions; pending refunds remain pending. Generated documents and optional assistant output remain clinician-review drafts. In-person appointments do not mount video. Queue sockets invalidate authorized HTTP snapshots; lower revisions cannot replace current records or enable stale actions.

Private doctor queue/active DTOs now include only the visited family ID/name, without exposing other family profiles. No write/schema migration belongs to this read fix. Notes/receipt APIs still need server conditional saves, validation and reviewed corrections (MP17/P18); UI conflict detection is not a server concurrency guarantee. P14 supplies availability/publication/practice history. WORK_LOG records the executed checks and publication.

## Batch D — reception, nursing and staff communication

Both `/hospital/nursing-station` (with alias `/hospital/reception`) and `/hospital/staff-communication` use shared P08 design tokens, responsive cards, verified staff auth gates and identity-keyed session disposal.

| Route / context | Coverage |
|---|---|
| `/hospital/nursing-station`, `/hospital/reception` | Role-aware badges and controls (reception check-in & walk-ins vs nurse vitals & clinical preparation), queue search/filter by token/name/phone, walk-in token issuance with full validation, arrival check-in with revision guard, accessible vitals entry dialog with focus trap, and safe no-show confirmation dialog |
| `/hospital/staff-communication` | Realtime multi-channel communication (Department channels, Direct staff messages with directory search, Patient context token threads, Laboratory alerts), P08 teal message bubbles, automatic read-receipt recording via `/api/staff-messages/read`, socket event lifecycle management (`staff:newMessage`, `lab:order-received`), and auto-scroll behavior |

Staff workspaces are keyed by staff session identity; disposed reads and drafts cannot leak to another user. Clean empty states, loading indicators and error banners provide clear feedback during offline or failed requests.

## Batch E — hospital administration, website editor and public hospital portal

Both `/hospital/admin` (`HospitalAdminDashboard.jsx`) and `/hospitals/:slug` (`HospitalWebsite.jsx`) use shared P08 design tokens, responsive cards, verified staff/guest gates and identity-keyed session disposal.

| Route / context | Coverage |
|---|---|
| `/hospital/admin` | Operational analytics overview (Bookings, completed visits, staff count, rating, demo volume), department management (add department with code/OPD fee), staff directory & invitations by role (`DOCTOR`, `NURSE`, `RECEPTIONIST`, `HOSPITAL_ADMIN`, etc.), resend invites, grant admin access, two-step OTP staff removal dialog, AI demand forecasting (beds & blood bank with planning draft disclaimers), website branding editor (tagline, about, logo, primary color with live accessible contrast preview), and administrator password update |
| `/hospitals/:slug` | Public branded hospital website with sticky navigation, accreditation badge, facility carousel, department cards with live OPD token status & wait time, doctor directory with search and filter, embedded booking modal (`BookingFlow`), patient reviews with 5-star rating breakdown, and hospital contact footer |

## Remaining batches

| Batch | Status | Routes / remaining scope |
|---|---|---|
| A | Migrated; see work log for verification | Account routes above; organization operating/onboarding tools remain E/P17 |
| B | Migrated; see work log for verification | Patient routes above |
| C | Migrated; see work log for verification | `/doctor/appointments`, `/hospital/doctor-opd`; P10 call/booking compatibility remains |
| D | Migrated; see work log for verification | `/hospital/nursing-station`, `/hospital/reception`, `/hospital/staff-communication` |
| E | Migrated; see work log for verification | `/hospital/admin`, website/editor configuration and hospital website body |
| F | Next | `/communities`, `/chat`, `/events`, `/events/past` |
| G | Pending | `/wallet/transactions`, `/wallet/refunds`, `/wallet/notifications`, `/admin/virtual-payments` |
| H | Pending | `/about`, `/privacy`, `/terms`, `/cookiepolicy`, remaining public/utility page bodies |

P12/P13 room/file/ETA workflows and later product expansion remain separate tasks. No deployment, DNS, provider activation or database migration is included in this UI batch.
