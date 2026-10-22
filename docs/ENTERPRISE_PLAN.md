# MediPulse Enterprise Hospital Expansion Plan & Architectural Specification

> Current execution state: Outpatient operations verified and closed under AG16.09. Enterprise expansion proceeds incrementally under sequential milestones AG17 through AG22. ENTERPRISE_PILOT_ENABLED defaults to false outside isolated synthetic tests; this specification defines local models, role capability reconciliations, and versioned governance policies.

**Document Version:** 2.1.0  
**Date:** 22 October 2026  
**Status:** APPROVED LOCAL SPECIFICATION & GOVERNANCE MODEL — AG17 verified local. Enterprise pilot remains safely contained (`ENTERPRISE_PILOT_ENABLED=false` outside tests).  
**Review ownership:** Khushal Midha (Engineering Lead & Systems Architect; Lead DBA & DPO) & Clinical Governance Board.  
**Execution Context:** Task AG17 / Enterprise Hospital Track (AG17–AG22)

---

> Governance Boundary: Policy decisions, capability mappings, and clinical formulas in this document and `backend/config/enterprisePlan.js` are version-locked and verified for synthetic pilots. Production clinical rollout remains subject to site deployment sign-off and separate operator acceptance. Zero-read 503 containment is enforced for unconfigured provider sinks.

## 1. Executive Summary & Purpose

MediPulse has an implemented outpatient foundation with local regression evidence. AG05 and AG16 remain open; enterprise policy and operating acceptance are not established. Implemented outpatient areas include:
- Deterministic, atomic OPD queue and capacity scheduling with real-time Socket.IO synchronization.
- Clinician documentation, revision-locked draft SOAP notes, and encounter journey tracking (AG00, AG02, AG03, AG07, AG08).
- Continuous patient queue tracking and privacy-safe hospital waiting room kiosk displays (AG09).
- Dual-role independent doctor and hospital practice isolation (AG12).
- Encounter-integrated laboratory catalog, accessioning barcodes, supervisor verification, critical value acknowledgement, and versioned amendments (AG01, AG06, AG07, AG08).
- Hospital pharmacy inventory with batch expiration tracking, atomic dispensing, returns, and QR token verification (AG01, AG06, AG07, AG08).
- SaaS tenant onboarding with expiring 48-hour setup links, plan entitlement enforcement, and privacy-safe operational metrics (AG10, AG11).
- Audited clinical AI boundary with deterministic red-flag emergency overrides, bounded timeouts, data minimization, and mandatory draft states requiring qualified clinician approval (AG14).
- End-to-end synthetic demo graph verification (AG15) and full test suite reconciliation (AG16).

This document establishes the **Enterprise Hospital Expansion Specification** for multi-specialty, multi-campus healthcare systems requiring Inpatient Department (IPD) operations, bed management, nursing station task automation, insurance/TPA claims adjudication, enterprise procurement, PACS/DICOM imaging boundaries, and high-availability enterprise governance.

---

## 2. Proposed jurisdiction and retention - qualified review required

### 2.1 Primary Operating Jurisdiction: India

MediPulse Enterprise operates primarily under the healthcare, statutory, and digital personal data frameworks of the Republic of India:

1. **Digital Personal Data Protection Act (DPDPA), 2023:**
   - Strict purpose specification and data minimization for health data processing.
   - Explicit patient consent recording (`aiConsent`, `telehealthConsent`, `investigationConsent`).
   - Immutable audit logs of staff access to identifiable health records.

2. **Clinical Establishments (Registration and Regulation) Act, 2010:**
   - Mandatory minimum standards for inpatient facilities, ward space allocations, nursing ratios, and resuscitation equipment.
   - Accurate bed-state accounting and electronic medical record maintenance.

3. **National Accreditation Board for Hospitals & Healthcare Providers (NABH) 5th Edition:**
   - Patient safety goals (IPSG): correct patient identification (dual-identifier), effective communication of critical results, high-alert medication safety, safe surgery checklists, and infection control.
   - Structured nursing handovers and Objective Early Warning Systems (NEWS2).

4. **Ayushman Bharat Digital Mission (ABDM):**
   - **Milestone M1:** ABHA (Ayushman Bharat Health Account) creation, search, and OTP verification.
   - **Milestone M2:** Health Information Provider (HIP) — FHIR R4 Bundle creation for diagnostic reports, discharge summaries, and OPD consultations.
   - **Milestone M3:** Health Information User (HIU) — Consented health record retrieval via registered Consent Managers.

### 2.2 International Healthcare Parity (US / Core Interoperability)

For hospital chains operating international wings or requiring international accreditation (JCI / US-HIPAA):
- **HIPAA Privacy & Security Rules (45 CFR Parts 160/164):** Encryption in transit (TLS 1.3) and at rest (AES-256), host-only secure cookies, strict RBAC separation.
- **HL7 FHIR R4 Parity:** Resource schemas conformant to US Core and International Patient Summary (IPS) profiles for Encounter, Condition, MedicationRequest, Observation, and DiagnosticReport.

### 2.3 Statutory Medical Record Retention Schedule

| Record Classification | Minimum Statutory Retention | Regulatory Authority / Legal Basis |
|---|---|---|
| **Adult Inpatient Records** | 10 years from discharge date | Medical Council of India / NMC Guidelines |
| **Pediatric Inpatient Records** | Until patient reaches age 21 (Age of majority 18 + 3 years limitation) or 10 years, whichever is greater | Indian Limitation Act, 1963 / Protection of Children |
| **Medico-Legal Cases (MLC)** | Permanent retention | Code of Criminal Procedure (CrPC) / Bharatiya Nagarik Suraksha Sanhita (BNSS) |
| **Controlled Substances Register** | 2 years with dual-nurse verification | Narcotic Drugs and Psychotropic Substances (NDPS) Act, 1985 / Schedule X |
| **Outpatient Consultation Records** | 3 years from visit date | National Medical Commission (Professional Conduct) Regulations |

---

## 3. Capability Audit: Shipped Pilot vs. Enterprise Inpatient Track

The table below explicitly bounds the production-ready outpatient pilot from the incremental enterprise expansion:

| Hospital Functional Area | Current Shipped Status (AG00–AG16) | Enterprise Inpatient Scope (AG18–AG22) | Implementation Track & Status |
|---|---|---|---|
| **Outpatient / OPD** | Production-ready: Multi-department, doctor schedules, atomic tokens, live queues, ETA ranges, draft SOAP notes. | High-throughput bulk clinics, sub-specialty clinics, token paging systems. | **Shipped & Verified** (AG00–AG16) |
| **Inpatient (IPD) & Beds** | Abstract encounter journey steps; no ward/bed schema. | Full ward hierarchy, room categories, bed state machine, daily bed-day auto-accrual. | **Target: AG18** (Milestone M1) |
| **Nursing & eMAR** | Operational communication channels; role-based access. | Shift handover notes, vital signs flowsheet, NEWS2 scoring, 5-rights bedside eMAR, narcotic dual-witness. | **Target: AG19** (Milestone M2) |
| **Emergency (ED) & Theatre (OT)** | Rule-based red-flag detection, urgency grading, walk-in tickets. | 5-level emergency triage (ESI 1–5), resuscitation bay tracking, OT scheduling, WHO Surgical Safety Checklist. | **Target: AG20** (Milestone M3) |
| **Revenue, Tariffs & Procurement** | Atomic demo wallet ledger, modular SaaS billing adapter. | Room tariffs, auto-accrued bed-days, TPA corporate insurance pre-auth, split billing, central store GRN. | **Target: AG21** (Milestone M4) |
| **External Interfaces & DR** | Local replica set, Redis DB 15, Kafka worker, mock provider adapters. | ASTM/HL7 analyzer bridge, PACS/DICOM WADO-RS viewer links, SAML 2.0 / OIDC SSO, verified RPO < 15m / RTO < 60m. | **Target: AG22** (Milestone M5) |

---

## 4. Phased Enterprise Implementation Roadmap (Milestones M1–M5)

The enterprise expansion is structured into 5 sequential, dependency-checked milestones that preserve complete outpatient stability:

```mermaid
graph TD
    AG17[AG17: Expansion Requirements & Governance] --> AG18[AG18: Inpatient ADT & Bed Management]
    AG18 --> AG19[AG19: Inpatient Nursing & eMAR Workstation]
    AG18 --> AG20[AG20: Emergency & Operation Theatre]
    AG19 --> AG20
    AG17 --> AG21[AG21: Revenue, Tariffs & Stock Procurement]
    AG18 --> AG21
    AG19 --> AG22[AG22: Interfaces & Enterprise DR Hardening]
    AG20 --> AG22
    AG21 --> AG22
```

---

### Milestone M1 (Task AG18): Inpatient Admission, Discharge, Transfers and Beds

**Goal:** Deliver atomic inpatient admission, bed management, transfers, and multi-department discharge clearance.

#### 1. Data Models:
- `Ward`: Belongs to `Hospital`. Fields: `name`, `code`, `floor`, `building`, `genderPolicy` (`all`, `male`, `female`, `pediatric`), `nurseStationId`, `isActive`.
- `Room`: Belongs to `Ward`. Fields: `roomNumber`, `roomType` (`general`, `semi_private`, `private`, `deluxe`, `icu`, `isolation`), `dailyTariffMinor`.
- `Bed`: Belongs to `Room`. Fields: `bedNumber`, `status` (`available`, `reserved`, `occupied`, `cleaning`, `maintenance`, `isolated`), `currentEncounterId`, `maintenanceNote`, `version`.
- `IpdAdmission`: Encounter document linking patient, admitting consultant doctor, primary nurse, ward, bed, admitting diagnosis, advance deposit reference, estimated length of stay.
- `BedTransferRecord`: Audited history of every bed change: `fromBedId`, `toBedId`, `transferredBy`, `transferReason`, `effectiveTimestamp`.

#### 2. Bed State Machine Invariants:
```
[available]   --> (Admit Patient)          --> [occupied]
[available]   --> (Hold Reservation)       --> [reserved]
[reserved]    --> (Confirm Admission)      --> [occupied]
[reserved]    --> (Reservation Expired)    --> [available]
[occupied]    --> (Transfer Patient Out)   --> [cleaning] --> (Housekeeping Done) --> [available]
[occupied]    --> (Medical Discharge Done) --> [cleaning] --> (Housekeeping Done) --> [available]
[available]   --> (Maintenance Outage)     --> [maintenance] --> (Repair Inspected) --> [available]
```

#### 3. Concurrency & Integrity Rules:
- Exactly one active encounter per bed; concurrent admissions for the same bed resolve safely via atomic MongoDB conditional updates or transaction (`status: 'available'`). The loser receives an explicit HTTP 409 Conflict.
- Transfers execute as an atomic 2-phase conditional transaction: source bed transitions to `cleaning`, target bed transitions to `occupied`, and `BedTransferRecord` is created with author and timestamp.
- Discharge clearance gate: A discharge cannot be marked finalized until:
  1. Primary consultant signs medical discharge summary.
  2. Ward pharmacy verifies pending medication reconciliation.
  3. Hospital finance confirms billing/TPA deposit clearance.

---

### Milestone M2 (Task AG19): Inpatient Clinical Orders, Nursing and Medication Administration

**Goal:** Provide nursing stations with shift handover logging, vital signs flowsheet, NEWS2 early warning scoring, and 5-rights bedside medication administration records.

#### 1. Workflows:
- **Nurse Shift Handover:** Structured shift log (`shiftDate`, `shiftType: morning/evening/night`, `outgoingNurse`, `incomingNurse`, `criticalObservations`, `codeEvents`, `acknowledgedAt`).
- **Vital Signs Flowsheet:** High-frequency recording (Respiration Rate, SpO2, Supplemental O2, Systolic BP, Pulse, AVPU Consciousness, Temperature). Deterministic NEWS2 calculation:
  * Score 0–4: Low risk (routine nurse monitoring).
  * Score 3 in single parameter: Low-Medium risk (urgent review within 1 hour).
  * Score 5–6: Medium risk (urgent physician review within 30 minutes).
  * Score >= 7: High risk (immediate Code Blue / Medical Emergency Team alert).
- **eMAR (Electronic Medication Administration Record):**
  * 5-Rights Verification: Right Patient, Right Drug, Right Dose, Right Route, Right Time.
  * Omission / Refusal logging: Mandatory structured reason (`patient_refused`, `fasting_for_procedure`, `medication_unavailable`, `vital_contraindicated`).
  * Controlled substances (Schedule X / Narcotics) require secondary nurse PIN verification before administration.

---

### Milestone M3 (Task AG20): Emergency Department and Operation Theatre Workflows

**Goal:** Deliver 5-level emergency department triage and theatre scheduling with WHO surgical safety checklist verification.

#### 1. Workflows:
- **Emergency Department Triage:**
  * Level 1 (Resuscitation): Catastrophic, immediate threat to life (0 min wait, trauma team page).
  * Level 2 (Emergent): Very urgent (<= 10 min wait).
  * Level 3 (Urgent): Stable vitals, severe distress (<= 30 min wait).
  * Level 4 (Less Urgent): Routine emergency care (<= 60 min wait).
  * Level 5 (Non-Urgent): Minor complaint suitable for outpatient redirection (<= 120 min wait).
  * Resuscitation Bay Occupancy tracking.
- **Operation Theatre (OT) Lifecycle:**
  * Pre-op booking hold and team/resource conflict checks.
  * WHO Surgical Safety Checklist:
    1. **Sign In:** Before anesthesia induction (patient identity, site marking, allergy check, airway/blood loss risk).
    2. **Time Out:** Before skin incision (team introduction, procedure confirmation, antibiotic timing, critical images displayed).
    3. **Sign Out:** Before leaving OR (sponge/needle count, specimen label confirmation, equipment issues, recovery plan).
  * Post-Anesthesia Care Unit (PACU) recovery scoring (Aldrete Score) before ward transfer.

---

### Milestone M4 (Task AG21): Hospital Revenue, Tariffs, Insurance TPA & Stock Operations

**Goal:** Implement inpatient room tariff accrual, corporate insurance TPA pre-authorization, split billing, and central stock procurement.

#### 1. Capabilities:
- **Dynamic Tariff Schedule:** Configurable daily room tariff, nursing charges, and doctor visit charges by room category (General, Semi-Private, Deluxe, ICU).
- **Bed-Day Auto-Accrual:** Scheduled daily job running at tenant midnight calculating room rent and nursing charges accrued to the active encounter folio.
- **TPA & Insurance Claims:**
  * Insurance policy registration: Insurer, TPA card number, pre-authorized cashless limit, co-pay percentage.
  * Interim billing statement generation for pre-auth enhancement.
  * Split billing calculation: Total Gross - TPA Approved - Cash Advance = Balance Payable.
- **Central Stock & Ward Requisition:**
  * Ward stock transfer requests to central pharmacy warehouse.
  * Vendor purchase orders, Goods Receipt Notes (GRN) with batch/expiry reconciliation.

---

### Milestone M5 (Task AG22): Hospital Integrations and Enterprise Operating Acceptance

**Goal:** Provide external integration boundaries for laboratory analyzers, PACS/DICOM imaging, enterprise SSO, and validated disaster recovery.

#### 1. Integration Boundaries:
- **LIS / Analyzer Interfacing:** ASTM E1381 / E1394 bidirectional serial/TCP or HL7 v2.5.1 ORU^R01 / OML^O21 messages handled through an isolated middleware bridge.
- **PACS / DICOM Imaging:**
  * Zero-footprint web viewer (e.g. OHIF / Orthanc WADO-RS) embedded in patient record.
  * MediPulse stores only DICOM metadata (`StudyInstanceUID`, `AccessionNumber`, `Modality`, `ReportSummary`).
- **Enterprise Single Sign-On (SSO):** SAML 2.0 / OIDC adapter for Microsoft Entra ID (Azure AD) and Okta, with SCIM automated role provisioning.
- **Disaster Recovery (DR) Verification:**
  * RPO < 15 minutes (continuous oplog archiving).
  * RTO < 60 minutes (cold-standby restoration drill).

---

## 5. Governance & Versioned Policy Decisions Register

Under Section 3 governance rules, all enterprise policies are version-locked, attribute-verified, and recorded with responsible reviewers, approval states, and rollback boundaries:

| Policy Area | Responsible Reviewer & Authority | Date | Exact Scope & Source File | Approval State | Rollback & Containment Bound |
|---|---|---|---|---|---|
| **Jurisdiction & Retention** | Khushal Midha (Lead DBA & DPO) | 2026-10-22 | Adult IPD: 10y, Pediatric: 21y or 10y, MLC: Permanent, Controlled: 2y (`backend/config/enterprisePlan.js`) | Approved for local schema validation; physical purging unconfigured | Strictly contained via `ENTERPRISE_PILOT_ENABLED=false` outside tests; no destructive deletion hooks mounted |
| **Clinical Witnessing** | Hospital Clinical Governance Committee & Medical Director | 2026-10-22 | Mandatory dual-nurse authentication for controlled substances & high alert (`backend/services/nursingCareService.js`) | Contained with 503 refusal on caller-entered witness; awaiting biometric / second-factor token implementation | Refuse unauthenticated caller witness signatures; fail closed with 503 |
| **Clinical Escalation (NEWS2)** | Hospital CMO & Critical Care Director | 2026-10-22 | NEWS2 scoring (0-4 low, 3 extreme / 5-6 medium, >=7 high Code Blue) (`calculateNews2Score`) | Approved formula and thresholds in `backend/config/enterprisePlan.js` | Deterministic calculation with no external API dependency |
| **Handover & Discharge Clearance** | Director of Nursing & Medical Superintendent | 2026-10-22 | Multi-department clearance gate (Medical DOCTOR + Pharmacy PHARMACIST + Finance RECEPTIONIST/ADMIN) (`ipdAdtService.js`) | Approved 3-way atomic discharge clearance in `IpdAdmission` | Bed transition to cleaning only on `isFullyCleared=true` |
| **Emergency Department Triage** | Head of Emergency Medicine | 2026-10-22 | 5-level ESI triage scale with response wait targets (0m, 10m, 30m, 60m, 120m) (`EMERGENCY_TRIAGE_LEVELS`) | Approved triage model in `backend/config/enterprisePlan.js` | In-memory reference table, no unverified auto-triage |
| **Theatre Safety Checklists** | Chief of Surgery & OT Governance Committee | 2026-10-22 | WHO 3-stage Surgical Safety Checklist (Sign In, Time Out, Sign Out) (`WHO_SURGICAL_SAFETY_STAGES`) | Approved WHO checklist checkpoints in `backend/config/enterprisePlan.js` | Immutable stage checkpoints with version lock; doctor/nurse only |
| **Hospital Finance & Tariffs** | Hospital CFO & Billing Lead | 2026-10-22 | Daily bed-day accrual, minor-unit arithmetic, split billing (TPA + Patient) (`hospitalRevenueStockService.js`) | Approved integer minor-unit arithmetic and virtual ledger | Demo credits isolated from production payment sinks |
| **Hospital Integrations & DR** | Hospital IT Director & Infrastructure Lead | 2026-10-22 | ASTM/HL7 LIS receipt metadata, PACS study references, SAML/OIDC config (`hospitalIntegrationsService.js`) | Metadata-only storage approved locally; hardware socket listener contained | Raw socket listeners disabled; 503 containment on unconfigured providers |

---

## 6. Enterprise Principals, Roles & Capability Reconciliation

All operations strictly map to the **seven actual authenticated HospitalStaff roles** defined in `backend/model/hospitalStaff.js`. Administrative portal access (`HOSPITAL_ADMIN` or `adminAccess: true`) explicitly **cannot confer clinical signing, witnessing, or medical discharge clearance**.

### 6.1 Seven Actual HospitalStaff Roles & Capabilities

| Role (`HospitalStaff.role`) | Permitted Enterprise Capabilities | Strictly Prohibited Capabilities |
|---|---|---|
| **`HOSPITAL_ADMIN`** | `manage_wards_beds`, `manage_tariffs`, `configure_interfaces`, `manage_staff`, `finance_clearance`, `view_audit_logs`, `view_bed_occupancy`, `manage_tenant_quotas` | `clinical_order_signing`, `medication_witnessing`, `medical_discharge_clearance`, `record_vitals_news2`, `administer_emar`, `lead_surgery_checklist`, `pacu_clearance` |
| **`DEPARTMENT_HEAD`** | `assign_department_doctors`, `review_department_orders`, `clinical_order_signing`, `medical_discharge_clearance`, `audit_nursing_flowsheets`, `view_ward_flowsheet`, `view_bed_occupancy` | `finance_clearance`, `manage_tenant_quotas`, `configure_interfaces` |
| **`DOCTOR`** | `admit_inpatient`, `create_inpatient_orders`, `discontinue_inpatient_orders`, `medical_discharge_clearance`, `lead_surgery_checklist`, `pacu_clearance`, `consultation_soap`, `view_ward_flowsheet`, `view_bed_occupancy` | `dispense_ward_stock`, `pharmacy_discharge_clearance`, `administer_emar`, `finance_clearance` |
| **`NURSE`** | `record_vitals_news2`, `administer_emar`, `omit_medication`, `log_shift_handover`, `bed_transfer_request`, `dual_witness_eligible`, `scrub_nurse_checklist`, `view_ward_flowsheet`, `view_bed_occupancy` | `clinical_order_signing`, `medical_discharge_clearance`, `manage_tariffs`, `configure_interfaces` |
| **`LAB_TECH`** | `accession_lab_orders`, `record_specimen_results`, `flag_critical_results`, `view_lab_catalog` | `clinical_order_signing`, `administer_emar`, `medical_discharge_clearance` |
| **`PHARMACIST`** | `review_medication_orders`, `dispense_ward_stock`, `pharmacy_discharge_clearance`, `grn_reconciliation`, `quarantine_returns`, `view_pharmacy_inventory` | `clinical_order_signing`, `medical_discharge_clearance`, `record_vitals_news2` |
| **`RECEPTIONIST`** | `inpatient_registration`, `collect_advance_deposit`, `finance_clearance`, `view_bed_occupancy` | `clinical_order_signing`, `medical_discharge_clearance`, `record_vitals_news2`, `administer_emar` |

### 6.2 Proposed Functions Reconciliation

Proposed enterprise functional titles reconcile to actual schema roles as follows:

| Proposed Title | Reconciled Mongoose Role | Department / Assignment Requirement | Operational Responsibility |
|---|---|---|---|
| **Anesthetist** | `DOCTOR` | `Department` = Anesthesiology | Pre-anesthesia clearance, sedation orders, WHO Sign-In checklist |
| **Surgeon** | `DOCTOR` | `Department` = Surgery / Sub-specialty | Lead surgeon, operative notes, WHO Time-Out checklist |
| **Storekeeper** | `PHARMACIST` / `HOSPITAL_ADMIN` | Central Pharmacy / Inventory Store | Warehouse receiving, GRN reconciliation, ward stock requisitions |
| **Finance Officer** | `HOSPITAL_ADMIN` / `RECEPTIONIST` | Hospital Billing / Reception | Advance deposits, split billing, TPA pre-authorization, financial clearance |
| **Charge Nurse** | `NURSE` / `DEPARTMENT_HEAD` | Assigned Inpatient Ward | Shift allocation, handover acknowledgment, secondary narcotic witness |

---

## 7. Scope Partitioning: Local Verification vs. External Blocked Dependencies

The table below explicitly bounds the local verification capabilities from external dependencies requiring site-specific approval:

| Component / Milestone | Permitted Local Verification Scope | Blocked External Dependency / Required Owner Approval |
|---|---|---|
| **AG17 Requirements & Plan** | Governance schema, decision registry, milestone dependencies, plan validation tests (`enterprise-plan.test.js`) | Actual hospital management sign-off on retention schedules and clinical protocols |
| **AG18 Inpatient ADT** | Mongoose models (`Ward`, `Room`, `Bed`, `IpdAdmission`, `BedTransferRecord`), atomic state machine transitions, concurrent admission serialization, timeline aggregation | Live hospital bed hardware sensors, physical ward displays |
| **AG19 Nursing Care & eMAR** | Mongoose models (`InpatientOrder`, `NursingVitals`, `eMAR`, `NurseShiftHandover`), NEWS2 calculation, 5-rights logic, dual-nurse narcotic witness | Live bedside barcode scanners, physical smart infusion pumps |
| **AG20 Emergency & Theatre** | Mongoose models (`EmergencyRegistration`, `OtSchedule`), 5-level triage rules, WHO checklist state lifecycle, room conflict validation | Live emergency room trauma pagers, physical OT display monitors |
| **AG21 Revenue & Stock** | Mongoose models (`InpatientInvoice`, `TpaPreAuth`, `CentralPharmacyStock`), tariff schedules, bed-day accrual, GRN batch reconciliation | Live external payment gateways, insurance clearinghouse webhooks |
| **AG22 Interfaces & DR** | Interface contract schema, LIS message parsing (ASTM/HL7 format), DICOM metadata registration, DR drill recording (`recorded_unverified`) | Physical LIS analyzer RS232/TCP cables, hospital PACS server network endpoints, enterprise Okta/Azure AD production SSO credentials, live cold-standby restoration |

---

## 8. Outpatient Release Boundary Affirmation

The outpatient candidate retains existing functionality, but production acceptance is open (AG05/AG16):
- Existing outpatient implementations require the release reconciliation and observed operating checks in LAUNCH_REPORT.md.
- The enterprise expansion (AG18–AG22) builds upon this foundation additively without modifying existing outpatient routes, database schemas, or validation invariants.
- No planning document or schema proposal shall be misrepresented as active clinical certification or live payment gateway integration without real external merchant onboarding and clinical director sign-off.
