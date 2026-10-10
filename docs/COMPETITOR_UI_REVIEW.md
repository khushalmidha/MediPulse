# Product and UI direction — 10 October 2026

## Live-site evidence

A fresh Edge browser visit to `https://medipulse.live` redirected to `https://www.medipulse.live` and returned HTTP 200. The P08 two-product homepage is rendered. `/login` renders `.mp-account-page` from P11 A; the deployed JavaScript contains account and booking layout markers. Live assets at inspection: `index-CdZcVvfB.js` and `index-BocdC1Ju.css`. Local P11 A CSS has the same filename; JavaScript hashes differ with build configuration, so those hashes alone do not identify the deployed Git commit.

The current implementation looks generic and many hospital page bodies remain legacy UI, as recorded in P11 coverage. This evidence supports a design/coverage gap; it does not establish a failed production deployment. Vercel production branch, deployment logs and environment settings cannot be read through public pages. The user supplied `https://medi-pulse-gamma.vercel.app/` as the hosting project URL. A browser visit confirms that alias serves the same JavaScript bundle but renders **Website unavailable**: its hostname is absent from the company allowlist. The refinement adds only this confirmed exact alias to both host parser copies and the backend HTTPS origin list; arbitrary Vercel hosts remain refused. This fixes the code-level alias gap without changing provider settings. Backend updates still require the configured backend deployment before alias authentication can use that new origin.

## Competitor evidence and decisions

Reviewed official public pages, not authenticated clinical products. Desktop screenshots of Apollo, MocDoc, Clinicea and MediPulse were rendered in Edge and inspected. Practo's main/consult pages returned a bot challenge in this browser; its official patient documentation supports the functional comparison. Bahmni was reviewed through its official feature/module documentation. Vendor feature claims below are their published descriptions, not independent clinical, performance or compliance validation.

| Segment / source | Observed pattern | MediPulse decision |
|---|---|---|
| Connect: [Apollo doctor discovery](https://www.apollo247.com/specialties) | Prominent search, specialty choices and task-specific service navigation | Make Connect doctor discovery the first action; specialty links must use existing search and real availability. |
| Connect: [Practo patient consultation help](https://help.practo.com/practo-consult/faqs-for-practo-consult-patients/), [specialties](https://help.practo.com/practo-consult/list-of-specialities-for-online-consultation/) | Clearly described consultation channels, doctor selection and specialty discovery | Preserve explicit consultation mode, doctor profile, fee and confirmation. Keep independent doctor/community identity central to Connect. |
| Hospital SaaS: [MocDoc](https://mocdoc.com/) | Hospital, clinic, laboratory and pharmacy are explicit products; demo and login actions are separate | Hospital product entry should explain the OPD workflow, with staff login separate from registration. Broader modules remain visibly planned until delivered. |
| Practice SaaS: [Clinicea](https://clinicea.com/) | Product UI beside the pitch; EMR, scheduling and patient portal explain concrete tasks | Show an original, labeled care-workflow illustration rather than a generic box of feature text. Rebuild staff pages around tasks, queue states and patient context. |
| Hospital scope: [Bahmni features](https://www.bahmni.org/feature-list/), [laboratory](https://www.bahmni.org/laboratory/), [billing](https://www.bahmni.org/billing-and-accounting) | Registration, clinical care, laboratory and billing have connected but distinct responsibilities | Retain an OPD pilot first. Labs/pharmacy/inpatient expansion needs its own workflows, permissions and validation; a landing-page redesign cannot deliver those systems. |

## Chosen visual direction

- Company: strong typography, restrained warm white and deep teal, clear product choices, a care-journey illustration and contrasting Connect/hospital product panels.
- Connect: approachable patient layout, a real doctor search entry, specialty shortcuts, communities and independent doctor onboarding. Availability, ratings and fees remain actual API data on discovery/booking screens.
- Hospital SaaS public entry: a professional product overview explaining registration, booking, arrival, vitals and clinical queues; credible workflow illustration, direct staff sign-in and registration, current/planned scope.
- Branded hospital patient websites: hospital identity, specialties, doctor profiles, actual location/contact, clear booking CTA, visit tracking and maintained arrival instructions. Use configured imagery or a deliberate neutral fallback. No invented room, file location or precise wait estimate.
- Hospital operational screens: compact navigation, clear filters, readable queue/table density, patient context, status freshness and one primary next action. Keep patient marketing spacing out of high-frequency staff controls.

Use current tokens and Lucide icons, accessible contrast, visible keyboard focus and mobile touch targets. Original HTML/CSS product illustrations contain no personal data, available slots, live metrics, endorsements or copied competitor assets. No new visual dependency or domain purchase is needed.

## Work sequence after this refinement

1. Refresh company, Connect and hospital product entry pages; verify current live coverage and provide a public build-revision marker for subsequent deployment checks.
2. Continue P11 B: hospital discovery and patient/family records. Use the direction above and actual hospital data.
3. P11 C/D: doctor, reception and nursing workflows. P11 E: hospital administration, website editor and branded patient website body.
4. P12/P13: real room/file handoffs, visit timeline and live estimates. Then independent practice completeness and later laboratory/pharmacy expansion.

This entry-page refinement does not mark any remaining P11 batch complete or claim enterprise hospital management is shipped. Production database migrations and provider settings remain separate operational work.
