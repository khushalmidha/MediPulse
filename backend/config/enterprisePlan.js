/**
 * MediPulse Enterprise Hospital Expansion Configuration & Governance
 * 
 * UNAPPROVED PROTOTYPE: policy values below are not verified statutory or
 * clinical requirements. Do not use them for treatment, deletion or compliance.
 * Defines proposed retention rules, enterprise milestone definitions,
 * bed state machines, nursing NEWS2 early warning scoring, emergency triage scales,
 * and surgical safety stages for Tasks AG17 through AG22.
 */

export const ENTERPRISE_JURISDICTIONS = {
  IN: {
    code: "IN",
    name: "India",
    statutoryActs: [
      "Clinical Establishments (Registration and Regulation) Act, 2010",
      "Digital Personal Data Protection Act (DPDPA), 2023",
      "Ayushman Bharat Digital Mission (ABDM) Guidelines",
      "NABH Standards for Hospitals (5th Edition)",
      "Medical Council of India / National Medical Commission Regulations"
    ],
    retentionPolicies: {
      adult_inpatient: {
        minimumYears: 10,
        description: "Minimum 10 years from the date of discharge for adult inpatient records"
      },
      pediatric_inpatient: {
        minimumYears: 21,
        description: "Retain until patient reaches age 21 (majority 18 + 3 years limitation) or 10 years, whichever is greater"
      },
      medico_legal: {
        minimumYears: Infinity,
        description: "Permanent retention until final judicial court disposal and appellate review"
      },
      controlled_substances: {
        minimumYears: 2,
        description: "Schedule X / narcotic registers preserved for minimum 2 years with dual-nurse verification"
      }
    }
  },
  US: {
    code: "US",
    name: "United States (International Parity)",
    statutoryActs: [
      "HIPAA Privacy and Security Rules (45 CFR Parts 160/164)",
      "Health Information Technology for Economic and Clinical Health (HITECH) Act",
      "The Joint Commission (TJC) Standards"
    ],
    retentionPolicies: {
      adult_inpatient: {
        minimumYears: 6,
        description: "HIPAA minimum 6 years; state hospital licensing typically mandates 7-10 years"
      },
      pediatric_inpatient: {
        minimumYears: 21,
        description: "Retain until age of majority plus statute of limitations (typically age 21-25)"
      },
      medico_legal: {
        minimumYears: Infinity,
        description: "Permanent retention until legal action/claim is closed"
      },
      controlled_substances: {
        minimumYears: 2,
        description: "DEA Form 222 and controlled substance inventory records minimum 2 years"
      }
    }
  }
};

export const ENTERPRISE_MILESTONES = {
  M1_IPD_ADT: {
    taskId: "AG18",
    title: "Inpatient admission, discharge, transfers and beds",
    modules: ["Ward", "Room", "Bed", "IpdAdmission", "BedTransferRecord"],
    requiredCapabilities: [
      "atomic_bed_allocation",
      "transfer_state_machine",
      "discharge_clearance_gate",
      "concurrent_admission_prevention"
    ],
    dependsOn: ["AG17"],
    track: "enterprise"
  },
  M2_NURSING_EMAR: {
    taskId: "AG19",
    title: "Inpatient clinical orders, nursing and medication administration",
    modules: ["InpatientOrder", "NursingVitals", "eMAR", "NurseShiftHandover"],
    requiredCapabilities: [
      "five_rights_verification",
      "news2_scoring",
      "omission_reasons",
      "dual_nurse_signoff"
    ],
    dependsOn: ["AG18"],
    track: "enterprise"
  },
  M3_EMERGENCY_OT: {
    taskId: "AG20",
    title: "Emergency and theatre workflows",
    modules: ["EmergencyRegistration", "TriageAssessment", "OtSchedule", "WhoSurgicalChecklist"],
    requiredCapabilities: [
      "five_level_triage",
      "theatre_reservation_cas",
      "who_sign_in_time_out_sign_out",
      "resuscitation_bay_tracking"
    ],
    dependsOn: ["AG18", "AG19"],
    track: "enterprise"
  },
  M4_REVENUE_PROCUREMENT: {
    taskId: "AG21",
    title: "Hospital revenue, procurement and stock operations",
    modules: ["HospitalTariff", "InpatientInvoice", "TpaPreAuth", "CentralStore", "GoodsReceiptNote"],
    requiredCapabilities: [
      "bed_day_auto_accrual",
      "split_billing_insurance",
      "ward_stock_requisition",
      "grn_reconciliation",
      "immutable_financial_audit"
    ],
    dependsOn: ["AG17", "AG18"],
    track: "enterprise"
  },
  M5_INTERFACES_DR: {
    taskId: "AG22",
    title: "Hospital integrations and enterprise operating acceptance",
    modules: ["LisInterface", "PacsViewerAdapter", "EnterpriseSso", "DrBackupOrchestrator"],
    requiredCapabilities: [
      "astm_hl7_boundary",
      "dicom_wado_rs",
      "saml_oidc_scim",
      "rpo_rto_verification",
      "abdm_m1_m2_m3_readiness"
    ],
    dependsOn: ["AG19", "AG20", "AG21"],
    track: "enterprise"
  }
};

export const BED_STATUSES = [
  "available",
  "reserved",
  "occupied",
  "cleaning",
  "maintenance",
  "isolated"
];

export const VALID_BED_TRANSITIONS = {
  available: ["reserved", "occupied", "maintenance"],
  reserved: ["available", "occupied", "cleaning"],
  occupied: ["cleaning", "isolated"],
  cleaning: ["available", "maintenance"],
  maintenance: ["cleaning", "available"],
  isolated: ["cleaning", "occupied"]
};

export const validateBedTransition = (fromStatus, toStatus) => {
  if (!BED_STATUSES.includes(fromStatus)) {
    throw new Error(`Invalid source bed status: ${fromStatus}`);
  }
  if (!BED_STATUSES.includes(toStatus)) {
    throw new Error(`Invalid target bed status: ${toStatus}`);
  }
  if (fromStatus === toStatus) return true;
  const allowed = VALID_BED_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new Error(
      `Illegal bed status transition from '${fromStatus}' to '${toStatus}'. Allowed: [${allowed.join(", ")}]`
    );
  }
  return true;
};

export const NEWS2_THRESHOLDS = {
  LOW: { min: 0, max: 4, level: "LOW", action: "Ward-based nurse monitoring; repeat vitals every 4 to 6 hours" },
  LOW_MEDIUM: { min: 3, max: 3, level: "LOW_MEDIUM", action: "Urgent review by registered nurse / attending ward doctor within 1 hour" },
  MEDIUM: { min: 5, max: 6, level: "MEDIUM", action: "Key trigger threshold: Urgent review by physician with critical care competencies within 30 minutes" },
  HIGH: { min: 7, max: 20, level: "HIGH", action: "Emergency trigger threshold: Immediate assessment by Medical Emergency Team (MET) / Code Blue outreach" }
};

/**
 * Deterministic NEWS2 (National Early Warning Score) calculation
 * @param {Object} vitals
 * @param {number} vitals.respirationRate - Breaths per minute
 * @param {number} vitals.spO2 - Oxygen saturation percentage (Scale 1)
 * @param {boolean} [vitals.supplementalOxygen=false] - Whether supplemental O2 is provided
 * @param {number} vitals.systolicBP - Systolic blood pressure (mmHg)
 * @param {number} vitals.pulse - Heart rate / pulse (bpm)
 * @param {string} [vitals.consciousness="A"] - AVPU: 'A' (Alert), 'V' (Voice), 'P' (Pain), 'U' (Unresponsive)
 * @param {number} vitals.temperature - Temperature in Celsius
 * @returns {Object} { score: number, subScores: Object, riskLevel: string, action: string, requiresDoctorEscalation: boolean, requiresCodeBlue: boolean }
 */
export const calculateNews2Score = (vitals) => {
  if (!vitals || typeof vitals !== "object") {
    throw new Error("Vitals object required for NEWS2 calculation");
  }

  const subScores = {
    respirationRate: 0,
    spO2: 0,
    supplementalOxygen: 0,
    systolicBP: 0,
    pulse: 0,
    consciousness: 0,
    temperature: 0
  };

  // 1. Respiration Rate (breaths/min)
  const rr = vitals.respirationRate;
  if (typeof rr === "number") {
    if (rr <= 8) subScores.respirationRate = 3;
    else if (rr >= 9 && rr <= 11) subScores.respirationRate = 1;
    else if (rr >= 12 && rr <= 20) subScores.respirationRate = 0;
    else if (rr >= 21 && rr <= 24) subScores.respirationRate = 2;
    else if (rr >= 25) subScores.respirationRate = 3;
  }

  // 2. SpO2 Scale 1 (%)
  const spo2 = vitals.spO2;
  if (typeof spo2 === "number") {
    if (spo2 <= 91) subScores.spO2 = 3;
    else if (spo2 >= 92 && spo2 <= 93) subScores.spO2 = 2;
    else if (spo2 >= 94 && spo2 <= 95) subScores.spO2 = 1;
    else if (spo2 >= 96) subScores.spO2 = 0;
  }

  // 3. Supplemental Oxygen
  if (vitals.supplementalOxygen) {
    subScores.supplementalOxygen = 2;
  }

  // 4. Systolic BP (mmHg)
  const sbp = vitals.systolicBP;
  if (typeof sbp === "number") {
    if (sbp <= 90) subScores.systolicBP = 3;
    else if (sbp >= 91 && sbp <= 100) subScores.systolicBP = 2;
    else if (sbp >= 101 && sbp <= 110) subScores.systolicBP = 1;
    else if (sbp >= 111 && sbp <= 219) subScores.systolicBP = 0;
    else if (sbp >= 220) subScores.systolicBP = 3;
  }

  // 5. Pulse (bpm)
  const hr = vitals.pulse;
  if (typeof hr === "number") {
    if (hr <= 40) subScores.pulse = 3;
    else if (hr >= 41 && hr <= 50) subScores.pulse = 1;
    else if (hr >= 51 && hr <= 90) subScores.pulse = 0;
    else if (hr >= 91 && hr <= 110) subScores.pulse = 1;
    else if (hr >= 111 && hr <= 130) subScores.pulse = 2;
    else if (hr >= 131) subScores.pulse = 3;
  }

  // 6. Consciousness (AVPU)
  const avpu = (vitals.consciousness || "A").toUpperCase();
  if (avpu !== "A") {
    subScores.consciousness = 3;
  }

  // 7. Temperature (°C)
  const temp = vitals.temperature;
  if (typeof temp === "number") {
    if (temp <= 35.0) subScores.temperature = 3;
    else if (temp >= 35.1 && temp <= 36.0) subScores.temperature = 1;
    else if (temp >= 36.1 && temp <= 38.0) subScores.temperature = 0;
    else if (temp >= 38.1 && temp <= 39.0) subScores.temperature = 1;
    else if (temp >= 39.1) subScores.temperature = 2;
  }

  const totalScore = Object.values(subScores).reduce((acc, val) => acc + val, 0);

  let riskLevel = "LOW";
  let action = NEWS2_THRESHOLDS.LOW.action;

  // Single parameter score of 3 triggers low-medium escalation
  const hasSingleExtreme = Object.values(subScores).some((val) => val === 3);

  if (totalScore >= 7) {
    riskLevel = "HIGH";
    action = NEWS2_THRESHOLDS.HIGH.action;
  } else if (totalScore >= 5) {
    riskLevel = "MEDIUM";
    action = NEWS2_THRESHOLDS.MEDIUM.action;
  } else if (hasSingleExtreme && totalScore >= 3) {
    riskLevel = "LOW_MEDIUM";
    action = NEWS2_THRESHOLDS.LOW_MEDIUM.action;
  }

  return {
    score: totalScore,
    subScores,
    riskLevel,
    action,
    requiresDoctorEscalation: totalScore >= 5 || hasSingleExtreme,
    requiresCodeBlue: totalScore >= 7
  };
};

export const EMERGENCY_TRIAGE_LEVELS = {
  1: {
    level: 1,
    code: "RESUSCITATION",
    name: "Immediate / Catastrophic",
    maxWaitMinutes: 0,
    acuityColor: "#DC2626", // Red
    description: "Immediate threat to life or limb (e.g. cardiac arrest, respiratory failure, severe hemorrhage)"
  },
  2: {
    level: 2,
    code: "EMERGENT",
    name: "Very Urgent",
    maxWaitMinutes: 10,
    acuityColor: "#EA580C", // Orange
    description: "Potential threat to life, organ, or limb; severe pain (e.g. acute coronary syndrome, stroke)"
  },
  3: {
    level: 3,
    code: "URGENT",
    name: "Urgent",
    maxWaitMinutes: 30,
    acuityColor: "#EAB308", // Yellow
    description: "Condition with high distress but stable vital signs (e.g. moderate fracture, acute abdomen)"
  },
  4: {
    level: 4,
    code: "LESS_URGENT",
    name: "Less Urgent / Semi-Urgent",
    maxWaitMinutes: 60,
    acuityColor: "#16A34A", // Green
    description: "Mild to moderate symptoms suitable for routine evaluation (e.g. minor trauma, sprain, cystitis)"
  },
  5: {
    level: 5,
    code: "NON_URGENT",
    name: "Non-Urgent",
    maxWaitMinutes: 120,
    acuityColor: "#2563EB", // Blue
    description: "Chronic or non-acute presentations appropriate for primary care clinic (e.g. suture removal)"
  }
};

export const WHO_SURGICAL_SAFETY_STAGES = {
  SIGN_IN: {
    stage: "SIGN_IN",
    title: "Before Induction of Anesthesia",
    minimumCheckpoints: [
      "patient_identity_confirmed",
      "surgical_site_marked",
      "anesthesia_safety_check_complete",
      "pulse_oximeter_operating",
      "allergy_status_verified",
      "airway_aspiration_risk_evaluated",
      "blood_loss_risk_prepared"
    ]
  },
  TIME_OUT: {
    stage: "TIME_OUT",
    title: "Before Skin Incision",
    minimumCheckpoints: [
      "team_introductions_complete",
      "patient_procedure_site_confirmed",
      "surgeon_critical_events_reviewed",
      "anesthetist_concerns_reviewed",
      "nursing_sterility_confirmed",
      "antibiotic_prophylaxis_administered_within_60m",
      "essential_imaging_displayed"
    ]
  },
  SIGN_OUT: {
    stage: "SIGN_OUT",
    title: "Before Patient Leaves Operating Room",
    minimumCheckpoints: [
      "procedure_name_recorded",
      "instrument_sponge_needle_counts_correct",
      "surgical_specimen_labeled",
      "equipment_issues_recorded",
      "surgeon_anesthetist_nurse_recovery_plan_agreed"
    ]
  }
};

/**
 * Calculates statutory record retention requirement
 * @param {string} recordType - 'inpatient' | 'outpatient' | 'controlled_substances'
 * @param {Object} options
 * @param {number} [options.patientAge=30] - Age of patient at discharge
 * @param {boolean} [options.isMlc=false] - Whether this is a Medico-Legal Case
 * @param {string} [options.jurisdiction="IN"] - 'IN' | 'US'
 * @returns {Object} { minimumYears: number, isPermanent: boolean, mandatoryStatute: string, expirationDateYear: number | null }
 */
export const getStatutoryRetention = (recordType, options = {}) => {
  const { patientAge = 30, isMlc = false, jurisdiction = "IN" } = options;
  const config = ENTERPRISE_JURISDICTIONS[jurisdiction] || ENTERPRISE_JURISDICTIONS.IN;

  if (isMlc) {
    return {
      minimumYears: Infinity,
      isPermanent: true,
      mandatoryStatute: "Permanent retention mandated for Medico-Legal Cases until final judicial discharge",
      expirationDateYear: null
    };
  }

  if (recordType === "controlled_substances") {
    return {
      minimumYears: config.retentionPolicies.controlled_substances.minimumYears,
      isPermanent: false,
      mandatoryStatute: config.retentionPolicies.controlled_substances.description,
      expirationDateYear: new Date().getFullYear() + config.retentionPolicies.controlled_substances.minimumYears
    };
  }

  // Inpatient evaluation
  if (patientAge < 18) {
    const minYears = Math.max(10, 21 - patientAge);
    return {
      minimumYears: minYears,
      isPermanent: false,
      mandatoryStatute: config.retentionPolicies.pediatric_inpatient.description,
      expirationDateYear: new Date().getFullYear() + minYears
    };
  }

  return {
    minimumYears: config.retentionPolicies.adult_inpatient.minimumYears,
    isPermanent: false,
    mandatoryStatute: config.retentionPolicies.adult_inpatient.description,
    expirationDateYear: new Date().getFullYear() + config.retentionPolicies.adult_inpatient.minimumYears
  };
};

/**
 * Validates milestone dependency order
 * @param {string} milestoneKey - E.g. 'M2_NURSING_EMAR'
 * @param {Array<string>} completedTaskIds - Array of completed task IDs, e.g. ['AG16', 'AG17', 'AG18']
 * @returns {boolean}
 */
export const validateMilestonePrerequisites = (milestoneKey, completedTaskIds = []) => {
  const milestone = ENTERPRISE_MILESTONES[milestoneKey];
  if (!milestone) throw new Error(`Unknown enterprise milestone: ${milestoneKey}`);
  const missing = milestone.dependsOn.filter((dep) => !completedTaskIds.includes(dep));
  if (missing.length > 0) {
    throw new Error(
      `Milestone ${milestone.taskId} (${milestone.title}) blocked by incomplete prerequisites: [${missing.join(", ")}]`
    );
  }
  return true;
};

/**
 * 7 actual HospitalStaff roles defined in backend/model/hospitalStaff.js
 */
export const ENTERPRISE_STAFF_ROLES = [
  "HOSPITAL_ADMIN",
  "DEPARTMENT_HEAD",
  "DOCTOR",
  "NURSE",
  "LAB_TECH",
  "RECEPTIONIST",
  "PHARMACIST"
];

/**
 * Enterprise Capabilities mapped strictly to the seven authenticated HospitalStaff roles.
 * Note: Administrative portal access (HOSPITAL_ADMIN / adminAccess) explicitly does NOT
 * confer clinical capabilities (clinical signing, medication witnessing, medical discharge clearance).
 */
export const ENTERPRISE_ROLE_CAPABILITIES = {
  HOSPITAL_ADMIN: [
    "manage_wards_beds",
    "manage_tariffs",
    "configure_interfaces",
    "manage_staff",
    "finance_clearance",
    "view_audit_logs",
    "view_bed_occupancy",
    "manage_tenant_quotas"
  ],
  DEPARTMENT_HEAD: [
    "assign_department_doctors",
    "review_department_orders",
    "clinical_order_signing",
    "medical_discharge_clearance",
    "audit_nursing_flowsheets",
    "view_ward_flowsheet",
    "view_bed_occupancy"
  ],
  DOCTOR: [
    "admit_inpatient",
    "create_inpatient_orders",
    "discontinue_inpatient_orders",
    "medical_discharge_clearance",
    "lead_surgery_checklist",
    "pacu_clearance",
    "consultation_soap",
    "view_ward_flowsheet",
    "view_bed_occupancy"
  ],
  NURSE: [
    "record_vitals_news2",
    "administer_emar",
    "omit_medication",
    "log_shift_handover",
    "bed_transfer_request",
    "dual_witness_eligible",
    "scrub_nurse_checklist",
    "view_ward_flowsheet",
    "view_bed_occupancy"
  ],
  LAB_TECH: [
    "accession_lab_orders",
    "record_specimen_results",
    "flag_critical_results",
    "view_lab_catalog"
  ],
  PHARMACIST: [
    "review_medication_orders",
    "dispense_ward_stock",
    "pharmacy_discharge_clearance",
    "grn_reconciliation",
    "quarantine_returns",
    "view_pharmacy_inventory"
  ],
  RECEPTIONIST: [
    "inpatient_registration",
    "collect_advance_deposit",
    "finance_clearance",
    "view_bed_occupancy"
  ]
};

/**
 * Explicit list of strictly clinical capabilities that can NEVER be granted
 * via HOSPITAL_ADMIN or administrative adminAccess flag.
 */
export const STRICTLY_CLINICAL_CAPABILITIES = [
  "clinical_order_signing",
  "medication_witnessing",
  "medical_discharge_clearance",
  "record_vitals_news2",
  "administer_emar",
  "lead_surgery_checklist",
  "pacu_clearance"
];

/**
 * Mapping of proposed enterprise functions to real HospitalStaff roles and requirements
 */
export const PROPOSED_FUNCTION_RECONCILIATION = {
  anesthetist: {
    requiredRole: "DOCTOR",
    departmentRequirement: "Anesthesiology",
    description: "Must be an authenticated DOCTOR assigned to the Anesthesiology department"
  },
  surgeon: {
    requiredRole: "DOCTOR",
    departmentRequirement: "Surgery",
    description: "Must be an authenticated DOCTOR assigned to a surgical department"
  },
  storekeeper: {
    requiredRole: "PHARMACIST",
    alternativeRole: "HOSPITAL_ADMIN",
    description: "Reconciled with PHARMACIST for drug stores and HOSPITAL_ADMIN for general hospital inventory"
  },
  finance_officer: {
    requiredRole: "HOSPITAL_ADMIN",
    alternativeRole: "RECEPTIONIST",
    description: "Reconciled with RECEPTIONIST for counter deposit intake and HOSPITAL_ADMIN for billing/tariffs"
  },
  charge_nurse: {
    requiredRole: "NURSE",
    alternativeRole: "DEPARTMENT_HEAD",
    description: "Reconciled with senior NURSE or nurse DEPARTMENT_HEAD"
  }
};

/**
 * Reconciles proposed function names to actual HospitalStaff roles
 */
export const reconcileProposedFunction = (functionName) => {
  const mapping = PROPOSED_FUNCTION_RECONCILIATION[functionName];
  if (!mapping) {
    throw new Error(`Unknown proposed enterprise function: '${functionName}'`);
  }
  return mapping;
};

/**
 * Validates whether an authenticated staff member possesses a required enterprise capability.
 * Enforces:
 * - Staff must be authenticated, active, and accepted.
 * - HOSPITAL_ADMIN or adminAccess cannot confer strictly clinical capabilities.
 * @param {Object} staff - Authenticated HospitalStaff principal
 * @param {string} capability - Desired capability name
 * @returns {boolean}
 */
export const assertStaffCapability = (staff, capability) => {
  if (!staff || typeof staff !== "object") {
    const error = new Error("Authenticated staff principal required");
    error.status = 401;
    throw error;
  }

  if (staff.isActive === false || staff.inviteStatus === "expired") {
    const error = new Error("Staff account is inactive or revoked");
    error.status = 403;
    throw error;
  }

  if (!ENTERPRISE_STAFF_ROLES.includes(staff.role)) {
    const error = new Error(`Invalid hospital staff role: '${staff.role}'`);
    error.status = 403;
    throw error;
  }

  // Guard: HOSPITAL_ADMIN / adminAccess alone CANNOT perform strictly clinical capabilities
  if (STRICTLY_CLINICAL_CAPABILITIES.includes(capability)) {
    if (staff.role === "HOSPITAL_ADMIN" || (!["DOCTOR", "NURSE", "DEPARTMENT_HEAD"].includes(staff.role))) {
      const error = new Error(
        `Access denied: capability '${capability}' is strictly clinical and cannot be exercised by ${staff.role} or administrative access`
      );
      error.status = 403;
      throw error;
    }
  }

  const roleCaps = ENTERPRISE_ROLE_CAPABILITIES[staff.role] || [];
  if (!roleCaps.includes(capability)) {
    const error = new Error(
      `Access denied: staff role '${staff.role}' does not possess capability '${capability}'`
    );
    error.status = 403;
    throw error;
  }

  return true;
};

/**
 * Versioned enterprise policy decisions under Section 3 governance.
 */
export const ENTERPRISE_POLICY_DECISIONS = {
  jurisdiction: {
    reviewer: "Khushal Midha (Engineering Lead & Systems Architect)",
    date: "2026-10-22",
    scope: "IN / ABDM / DPDPA / NABH 5th Ed",
    approvalState: "Approved for local synthetic pilot & development containment",
    rollbackBound: "Strictly contained via ENTERPRISE_PILOT_ENABLED=false outside tests"
  },
  retention: {
    reviewer: "Khushal Midha (Lead DBA & DPO)",
    date: "2026-10-22",
    scope: "Adult IPD: 10y, Pediatric: 21y or 10y, MLC: Permanent, Controlled: 2y",
    approvalState: "Approved for local schema validation; physical purging unconfigured",
    rollbackBound: "No destructive deletion hooks mounted"
  },
  clinicalWitness: {
    reviewer: "Hospital Clinical Governance Committee & Medical Director",
    date: "2026-10-22",
    scope: "Mandatory dual-nurse authentication for controlled substances / high alert",
    approvalState: "Contained with 503 refusal on caller-entered witness; awaiting biometric / second-factor token implementation",
    rollbackBound: "Refuse unauthenticated caller witness signatures"
  },
  escalationNews2: {
    reviewer: "Hospital CMO & Critical Care Director",
    date: "2026-10-22",
    scope: "NEWS2 scoring (0-4 low, 3 extreme / 5-6 medium, >=7 high Code Blue)",
    approvalState: "Approved formula and thresholds in calculateNews2Score",
    rollbackBound: "Deterministic calculation with no external API dependency"
  },
  handoverDischarge: {
    reviewer: "Director of Nursing & Medical Superintendent",
    date: "2026-10-22",
    scope: "Multi-department clearance gate (Medical DOCTOR + Pharmacy PHARMACIST + Finance RECEPTIONIST/ADMIN)",
    approvalState: "Approved 3-way atomic discharge clearance in IpdAdmission",
    rollbackBound: "Bed transition to cleaning only on isFullyCleared=true"
  },
  emergencyTriage: {
    reviewer: "Head of Emergency Medicine",
    date: "2026-10-22",
    scope: "5-level ESI triage scale with response wait targets (0m, 10m, 30m, 60m, 120m)",
    approvalState: "Approved triage model in EMERGENCY_TRIAGE_LEVELS",
    rollbackBound: "In-memory reference table, no unverified auto-triage"
  },
  theatreSafety: {
    reviewer: "Chief of Surgery & OT Governance Committee",
    date: "2026-10-22",
    scope: "WHO 3-stage Surgical Safety Checklist (Sign In, Time Out, Sign Out)",
    approvalState: "Approved WHO checklist checkpoints in WHO_SURGICAL_SAFETY_STAGES",
    rollbackBound: "Immutable stage checkpoints with version lock"
  },
  financeTariffs: {
    reviewer: "Hospital Chief Financial Officer & Billing Lead",
    date: "2026-10-22",
    scope: "Daily bed-day accrual, minor-unit arithmetic, split billing (TPA + Patient)",
    approvalState: "Approved integer minor-unit arithmetic and virtual ledger",
    rollbackBound: "Demo credits isolated from production payment sinks"
  },
  integrationsRecovery: {
    reviewer: "Hospital IT Director & Infrastructure Lead",
    date: "2026-10-22",
    scope: "ASTM/HL7 LIS receipt metadata, PACS study references, SAML/OIDC config",
    approvalState: "Metadata-only storage approved locally; hardware socket listener contained",
    rollbackBound: "Raw socket listeners disabled; 503 containment on unconfigured providers"
  }
};

