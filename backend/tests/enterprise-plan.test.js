import test from "node:test";
import assert from "node:assert/strict";
import {
  ENTERPRISE_JURISDICTIONS,
  ENTERPRISE_MILESTONES,
  BED_STATUSES,
  VALID_BED_TRANSITIONS,
  validateBedTransition,
  NEWS2_THRESHOLDS,
  calculateNews2Score,
  EMERGENCY_TRIAGE_LEVELS,
  WHO_SURGICAL_SAFETY_STAGES,
  getStatutoryRetention,
  validateMilestonePrerequisites
} from "../config/enterprisePlan.js";
import {
  PLAN_ENTITLEMENTS,
  getPlanEntitlements
} from "../services/saasOperationsService.js";

test("Enterprise Hospital Expansion Plan & Governance Specification (AG17)", async (t) => {
  await t.test("1. Statutory Jurisdictions & Medical Record Retention Policies", () => {
    // Primary Indian Jurisdiction
    const inJurisdiction = ENTERPRISE_JURISDICTIONS.IN;
    assert.equal(inJurisdiction.code, "IN");
    assert.equal(inJurisdiction.name, "India");
    assert.ok(inJurisdiction.statutoryActs.some((act) => act.includes("DPDPA")));
    assert.ok(inJurisdiction.statutoryActs.some((act) => act.includes("Clinical Establishments")));

    // Adult Inpatient retention
    const adultRetention = getStatutoryRetention("inpatient", { patientAge: 35, jurisdiction: "IN" });
    assert.equal(adultRetention.minimumYears, 10);
    assert.equal(adultRetention.isPermanent, false);
    assert.ok(adultRetention.expirationDateYear >= new Date().getFullYear() + 10);

    // Pediatric Inpatient retention (e.g. 5-year-old child -> 21 - 5 = 16 years, greater than 10)
    const childRetention = getStatutoryRetention("inpatient", { patientAge: 5, jurisdiction: "IN" });
    assert.equal(childRetention.minimumYears, 16);
    assert.equal(childRetention.isPermanent, false);

    // Pediatric Inpatient retention (e.g. 15-year-old child -> 21 - 15 = 6, minimum 10 applies)
    const teenRetention = getStatutoryRetention("inpatient", { patientAge: 15, jurisdiction: "IN" });
    assert.equal(teenRetention.minimumYears, 10);
    assert.equal(teenRetention.isPermanent, false);

    // Medico-Legal Cases (MLC) permanent retention
    const mlcRetention = getStatutoryRetention("inpatient", { patientAge: 40, isMlc: true, jurisdiction: "IN" });
    assert.equal(mlcRetention.minimumYears, Infinity);
    assert.equal(mlcRetention.isPermanent, true);
    assert.equal(mlcRetention.expirationDateYear, null);

    // Controlled substances register retention
    const narcoticRetention = getStatutoryRetention("controlled_substances", { jurisdiction: "IN" });
    assert.equal(narcoticRetention.minimumYears, 2);
    assert.equal(narcoticRetention.isPermanent, false);
  });

  await t.test("2. Bed State Machine & Lifecycle Invariants", () => {
    assert.deepEqual(BED_STATUSES, [
      "available",
      "reserved",
      "occupied",
      "cleaning",
      "maintenance",
      "isolated"
    ]);

    // Valid transitions
    assert.doesNotThrow(() => validateBedTransition("available", "occupied"));
    assert.doesNotThrow(() => validateBedTransition("available", "reserved"));
    assert.doesNotThrow(() => validateBedTransition("reserved", "occupied"));
    assert.doesNotThrow(() => validateBedTransition("occupied", "cleaning"));
    assert.doesNotThrow(() => validateBedTransition("cleaning", "available"));
    assert.doesNotThrow(() => validateBedTransition("available", "maintenance"));
    assert.doesNotThrow(() => validateBedTransition("maintenance", "available"));
    assert.doesNotThrow(() => validateBedTransition("occupied", "occupied")); // Same status is no-op

    // Prohibited transitions
    // Direct occupied to available bypasses housekeeping cleaning!
    assert.throws(() => validateBedTransition("occupied", "available"), /Illegal bed status transition/);
    // Direct cleaning to occupied bypasses available inspection!
    assert.throws(() => validateBedTransition("cleaning", "occupied"), /Illegal bed status transition/);
    // Direct maintenance to occupied is prohibited
    assert.throws(() => validateBedTransition("maintenance", "occupied"), /Illegal bed status transition/);

    // Invalid status strings
    assert.throws(() => validateBedTransition("unknown_status", "occupied"), /Invalid source bed status/);
    assert.throws(() => validateBedTransition("available", "invalid_status"), /Invalid target bed status/);
  });

  await t.test("3. NEWS2 Objective Early Warning Scoring & Escalation", () => {
    // Normal baseline vitals
    const normalVitals = {
      respirationRate: 16,
      spO2: 98,
      supplementalOxygen: false,
      systolicBP: 120,
      pulse: 72,
      consciousness: "A",
      temperature: 37.0
    };
    const normalResult = calculateNews2Score(normalVitals);
    assert.equal(normalResult.score, 0);
    assert.equal(normalResult.riskLevel, "LOW");
    assert.equal(normalResult.requiresDoctorEscalation, false);
    assert.equal(normalResult.requiresCodeBlue, false);

    // Low-Medium Risk: Single extreme parameter (e.g. bradycardia pulse <= 40 bpm)
    const bradycardicVitals = {
      ...normalVitals,
      pulse: 38 // score 3
    };
    const bradyResult = calculateNews2Score(bradycardicVitals);
    assert.equal(bradyResult.score, 3);
    assert.equal(bradyResult.riskLevel, "LOW_MEDIUM");
    assert.equal(bradyResult.requiresDoctorEscalation, true);
    assert.equal(bradyResult.requiresCodeBlue, false);

    // Medium Risk: Multi-parameter moderate deviation (e.g. score = 5)
    const moderateVitals = {
      respirationRate: 22, // score 2
      spO2: 94,            // score 1
      supplementalOxygen: false,
      systolicBP: 105,     // score 1
      pulse: 95,           // score 1
      consciousness: "A",
      temperature: 37.2
    };
    const moderateResult = calculateNews2Score(moderateVitals);
    assert.equal(moderateResult.score, 5);
    assert.equal(moderateResult.riskLevel, "MEDIUM");
    assert.equal(moderateResult.requiresDoctorEscalation, true);
    assert.equal(moderateResult.requiresCodeBlue, false);

    // High Risk: Critically deteriorating patient requiring Code Blue (score >= 7)
    const severeVitals = {
      respirationRate: 28,      // score 3
      spO2: 90,                 // score 3
      supplementalOxygen: true, // score 2
      systolicBP: 85,           // score 3
      pulse: 135,               // score 3
      consciousness: "V",       // score 3
      temperature: 39.5         // score 2
    };
    const severeResult = calculateNews2Score(severeVitals);
    assert.ok(severeResult.score >= 7);
    assert.equal(severeResult.riskLevel, "HIGH");
    assert.equal(severeResult.requiresDoctorEscalation, true);
    assert.equal(severeResult.requiresCodeBlue, true);
  });

  await t.test("4. Emergency Department 5-Level Triage & Response Targets", () => {
    const levels = EMERGENCY_TRIAGE_LEVELS;
    assert.equal(levels[1].code, "RESUSCITATION");
    assert.equal(levels[1].maxWaitMinutes, 0);

    assert.equal(levels[2].code, "EMERGENT");
    assert.equal(levels[2].maxWaitMinutes, 10);

    assert.equal(levels[3].code, "URGENT");
    assert.equal(levels[3].maxWaitMinutes, 30);

    assert.equal(levels[4].code, "LESS_URGENT");
    assert.equal(levels[4].maxWaitMinutes, 60);

    assert.equal(levels[5].code, "NON_URGENT");
    assert.equal(levels[5].maxWaitMinutes, 120);
  });

  await t.test("5. WHO Surgical Safety Checklist Checkpoints", () => {
    const stages = WHO_SURGICAL_SAFETY_STAGES;
    assert.ok(stages.SIGN_IN);
    assert.ok(stages.TIME_OUT);
    assert.ok(stages.SIGN_OUT);

    assert.ok(stages.SIGN_IN.minimumCheckpoints.includes("surgical_site_marked"));
    assert.ok(stages.SIGN_IN.minimumCheckpoints.includes("anesthesia_safety_check_complete"));

    assert.ok(stages.TIME_OUT.minimumCheckpoints.includes("team_introductions_complete"));
    assert.ok(stages.TIME_OUT.minimumCheckpoints.includes("antibiotic_prophylaxis_administered_within_60m"));

    assert.ok(stages.SIGN_OUT.minimumCheckpoints.includes("instrument_sponge_needle_counts_correct"));
    assert.ok(stages.SIGN_OUT.minimumCheckpoints.includes("surgical_specimen_labeled"));
  });

  await t.test("6. Enterprise Milestone Dependency Graph & Prerequisites", () => {
    // Milestones definition
    assert.ok(ENTERPRISE_MILESTONES.M1_IPD_ADT);
    assert.equal(ENTERPRISE_MILESTONES.M1_IPD_ADT.taskId, "AG18");
    assert.deepEqual(ENTERPRISE_MILESTONES.M1_IPD_ADT.dependsOn, ["AG17"]);

    assert.ok(ENTERPRISE_MILESTONES.M2_NURSING_EMAR);
    assert.equal(ENTERPRISE_MILESTONES.M2_NURSING_EMAR.taskId, "AG19");
    assert.deepEqual(ENTERPRISE_MILESTONES.M2_NURSING_EMAR.dependsOn, ["AG18"]);

    assert.ok(ENTERPRISE_MILESTONES.M3_EMERGENCY_OT);
    assert.equal(ENTERPRISE_MILESTONES.M3_EMERGENCY_OT.taskId, "AG20");
    assert.deepEqual(ENTERPRISE_MILESTONES.M3_EMERGENCY_OT.dependsOn, ["AG18", "AG19"]);

    assert.ok(ENTERPRISE_MILESTONES.M4_REVENUE_PROCUREMENT);
    assert.equal(ENTERPRISE_MILESTONES.M4_REVENUE_PROCUREMENT.taskId, "AG21");
    assert.deepEqual(ENTERPRISE_MILESTONES.M4_REVENUE_PROCUREMENT.dependsOn, ["AG17", "AG18"]);

    assert.ok(ENTERPRISE_MILESTONES.M5_INTERFACES_DR);
    assert.equal(ENTERPRISE_MILESTONES.M5_INTERFACES_DR.taskId, "AG22");
    assert.deepEqual(ENTERPRISE_MILESTONES.M5_INTERFACES_DR.dependsOn, ["AG19", "AG20", "AG21"]);

    // Dependency validator function
    assert.doesNotThrow(() => validateMilestonePrerequisites("M1_IPD_ADT", ["AG16", "AG17"]));
    assert.throws(
      () => validateMilestonePrerequisites("M2_NURSING_EMAR", ["AG16", "AG17"]),
      /blocked by incomplete prerequisites: \[AG18\]/
    );
    assert.doesNotThrow(() => validateMilestonePrerequisites("M2_NURSING_EMAR", ["AG16", "AG17", "AG18"]));
  });

  await t.test("7. SaaS Enterprise Plan Feature Entitlements", () => {
    const entitlements = getPlanEntitlements("enterprise");
    assert.equal(entitlements.maxStaff, 1000);
    assert.equal(entitlements.maxDepartments, 100);

    // Verify core outpatient + enterprise features
    assert.ok(entitlements.features.includes("opd"));
    assert.ok(entitlements.features.includes("queue"));
    assert.ok(entitlements.features.includes("labs"));
    assert.ok(entitlements.features.includes("pharmacy"));
    assert.ok(entitlements.features.includes("multi_branch"));
    assert.ok(entitlements.features.includes("custom_domain"));

    // Verify enterprise hospital expansion features
    assert.ok(entitlements.features.includes("ipd_beds"));
    assert.ok(entitlements.features.includes("nursing_emar"));
    assert.ok(entitlements.features.includes("emergency_theatre"));
    assert.ok(entitlements.features.includes("enterprise_procurement"));
    assert.ok(entitlements.features.includes("enterprise_interfaces"));

    // Starter & Growth should NOT have enterprise features
    const starterEntitlements = getPlanEntitlements("starter");
    assert.equal(starterEntitlements.features.includes("ipd_beds"), false);
    assert.equal(starterEntitlements.features.includes("nursing_emar"), false);

    const growthEntitlements = getPlanEntitlements("growth");
    assert.equal(growthEntitlements.features.includes("ipd_beds"), false);
    assert.equal(growthEntitlements.features.includes("nursing_emar"), false);
  });
});
