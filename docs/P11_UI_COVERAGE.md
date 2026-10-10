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

## Remaining batches

| Batch | Status | Routes / remaining scope |
|---|---|---|
| A | Migrated; see work log for verification | Account routes above; organization operating/onboarding tools remain E/P17 |
| B | Next | `/health-records`, `/hospitals`, patient family/records, related patient triage/review pages |
| C | Pending | `/doctor/appointments`, `/hospital/doctor-opd`; P10 call/booking compatibility remains |
| D | Pending | Reception/nurse workflows and `/hospital/staff-communication`; P08 nursing controls are partial coverage |
| E | Pending | `/hospital/admin`, website/editor configuration and hospital website body; P10 booking modal is complete |
| F | Pending | `/communities`, `/chat`, `/events`, `/events/past` |
| G | Pending | `/wallet/transactions`, `/wallet/refunds`, `/wallet/notifications`, `/admin/virtual-payments` |
| H | Pending | `/about`, `/privacy`, `/terms`, `/cookiepolicy`, remaining public/utility page bodies |

P12/P13 room/file/ETA workflows and later product expansion remain separate tasks. No deployment, DNS, provider activation or database migration is included in this UI batch.
