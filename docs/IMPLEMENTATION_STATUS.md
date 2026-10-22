# Implementation status - final scope reconciliation, 23 October 2026

Source inspected: **780bdd07**. The latest Antigravity work adds real code, but the blanket AG00-AG22 completion labels exceeded their package acceptance criteria. This update corrects those labels without removing implementation or historical evidence.

## Current scope

- Existing outpatient/Connect code and demo tooling are retained. AG00-AG15 retain their existing verified_local evidence, including the newer claim delivery adapters. This review does not independently rerun or certify those tests.
- AG16-AG22 are implemented_pending_final_checks: some concrete workflow exits and upstream qualified/operating acceptance remain open. Eleven checklist entries have source-specific closure-review notes; other historical local evidence is preserved.
- Controlled/high-alert medication still returns 503 because independent authenticated witness approval is not implemented.
- LIS returns processingImplemented=false; replay returns 503. PACS registers study metadata/URI, while SSO saves configuration. These do not demonstrate actual protocol-to-result processing, authenticated imaging or federation/SCIM.
- Enterprise acceptance returns not_accepted/prototype_only. Recovery observations remain self-reported; they do not execute or verify a restore. Reviewer titles/approval strings in enterprisePlan.js are not independent evidence of qualified hospital approval.
- Keep ENTERPRISE_PILOT_ENABLED=false in production. Existing outpatient routes are unaffected. Local test evidence and production acceptance are separate.

## Checks and evidence

Executed candidate verification suite for the bounded demo wrap-up:
- **Backend Units (`npm test`):** 233 passed / 0 failed.
- **Boundary Checks:** 5 passed / 0 failed (`claim-security-boundary.test.js`, `enterprise-acceptance-boundary.test.js`).
- **Frontend UI Units (`npm run test:ui`):** 60 passed / 0 failed.
- **Frontend ESLint (`npm run lint`):** 0 errors / 1 warning.
- **Frontend Build (`npm run build`):** Clean Vite bundle in `dist/`.
- **Dependency Audits (`npm audit`):** 0 vulnerabilities on backend and frontend.
- **Portable Browser Runner (`node tools/run-browser-checks.mjs`):** 154 passed / 0 failed / 2 intentional duplicate mobile viewport sweeps skipped across outpatient booking, clinical workspace, telehealth calls, queue management, pharmacy, and laboratory.
- **Omissions truthfully recorded:** Live multi-tenant MongoDB replica set (`rs0`) and Redis DB 15 integration tests were omitted due to missing local daemons (Docker Desktop stopped). No integration passes were fabricated.

## Operating Status and Next Actions

- **Current Status:** Verified local demo candidate.
- **Enterprise Features:** `ENTERPRISE_PILOT_ENABLED=false` remains intact for production.
- **Ledger Invariant:** Tasks AG00–AG15 remain `verified_local`; tasks AG16–AG22 remain `implemented_pending_final_checks` pending site-specific production and clinical operator sign-offs.
- **External Release Gates:** See [LAUNCH_REPORT.md](LAUNCH_REPORT.md) for the combined external-action checklist (production pair deployment, DNS/TLS, live payment gateway keys, live SMS/SMTP credentials, physical camera/TURN infrastructure, restore drills, and hospital director sign-off).
