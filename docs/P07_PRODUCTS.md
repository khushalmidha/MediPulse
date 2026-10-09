# P07 product contexts and rollout

## Implemented routing

| Surface | Host | Same-domain fallback |
|---|---|---|
| Company | `medipulse.live`, `www.medipulse.live` | `/` |
| Independent care | `connect.medipulse.live` | `/connect/*` |
| Hospital staff | `app.medipulse.live` | `/hospital/*`, `/staff/accept-invite` |
| Branded hospital patients | `<slug>.medipulse.live` | `/hospitals/<slug>/*` |

Existing independent-care deep links remain compatible on the company origin. New links should use Connect. Hospital staff paths retain `/hospital/` on the app host to preserve existing links. Hospital websites now route `/login`, `/signup`, `/visits`, `/visits/:tokenId`, `/profile/edit` and `/review` within their own basename. `/dashboard` redirects to the hospital's visits page. Tracking currently shows the patient's active tokens, including owned family visits, and their persisted status/date/session; history, room directions, file tracking and wait forecasts belong to later patient-workflow tasks.

Hostnames are normalized and classified explicitly; platform labels are reserved. Unknown or inactive hospital hosts fail closed. Exact preview/app aliases must be configured; all Vercel hosts are not automatically trusted. Public host resolution returns only hospital id/name/slug and bypasses cache. Host selection never authenticates a user or grants tenant permissions.

Hospital booking opens the hospital reservation form, states that physical check-in is required, and links to its token tracking page. Broken doctor-id triage/appointment links in that confirmation were replaced with hospital visit links.

Connect/patient surfaces hydrate account sessions; the staff surface hydrates staff sessions. A shared-origin staff cookie cannot create a staff workspace inside Connect. Cross-product links reload the document to establish the correct basename. Navigation within a product stays in the SPA. Connect communities and appointments continue using the existing stack. Auth cookies remain host-only: users sign in on each origin, and there is no implicit cross-subdomain SSO.

## Care context

New visits persist `practiceType`, `practiceKey`, `hospitalId` for hospital visits, `visitMode`, and the existing doctor/date/session queue key. No token sequence or existing queue key is renamed. Independent appointments use online mode; current hospital OPD uses in-person mode. Optional client context fields must match the server-derived endpoint context. Old clients may omit them.

The doctor's default queue is the current independent session. Hospital sessions appear as explicit queue choices, with no merged patient list; only accepted active hospital memberships contribute hospital queues. The dedicated hospital staff consoles retain their hospital/department authorization. Broader hospital visit modes and independent physical clinics require separately designed booking rules.

## Database rehearsal and deployment

P03 queue and P05/P06 schema migrations must already be complete. The new `hospitaldomains` collection uses canonical hostname `_id` uniqueness to reserve one hospital owner even under concurrent requests. Collection/index creation is included in empty local bootstrap and the P07 migration. Existing deployments should run the explicit migration before enabling domain administration.

Set `DATABASE_URL` privately to the intended database; never rely on a production default. Run from `backend`:

```powershell
node scripts/migrateProducts.js
# After reviewing zero issues, stopping every API/consumer writer, and backing up the database:
node scripts/migrateProducts.js --apply --writers-paused --backup <private-new-backup.ejson>
# Immediate recovery, with writers still stopped and unchanged migrated rows:
node scripts/migrateProducts.js --rollback --writers-paused --backup <same-private-backup.ejson>
```

Dry run reports counts and issue codes, never patient fields or domain ownership records. Apply writes a private BSON-aware backup exclusively before mutations, refuses conflicts and changed rows, and applies changes transactionally. Rollback checks the recorded post-change fingerprints before restoring fields/deleting inserted claims; it retains the harmless ownership collection/index. Modified rows require operator review. Do not commit backup files. On large datasets rehearse transaction duration and disk capacity before scheduling downtime.

The migration adds explicit context metadata without changing visits, queues, money or statuses. Legacy custom domains are reserved but **unverified** because the old implementation checked routing without proving ownership. They must pass fresh verification before serving patients. Rollback restores the historical flag but the new resolver still rejects a legacy domain without a verified reservation. Duplicate, invalid or conflicting domains block apply. Reserved legacy slugs keep their path fallback; migrate their URL only with an approved redirect plan.

## Domain lifecycle

Hospital administrators reserve a domain in a Mongo transaction before requesting provider setup. Retries reuse the same reservation. Replacement requires removing the existing domain first. Each reservation issues a fresh hospital-specific `_medipulse.<domain>` TXT challenge. Both this challenge and provider ownership/DNS routing must pass verification; an already-verified provider project does not prove a particular hospital owns its domain. Failed verification withdraws routing; removal withdraws routing before the provider call and keeps the reservation in `removing` state on failure so another hospital cannot take it. Retry removal to finish cleanup. Provider calls have bounded timeouts and sanitized errors. Provider outages do not release ownership or grant verification.

The adapter uses Vercel project-domain verification challenges and project-domain `verified`, plus the routing configuration check. Complete the current provider instructions rather than assuming a hardcoded IP/CNAME. References: [add project domain](https://vercel.com/docs/rest-api/projects/add-a-domain-to-a-project), [verify project domain](https://vercel.com/docs/rest-api/projects/verify-project-domain). Provider operations were tested with synthetic responses only. No live token or domain was used.

## DNS, TLS, hosting, API and auth checklist for the operator

1. Keep ownership of `medipulse.live`. No new domain purchase is required. Add `connect` and `app`, then explicit hospital subdomains or an approved wildcard, to the same frontend project. Configure DNS records using that hosting project's current instructions. Do not assume wildcard hosting/TLS is already enabled. Test certificate coverage for every served hostname and custom domain.
2. Keep SPA fallback on all hosts and nested paths. Preserve `/backend` API and Socket.IO relays in Vercel/Nginx. The current configured backend URL remains supported; `api.medipulse.live` is optional only after its DNS/TLS/host configuration is verified.
3. Frontend: `VITE_BASE_DOMAIN=medipulse.live`; `VITE_APP_DOMAINS` is an exact comma-separated allowlist of company/preview aliases. `VITE_ENABLE_HOSPITAL_CUSTOM_DOMAINS=false` by default; enable it only on the configured frontend when verified custom sites are ready. Rebuild after changing VITE configuration.
4. Backend: `PUBLIC_BASE_DOMAIN=medipulse.live` and `PUBLIC_APP_DOMAINS` matching explicit frontend aliases. Keep `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID` and optional `VERCEL_TEAM_ID` server-only. No VITE variable may contain provider credentials. Alias ownership and provider project settings need operator verification.
5. Add every approved frontend origin, including each hospital/custom site, to existing exact `CLIENT_URLS` CORS configuration. Do not automatically trust wildcard origins or every candidate hostname. Keep credentials enabled, strict Origin/CSRF validation on unsafe requests, and authorized socket room/session checks. Same-origin relays must preserve the existing origin policy.
6. Keep host-only HttpOnly Secure production session cookies and existing account/staff separation. Verify logout/session switching on root, Connect, app and patient sites. Do not widen the cookie Domain to `.medipulse.live` as a routing shortcut. An authenticated site must still satisfy server tenant/role checks.
7. Google Identity Services needs exact authorized JavaScript origins for enabled login hosts. Configure exact redirect URIs only if introducing a redirect-based flow; the current credential callback posts to existing API routes. Review Google console configuration for every hospital/custom origin before enabling its button. No console settings were changed here.
8. After operator approval: run migrations, apply hosting/DNS/TLS/CORS/Google configuration, deploy, and smoke-check company discovery, both login contexts, hospital booking/check-in/tracking and direct route reloads. Existing path fallbacks work first while DNS is pending.

## Remaining scope

P08/P09/P10 cover the complete design system and visual overhaul. P12/P13 expand patient journeys, timeline, room/file guidance and appointments. Domain monitoring/reconciliation, richer historical tracking and large-dataset migration batching are operational follow-ups; provider verification is performed on demand. Live hosting, DNS, TLS, CORS and Google settings remain unchanged by P07.
