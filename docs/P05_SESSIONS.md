# P05 sessions and rollout

## Contract

- JWTs are host-only HttpOnly cookies backed by a Mongo `AuthSession` sid. Browser JavaScript receives a separate CSRF token from login/current-session responses and holds it in memory. Mutations using cookies require that token and an allowed `Origin`. Explicit bearer clients require the same persisted session and current account permissions.
- One active workspace per browser/API cookie host: signing into a patient, doctor or staff account revokes both previous cookie sessions and clears their cookies. Staff sockets explicitly select `staff`; account sockets select `account`. Delayed verification responses cannot overwrite a newer workspace or its CSRF token. Logout revokes the server session; password reset/change increments the account version and invalidates existing sessions.
- Non-remembered sessions have a browser session cookie and a three-day server maximum. Remembered sessions last at most 30 days. Expiry is checked on every request/packet even if Mongo TTL cleanup is late. Logout disconnects matching sockets in the current API process; other instances check each packet and poll at five-second intervals. Instant distributed broadcasts/session revocation remain P06 work.
- CORS permits exact configured `CLIENT_URLS` plus the company/connect/app origins and explicit development ports. Arbitrary Vercel/Render projects, `null`, wildcard origins and unconfigured hospital/custom hosts are refused. Add approved preview/hospital origins explicitly until P07 supplies verified host resolution.

## Existing domain/backend compatibility

The production frontend defaults to `/backend`. Vercel rewrites that prefix to the existing Render API; Nginx/Vite relay it to their configured backend. This keeps browser cookies first party on `medipulse.live`, including path fallbacks, without purchasing a domain or making JWTs readable. Relayed Socket.IO uses HTTP polling; it does not depend on Vercel WebSocket proxy support. Direct API URLs still use polling/WebSocket upgrade.

`VITE_BACKEND_URL`/Compose `PUBLIC_API_URL` can explicitly select a direct HTTPS API. The existing cross-site Render URL then requires browsers to allow third-party cookies. For shared login across future hospital subdomains, a configured `api.medipulse.live` alias keeps the central host-only cookie on the same site. Independently relayed/custom hosts have their own host-only browser sessions and require sign-in there. DNS/TLS/provider/Google changes and actual proxy cookie forwarding must be verified at approved deployment time; none were executed here.

Production cookies use `Secure; HttpOnly; SameSite=None; Path=/`, with no `Domain`. Local cookies use `SameSite=Lax`. Serve production over HTTPS. All four old cookie names are cleared during switches/logout. Deploy frontend and API together; old JWTs without a persisted sid require sign-in again. Existing Redis reset OTPs are no longer accepted: request a new OTP. Historically double-hashed patient passwords cannot be recovered; affected users need a reset with configured mail delivery.

## Schema initialization and recovery

Apply the reviewed P03 queue and P04 money migrations first. P05 adds auth collections/indexes and optional account `authVersion` fields (missing versions are treated as zero); no account/password/community data backfill is needed. API startup refuses missing/conflicting auth indexes. The local empty bootstrap may initialize empty auth collections only while the API is stopped; populated collections require the explicit script below.

Set the approved `DATABASE_URL` privately in the shell. The script requires it explicitly, does not load deployment `.env` or print the URI, and defaults to dry-run:

```powershell
node backend/scripts/initAuthSchema.js
```

Review collection counts and index conflicts. Pause API/consumer writers, take the normal private database backup, then on the approved target:

```powershell
node backend/scripts/initAuthSchema.js --apply --writers-paused --backup C:\private\p05-indexes.json
```

The backup file must be new and private; it records database name and index metadata. Apply adds missing indexes only and refuses conflicts. TTL indexes intentionally remove expired authentication metadata; they never remove accounts or clinical records. The script does not repair old password hashes or accept unexpired legacy JWTs. Restart the coordinated versions after readiness succeeds and verify sign-in, cookies, CSRF, staff switching, sockets and reset mail.

For version rollback, keep writers paused and use the matching private metadata file:

```powershell
node backend/scripts/initAuthSchema.js --rollback --writers-paused --backup C:\private\p05-indexes.json
```

Rollback removes only P05 indexes that were absent before apply, refuses changed index definitions, and retains documents. Restore the reviewed application versions together; returning to the old version also restores its old session weaknesses. Do not delete auth collections or patient records. A database backup is needed to recover expired auth metadata removed by TTL, though such metadata must not authenticate again.

## Module rules

- Community discovery/public doctor pages return metadata/counts, without member IDs or message pointers. Message history/send requires membership or the doctor organizer; REST and sockets share this rule. Join/leave and sends are transactional; duplicate joins do not duplicate membership, organizers cannot leave their own community, and broadcasts recheck recipients. Events are visible to community members and created only by that community's doctor organizer. Community moderation/pagination remains P14.
- Staff invites must have a future expiry. Acceptance atomically consumes the pending invitation; replay/resend races cannot replace an accepted password. User/Doctor/Staff profile saves preserve password hashes; passwords/invite secrets are excluded from model JSON and auth responses.
- OTP attempts are atomically capped at five without extending the ten-minute deadline. Reset consumption/password change/revocation commit together. OTP hashes use HMAC and secrets are no longer published to general Kafka notifications. Email-disabled/unconfigured/failed delivery returns 503. Provider acceptance is not a guarantee of inbox delivery; durable secret-bearing mail jobs remain P06.
- Forecast routes require current staff authentication and same-hospital `HOSPITAL_ADMIN` role. Bed/blood output must pass bounded schema/department/range checks before storage; malformed legacy drafts are withheld for regeneration. These are unreviewed AI planning drafts using recorded OPD volume, with admissions/occupancy/inventory unknown. No measured predictive accuracy is claimed.

No production schema operation, existing development-data migration, DNS change, provider activation, deployment or image rebuild was executed for P05.
