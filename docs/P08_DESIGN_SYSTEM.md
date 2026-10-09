# P08 — Visual system conventions

## Scope

The company landing page, Connect entry page, hospital patient visits and nursing station establish the visual direction. Product shells also wrap existing routes. Remaining route bodies keep their current implementation until P10/P11; this change is a foundation, not a completed migration of every page.

Company pages explain two existing products. Patient pages use generous spacing; staff pages use compact cards and tables. Data comes from current authorized APIs. Queue counts, statuses and visit dates are actual responses; missing dates/sessions are marked unavailable. No invented appointment availability, room directions, estimates, testimonials or performance statistics are shown. Demo payments remain labeled as demo credits.

## Tokens and shells

- `frontend/src/index.css` defines scoped `.mp-shell` / `.mp-*` styles: warm white canvas, white/slate surfaces, deep teal actions, restrained blue focus rings, readable type, borders, radii, spacing and shadows. Existing Tailwind styles remain available for later migrations.
- `ProductShell` selects `company`, `care`, `patient` or `staff` chrome. Company has responsive product navigation; care/staff reuse role-aware navigation; hospital patients retain direct home, visits and sign-in links on small screens. All have a keyboard skip link and the same Lucide heart mark.
- Patient content uses `.mp-page--patient`; staff uses `.mp-workspace-grid`, `.mp-summary-grid` and compact card/table spacing. Keep controls at least 44px high. Horizontal table scrolling stays inside its labeled focusable region.
- Dark surfaces and reduced motion are supported. Navigation collapses before links crowd at tablet widths. Prefer semantic sections, labeled forms and Lucide icons; decorative icons should be hidden from assistive technology.

## Hospital branding

`hospitalPalette` and `brandVariables` in `frontend/src/utils/visualSystem.js` accept only short/full hex colors and fall back to deep teal. They select black/white action text and derive readable light/dark text colors against canvas, card and tinted surfaces. Text pairs are checked at a minimum 4.5:1 contrast. `ProductShell` loads public hospital metadata with an abortable request and exposes `useHospitalBrand`; no extra private hospital fields are requested.

Use `--mp-accent` with `--mp-on-accent` for filled actions. Use `--mp-accent-ink` on neutral surfaces and `--mp-accent-soft` for tinted panels. Do not use a hospital's raw primary color as small text. These checks cover generated token pairs, not a claim that all legacy pages meet accessibility standards.

## Components

Import shared controls from `frontend/src/components/ui`:

| Component | Convention |
|---|---|
| `Button` | `variant`: primary, secondary, ghost, danger; `size="small"` for staff actions. Default type is button; specify submit explicitly. `to` is a router link, `href` an external link. Disabled links block navigation. |
| `Card` | Semantic section by default; use `as="form"` with an explicit submit handler where appropriate. Supply an accessible name when several sections need distinction. |
| `Field` | Always supply `label`; supports input/select/textarea through `as`. Hint/error text is associated with the control; errors set `aria-invalid`. Required fields show a marker and keep the native attribute. |
| `Dialog` | Controlled `open`/`onClose`, required title, native modal semantics and background inertness, body scroll lock, Tab/Shift+Tab wrapping, Escape/backdrop dismissal and focus restoration. Use `data-autofocus` on the first meaningful field. |
| `DataTable` | Required descriptive caption, stable row key, scoped headers and optional render functions. Empty rows produce an explicit empty state. |
| `StatusBadge` | Status text plus color/dot; use a known status or an explicit tone. Never convey state only through color. |
| `LoadingState`, `EmptyState`, `Banner` | Loading uses status semantics; errors use alert semantics and should offer an actionable retry. Info banners use status semantics. Keep previously fetched data visibly stale after refresh failure. |

Shared JSX components use plain React props with a targeted prop-types lint exemption, matching this repository's untyped React stack. This does not disable lint for other rules or application files.

Validate fields before submitting and focus the first invalid control. Walk-ins require a patient name; optional phone/age fields are validated when supplied. Blank vitals are omitted rather than converted into recorded zero measurements. Server validation, clinical authorization, revisions and booking idempotency remain authoritative.

## Verification and next migration

From `frontend`, run `npm run test:ui`, `npm run build` and the Playwright suite using the existing local fixture configuration. Browser coverage uses synthetic records and actual React routes; no patient database or provider is involved. The design checks render company, Connect, patient and staff screens at 360px, 768px and 1440px, capture screenshots, reject page overflow, and exercise keyboard navigation, modal focus, validation, brand contrast, reduced motion and retry recovery.

P09 establishes real scheduling/availability contracts. P10 should reuse these components for appointment and waiting-room workflows after P09; avoid inventing time slots in the UI. P11 migrates remaining page bodies in bounded batches. Full accessibility audits, bundle splitting, remaining legacy lint and production browser/provider checks are separate follow-up work. No backend schema migration or DNS change is needed for P08.
