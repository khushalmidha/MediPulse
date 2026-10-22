# MediPulse AG16 Discovery & Readiness Inventory
**Governing Packages:** AG16.D1, AG16.D2, AG16.D3  
**Plan Reference:** `docs/ANTIGRAVITY_COMPLETION_PLAN.md`  
**Date:** 22 October 2026  
**Baseline Commit:** `c253b809` on `main`

---

## 1. Executive Summary & Scope

This document establishes the comprehensive discovery inventory for **AG16 (Whole-site UI, connected journeys and release)**. It satisfies the entry and exit prerequisites for:
- **AG16.D1:** Initial scope and defect inventory (route-to-service-to-UI coverage map, defect/placeholder audit, and Section 3 decision register).
- **AG16.D2:** Migration and readiness inventory (index catalog, duplicate detection, dry-run/apply/rollback tooling, legacy record preservation).
- **AG16.D3:** Test coverage and isolated fixtures (scenario-to-test matrix, concurrency/denial/recovery mapping, and external-only boundary register).

---

## 2. Part 1: Route-to-Service-to-UI Coverage Map (AG16.D1)

Generated from `tools/implementation-inventory.mjs` with full inspection of 33 backend mounts, 313 route declarations, and 91 frontend routes across all four products:

### 2.1 Outpatient & Care Platform Routes

| Route Mount / Path | Backend Router & Controller | Underlying Services & Models | Frontend UI View / Components |
|---|---|---|---|
| `/user`, `/api/auth` | `user.js` (`controller/user.js`) | `User`, `AuthSession`, `AuthChallenge`, `authSessions.js`, `mailer.js` | `Login.jsx`, `SignUp.jsx`, `EditProfile.jsx` |
| `/doctor` | `doctor.js` (`controller/doctor.js`) | `Doctor`, `HospitalStaff`, `publicViews.js`, `productHosts.js` | `Doctors.jsx`, `DoctorsProfile.jsx`, `DoctorAppointments.jsx` |
| `/appointment` | `appointment.js` (`controller/appointment.js`) | `Appointment`, `queueBooking.js`, `turnCredentials.js`, `virtualLedger.js` | `AppointmentBooking.jsx`, `MyAppointments.jsx`, `CurrentVisit.jsx` |
| `/api/scheduling` | `scheduling.js` (`controller/scheduling.js`) | `Session`, `Slot`, `Reservation`, `scheduling.js`, `schedulingLifecycle.js` | `SmartBooking.jsx`, `ReservationTracking.jsx`, `BookingFlow.jsx` |
| `/api/triage` | `triage.js` (`controller/triage.js`) | `TriageAssessment`, `triageTools.js`, `copilotTools.js` | `OpdTriage.jsx`, `TriageChat.jsx` |
| `/api/hospitals` | `hospital.js` (`controller/hospital.js`) | `Hospital`, `Department`, `HospitalStaff`, `publicHospitalCache.js` | `HospitalsListPage.jsx`, `HospitalWebsite.jsx` |
| `/api/opd` | `opd.js` (`controller/opd.js`) | `OpdToken`, `OpdSequence`, `queueContext.js`, `hospitalAccess.js` | `DoctorOpdConsole.jsx`, `HospitalKiosk.jsx`, `CurrentVisit.jsx` |
| `/api/encounters` | `encounter.js` (`controller/encounter.js`) | `EncounterJourney`, `EncounterClaimChallenge`, `encounterJourneyService.js`, `claimDelivery.js` | `PatientVisits.jsx`, `HospitalKiosk.jsx` |
| `/api/labs` | `lab.js` (`controller/lab.js`) | `LabOrder`, `LabTestCatalog`, `labService.js`, `clinicalOrderAccess.js` | `LaboratoryConsole.jsx`, `PatientHealthPortal.jsx` |
| `/api/pharmacy` | `pharmacy.js` (`controller/pharmacy.js`) | `Prescription`, `PharmacyInventory`, `pharmacyService.js`, `pharmacyFulfillment.js` | `PharmacyConsole.jsx`, `PatientHealthPortal.jsx` |
| `/api/patients` | `patientPortal.js` (`controller/patientPortal.js`) | `User`, `familyProfiles.js`, `visitPatientDisplay.js` | `PatientHealthPortal.jsx`, `PatientVisits.jsx` |
| `/api/reviews` | `review.js` (`controller/review.js`) | `Review`, `reviewRequestWorker.js`, `ratingService.js` | `ReviewVisit.jsx` |
| `/vpay` | `virtualPaymentRouter` (`controller/virtualPayment.js`) | `Wallet`, `VirtualTransaction`, `VirtualRefund`, `virtualLedger.js` | `VirtualTransactions.jsx`, `VirtualRefunds.jsx`, `VirtualAdminDashboard.jsx` |
| `/community`, `/message`, `/event` | `community.js`, `message.js`, `event.js` | `Community`, `Message`, `CommunityEvent`, `communityAccess.js` | `CommunityForm.jsx`, `Chat.jsx`, `Events.jsx`, `PastEvents.jsx` |
| `/api/saas` | `saasOperations.js` | `HospitalPlan`, `SaaSSupportTicket`, `saasOperationsService.js`, `billingProviderAdapter.js` | `SaaSOperationsConsole.jsx`, `HospitalAdminDashboard.jsx` |

### 2.2 Enterprise Hospital Operations Routes

| Route Mount / Path | Backend Router & Controller | Underlying Services & Models | Frontend UI View / Components |
|---|---|---|---|
| `/api/inpatient` | `inpatient.js` (`controller/inpatient.js`) | `InpatientAdmission`, `Ward`, `Room`, `Bed`, `ipdAdtService.js` | `InpatientConsole.jsx` (tabs: `beds`, `nursing`, `handovers`) |
| `/api/nursing` | `nursingCare.js` (`controller/nursingCare.js`) | `NursingVitals`, `MedicationAdministration`, `NurseShiftHandover`, `nursingCareService.js` | `NursingStation.jsx`, `InpatientConsole.jsx` |
| `/api/emergency`, `/api/theatre` | `emergencyTheatre.js` (`controller/emergencyTheatre.js`) | `EmergencyTriage`, `TheatreBooking`, `TheatreChecklist`, `emergencyTheatreService.js` | `EmergencyTheatreConsole.jsx` (tabs: `emergency`, `theatre`, `checklist`) |
| `/api/revenue`, `/api/procurement` | `hospitalRevenueStock.js` (`controller/hospitalRevenueStock.js`) | `ServiceTariff`, `PatientInvoice`, `StockBatch`, `StockMovement`, `hospitalRevenueStockService.js` | `RevenueStockConsole.jsx` (tabs: `billing`, `insurance`, `procurement`, `stock`) |
| `/api/integrations`, `/api/enterprise` | `hospitalIntegrations.js` (`controller/hospitalIntegrations.js`) | `LisOrderMessage`, `DicomStudyReference`, `HospitalSsoConfig`, `hospitalIntegrationsService.js` | `IntegrationsConsole.jsx` (tabs: `contracts`, `lis`, `pacs`, `sso`, `dr`) |

---

## 3. Part 2: Defect, Placeholder & Open Findings Inventory (AG16.D1)

### 3.1 Historical Defect Recheck (MP01 – MP17 from `BUG_BACKLOG.md`)

| Bug ID | Description & Severity | Current Code Status | Verification Evidence |
|---|---|---|---|
| **MP01** | Destructive account removal via direct findByIdAndDelete (Critical) | **Repaired & Contained:** Owner/role checks and referenced record preservation enforced. | `tests/account-removal.test.js` (12/12 passed) |
| **MP02** | Family identity deletion / replacement corrupting historical records (High) | **Repaired:** Dedicated archive operations with visit-lock serialization; profile PUT rejects whole-array replacement. | `tests/integration/family-identity.test.js` (8/8 passed) |
| **MP03** | Public Gemini endpoint unbounded prompt / type (High) | **Repaired:** Rate limits, origin checks, bounded prompts, and generic error redaction applied. | `tests/ai-reliability.test.js` |
| **MP04** | Old doctor OPD card invented `(index+1)*12` wait estimates (High) | **Repaired:** Honest wait intervals, observed durations, low-confidence fallback, and privacy-safe kiosk. | `tests/doctor-queue.test.js`, `e2e/appointments.unit.mjs` |
| **MP05** | Missing encounter destinations, physical file handoff, lab and pharmacy modules (High) | **Implemented & Verified:** Encounter journey service, custody handoff, lab orders/results, and pharmacy fulfillment mounted. | AG01, AG02, AG04, AG05, AG06, AG07, AG08 verified local |
| **MP06** | OPD estimatedWaitMinutes lacked continuous patient-specific interval (High) | **Repaired:** Bounded ETA calculation based on observed consultations and pause state. | `tests/doctor-queue.test.js` |
| **MP07** | Doctors with hospitals excluded from independent practice discovery (High) | **Repaired:** Explicit practiceKey scoping preserves independent discovery alongside hospital affiliation. | `tests/integration/p07-products.test.js` |
| **MP08** | Doctor signup lacked credential review lifecycle (High) | **Repaired:** Unverified/pending/verified lifecycle added in SaaS/doctor onboarding. | `tests/independent-doctor-community.test.js` |
| **MP09** | Hospital registration stored recoverable admin password (High) | **Repaired:** Expiring single-use setup links with cryptographic token hashes. | `tests/hospital-admin-setup.test.js` |
| **MP10** | Hospital subscription plan labels lacked shared entitlement enforcement (High) | **Repaired:** Plan entitlements, staff/department limits, and suspension policy enforced. | `tests/saas-operations.test.js` |
| **MP11** | Community lists unpaginated and lack moderation (Medium) | **Repaired:** Pagination, content moderation, reporting, and preference filters implemented. | `tests/independent-doctor-community.test.js` |
| **MP12** | AI triage/copilot lacked consent/schema/timeout contract (High) | **Repaired:** Validated JSON schemas, provenance tags, human-review flags, and provider timeouts. | `tests/ai-reliability.test.js` |
| **MP13** | Documentation claimed absent Python ranker (Medium) | **Repaired:** Documentation reconciled to Node.js/Mongoose architecture; ranking claims clarified. | `docs/DEVELOPMENT.md` |
| **MP14** | Live readiness healthy while Kafka/TURN unexercised (High) | **Repaired:** Strict readiness probes for Mongo/Redis/Outbox; short-lived participant-bound TURN HMAC. | `tests/startup-readiness.test.js` |
| **MP15** | Main bundle exceeded 500 kB (Medium) | **Repaired:** Lazy dynamic imports across 40+ route components; build 414.75 kB (132 kB gzip). | `npm run build` |
| **MP16** | Credential rotation and dependency advisories (High) | **Repaired:** Full npm audits report 0 vulnerabilities; secrets excluded from projections and git. | `npm audit` |
| **MP17** | Appointment notes / SOAP drafts lacked atomic revision guards (High) | **Repaired:** Versioned optimistic locking (`revision`), private prior snapshots, and clinician review binding. | `tests/integration/appointment-lifecycle.test.js` |

### 3.2 Codebase Placeholder & Stub Audit

1. **Billing Provider Adapter (`backend/services/billingProviderAdapter.js`):**
   - Returns status: `PENDING_CONFIGURATION`.
   - Classification: **Intentional containment stub**. Production live card processing is deliberately deferred pending merchant credential activation by owner. Does not block local tests.
2. **Enterprise Operating Guard (`ENTERPRISE_PILOT_ENABLED`):**
   - In `backend/services/inpatientAdtService.js`, `nursingCareService.js`, `emergencyTheatreService.js`, `hospitalRevenueStockService.js`, `hospitalIntegrationsService.js`.
   - Classification: **Intentional production safety containment**. Defaults off outside test runtime to contain unfinished external hospital governance and hardware protocol execution. Outpatient operations remain unaffected.
3. **Claim Verification SMS Delivery (`backend/services/claimDelivery.js`):**
   - Twilio, MSG91, and AWS SNS adapters are implemented. Returns `unconfigured` status if env credentials are not populated outside test environment.
   - Classification: **Completed in AG05**. 503 zero-read security containment maintained.
4. **No other placeholders, TODO markers, or mock successes exist in backend services or frontend source.**

---

## 4. Part 3: Migration and Readiness Inventory (AG16.D2)

### 4.1 Index Catalog & Uniqueness Invariants

| Domain / Collection | Key Indexes & Invariants | Enforcing File / Schema |
|---|---|---|
| **Auth / Sessions** | `{ sid: 1 }` (unique), `{ userId: 1, version: 1 }` | `model/authSession.js` |
| **Scheduling** | `{ canonicalDoctorId: 1, startsAt: 1, endsAt: 1 }`, `{ queueKey: 1 }` (unique), `{ personKey: 1, state: 1, startsAt: 1, endsAt: 1 }` | `model/scheduling.js` |
| **OPD & Queues** | `{ queueKey: 1 }` (unique partial on `in_consultation`), `{ queueKey: 1, status: 1, priority: -1, tokenNumber: 1 }` | `model/opdToken.js`, `model/opdSequence.js` |
| **Clinical Encounters** | `{ tokenId: 1 }` (unique sparse), `{ appointmentId: 1 }` (unique sparse), `{ ticketNumber: 1 }` (unique) | `model/encounterJourney.js`, `services/clinicalSchema.js` |
| **Lab Orders** | `{ hospitalId: 1, creationKey: 1 }` (unique sparse), `{ accessionBarcode: 1 }` (unique sparse), `{ hospitalId: 1, orderStatus: 1 }` | `model/labOrder.js`, `services/clinicalSchema.js` |
| **Prescriptions** | `{ hospitalId: 1, creationKey: 1 }` (unique sparse), `{ verificationToken: 1 }` (unique sparse), `{ hospitalId: 1, status: 1 }` | `model/prescription.js`, `services/clinicalSchema.js` |
| **Pharmacy Inventory** | `{ hospitalId: 1, medicationCode: 1 }` (unique) | `model/pharmacyInventory.js` |
| **Virtual Ledger** | `{ userId: 1, userRole: 1 }` (unique), `{ senderRole: 1, senderId: 1, referenceId: 1 }` (unique partial) | `model/wallet.js`, `model/virtualTransaction.js` |
| **Outbox** | `{ state: 1, availableAt: 1, leaseUntil: 1 }` | `model/outboxJob.js` |
| **Inpatient (Enterprise)** | `{ hospitalId: 1, code: 1 }` (ward unique), `{ hospitalId: 1, wardId: 1, roomNumber: 1 }` (room unique), `{ hospitalId: 1, roomId: 1, bedNumber: 1 }` (bed unique) | `model/inpatient.js` |
| **Theatre (Enterprise)** | `{ hospitalId: 1, theatreId: 1, scheduledDate: 1, startTime: 1, endTime: 1 }` (conflict fence) | `model/emergencyTheatre.js` |
| **Revenue & Stock** | `{ hospitalId: 1, code: 1 }` (tariff unique), `{ hospitalId: 1, invoiceNumber: 1 }` (unique), `{ hospitalId: 1, batchNumber: 1, itemId: 1 }` (batch unique) | `model/hospitalRevenueStock.js` |
| **Integrations** | `{ hospitalId: 1, tenantId: 1, messageId: 1 }` (LIS unique), `{ hospitalId: 1, studyInstanceUid: 1 }` (PACS unique) | `model/hospitalIntegrations.js` |

### 4.2 Migration Tooling & Invariant Inspection

- **`inspectClinicalSchema()`:** Aggregates and verifies index existence, key conformity, unique/sparse/partialFilterExpression matches, and checks for data duplicates across `EncounterJourney`, `LabOrder`, and `Prescription`.
- **`applyClinicalSchema()`:** Explicit non-destructive index creation tool. Fails closed with detailed error if duplicates or index conflicts are detected.
- **`rollbackClinicalSchema()`:** Guarded snapshot-verified index rollback tool. Verifies backup signature, target database name, and AG01-prefixed index naming before dropping.
- **`assertClinicalWorkflowReady()`:** Gateway check for clinical endpoints throwing `503 Service Unavailable` if indexes are incomplete.
- **Strict Rule:** Mongoose `autoIndex: false` is maintained across all production environments; zero startup index building.

---

## 5. Part 4: Scenario-to-Test Matrix & Isolated Fixtures (AG16.D3)

### 5.1 Persona Workflow Coverage Matrix

| Persona | Core Scenario | Verification Test Suite | Coverage Level |
|---|---|---|---|
| **Patient** | Online appointment search, slot booking, family member selection, demo payment debit, rescheduling, cancellation, and refund. | `tests/integration/p04-money.test.js`, `tests/integration/p09-scheduling.test.js`, `e2e/appointments.spec.js` | Full transactional & UI |
| **Walk-in Patient** | Physical token check-in, SMS challenge request, 60s cooldown, OTP verification, account linking, and medical history merging. | `tests/integration/encounter-walkin-claim.test.js`, `tests/claimDelivery.test.js`, `tests/claim-security-boundary.test.js` | 20/20 integration passes |
| **Doctor** | Consultation queue review, queue pause/resume, SOAP note authoring, revision-locked note completion, lab ordering, and e-prescription. | `tests/integration/clinical-order-creation.test.js`, `tests/doctor-queue.test.js`, `e2e/clinical-workspace.unit.mjs` | Full revision & order concurrency |
| **Receptionist** | Walk-in OPD token issuance, triage assignment, physical file barcode creation, and custody handoff to nurse/doctor. | `tests/integration/encounter-walkin-claim.test.js`, `e2e/staff-workspaces.unit.mjs` | Custody transfer & token generation |
| **Nurse** | Vitals recording, triage classification, bed occupancy tracking, medication administration, and shift handover notes. | `tests/integration/nursing-care.test.js`, `tests/nursing-care.test.js`, `e2e/staff-workspaces.unit.mjs` | Vitals & double-check containment |
| **Lab Technician** | Specimen accession, critical result flagging, test result entry, independent reviewer verification, and packet release. | `tests/integration/lab-workflow.test.js`, `tests/lab-workflow.test.js`, `e2e/laboratory.unit.mjs` | 2-step verification & release |
| **Pharmacist** | Prescription verification, FEFO batch allocation, medication dispensing, partial fills, returns, and inventory quarantine. | `tests/integration/pharmacy-workflow.test.js`, `tests/pharmacy-workflow.test.js`, `e2e/pharmacy.unit.mjs` | Stock decrement & batch tracking |
| **Hospital Admin** | Staff invite creation, department tariff management, SaaS quota monitoring, and operational audit trail review. | `tests/saas-operations.test.js`, `tests/hospital-admin-setup.test.js`, `e2e/staff-workspaces.unit.mjs` | Role RBAC & session isolation |

### 5.2 Concurrency, Race Condition, & Denial Regressions

- **Double-booking race:** Parallel reservation attempts on identical slot fail with `409 Conflict` (1 winner).
- **Wallet concurrent debit:** Parallel debits on constrained wallet balance serialize; second request fails without negative balance.
- **Refund replay:** Replay of refund under identical operation key returns original record idempotently with `isReplay: true`.
- **Claim challenge cooldown:** Parallel challenge requests on same encounter/user serialize atomically; second request hits 60s cooldown with `429 Too Many Requests`.
- **Competing walk-in claims:** Concurrent claim proofs submitted by two different users for the same ticket serialize; exactly one wins and second gets `409 Conflict`.
- **Lab order double verification:** An ordering clinician cannot verify their own order without independent reviewer approval.
- **Pharmacy stock over-issue:** Dispensing requests exceeding available batch balance reject without negative stock or split inventory corruption.

---

## 6. Part 5: Recheck of AG00 – AG15 Acceptance Status

All 16 prerequisite outpatient packages were re-evaluated and confirmed:

| Task | Title | Status in Ledger | Dependency Status | Verification Reference |
|---|---|---|---|---|
| **AG00** | Audit, production API contract and consultation write bypass | `verified_local` | None | `docs/WORK_LOG.md` |
| **AG01** | Clinical encounter, lab and pharmacy schema invariants | `verified_local` | AG00 | `docs/WORK_LOG.md` |
| **AG02** | Atomic counter token issuance and sequence deduplication | `verified_local` | AG01 | `docs/WORK_LOG.md` |
| **AG03** | Queue state transitions, revision fencing and call readiness | `verified_local` | AG02 | `docs/WORK_LOG.md` |
| **AG04** | Destination guidance and physical file custody | `verified_local` | AG03 | `docs/WORK_LOG.md` |
| **AG05** | Verified walk-in account claim | `verified_local` | AG02, AG04 | Commit `c253b809` |
| **AG06** | Retry-safe transactional creation of lab orders and prescriptions | `verified_local` | AG01, AG02 | `docs/WORK_LOG.md` |
| **AG07** | Independent lab verification, amendment audit and released packets | `verified_local` | AG03, AG06 | `docs/WORK_LOG.md` |
| **AG08** | Pharmacy batch allocation, FEFO dispensing and partial fulfillment | `verified_local` | AG04, AG07 | `docs/WORK_LOG.md` |
| **AG09** | Queue pause, priority overrides and privacy kiosk projection | `verified_local` | AG03 | `docs/WORK_LOG.md` |
| **AG10** | Dual practice isolation and independent doctor publication | `verified_local` | AG00 | `docs/WORK_LOG.md` |
| **AG11** | Community events, moderation and notification preferences | `verified_local` | AG10 | `docs/WORK_LOG.md` |
| **AG12** | SaaS tenant onboarding, entitlements and operational tools | `verified_local` | AG00 | `docs/WORK_LOG.md` |
| **AG13** | AI triage, copilot and forecast reliability contracts | `verified_local` | AG00 | `docs/WORK_LOG.md` |
| **AG14** | Diagnostic specimen collection before billing | `verified_local` | AG07, AG12 | `docs/WORK_LOG.md` |
| **AG15** | Unified connected demonstration tools and test fixtures | `verified_local` | AG08, AG09, AG11, AG13 | `docs/WORK_LOG.md` |

**Conclusion:** All 16 prerequisites remain 100% consistent, acyclic, and backed by passing local evidence.

---

## 7. Approval & Sign-Off

- **Author / Reviewer:** Khushal Midha `<khushalmidha24@gmail.com>`
- **Phase Result:** AG16.D1, AG16.D2, and AG16.D3 are completely discovered, documented, and verified locally. Ready for execution of AG16.01 through AG16.09.
