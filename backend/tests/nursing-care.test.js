import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  createInpatientOrder,
  discontinueInpatientOrder,
  recordNursingVitals,
  acknowledgeVitalsEscalation,
  administerMedication,
  recordMedicationOmission,
  recordShiftHandover,
  acceptShiftHandover,
  getInpatientFlowsheet,
  getShiftHandovers,
  getInpatientOrders,
  getNursingVitals,
  getEmarSchedule,
  setNursingTestDouble,
} from "../services/nursingCareService.js";
import { calculateNews2Score } from "../config/enterprisePlan.js";

test("Task AG19: Inpatient Clinical Orders, Nursing and eMAR (Unit & Domain)", async (t) => {
  const hospitalId = new mongoose.Types.ObjectId();
  const admissionId = new mongoose.Types.ObjectId();
  const patientId = new mongoose.Types.ObjectId();
  const doctorId = new mongoose.Types.ObjectId();
  const nurse1Id = new mongoose.Types.ObjectId();
  const nurse2Id = new mongoose.Types.ObjectId();
  const order1Id = new mongoose.Types.ObjectId();
  const order2Id = new mongoose.Types.ObjectId();
  const emar1Id = new mongoose.Types.ObjectId();
  const emar2Id = new mongoose.Types.ObjectId();

  const state = {
    orders: [],
    emars: [],
    vitals: [],
    handovers: [],
  };

  setNursingTestDouble({
    createInpatientOrder: async ({ admissionId: admId, patientId: patId, orderType, medicationDetails, nursingInstructions, prescribedByDoctorId, actor }) => {
      if (actor?.role && !["DOCTOR", "DEPARTMENT_HEAD"].includes(actor.role)) {
        throw Object.assign(new Error("Administrative staff cannot prescribe clinical orders; must be a licensed doctor or department head"), { status: 403 });
      }
      if (prescribedByDoctorId && (actor?.doctorId || actor?.staffId)) {
        const allowedId = String(actor.doctorId || actor.staffId);
        if (String(prescribedByDoctorId) !== allowedId) {
          throw Object.assign(new Error("Cannot forge prescribedByDoctorId; order must be prescribed by authenticated clinician"), { status: 403 });
        }
      }
      if (patId && String(patId) !== String(patientId)) {
        throw Object.assign(new Error("Patient ID does not match active admission"), { status: 400 });
      }

      const validTypes = ["medication", "investigation", "nursing_care", "diet", "monitoring"];
      if (!validTypes.includes(orderType)) {
        throw Object.assign(new Error(`Invalid order type: ${orderType}`), { status: 400 });
      }
      if (orderType === "medication" && (!medicationDetails?.drugName || !medicationDetails?.dose)) {
        throw Object.assign(new Error("Drug name and dose required for medication orders"), { status: 400 });
      }

      const order = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        admissionId: admId,
        patientId,
        orderType,
        status: "active",
        prescribedByDoctorId: actor?.doctorId || actor?.staffId || prescribedByDoctorId || doctorId,
        medicationDetails: {
          drugName: medicationDetails.drugName,
          dose: medicationDetails.dose,
          route: medicationDetails.route || "oral",
          frequency: medicationDetails.frequency || "od",
          durationDays: medicationDetails.durationDays || 1,
          isHighAlert: Boolean(medicationDetails.isHighAlert),
          isControlledSubstance: Boolean(medicationDetails.isControlledSubstance),
        },
        nursingInstructions,
        version: 0,
      };
      state.orders.push(order);

      // Generate mock eMAR entries
      const doses = [];
      const count = medicationDetails.frequency === "bd" ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const emar = {
          _id: new mongoose.Types.ObjectId(),
          hospitalId,
          admissionId: admId,
          orderId: order._id,
          order,
          patientId,
          scheduledTime: new Date(Date.now() + i * 12 * 3600 * 1000),
          status: "scheduled",
          version: 0,
        };
        state.emars.push(emar);
        doses.push(emar);
      }

      return { success: true, order, scheduledDosesCount: doses.length };
    },
    discontinueInpatientOrder: async ({ orderId, reason, expectedVersion, actor }) => {
      if (actor?.role && !["DOCTOR", "DEPARTMENT_HEAD"].includes(actor.role)) {
        throw Object.assign(new Error("Administrative staff cannot discontinue clinical orders; must be a licensed doctor or department head"), { status: 403 });
      }
      if (!reason) throw Object.assign(new Error("Reason for order discontinuation is required"), { status: 400 });
      const order = state.orders.find((o) => o._id.toString() === orderId.toString());
      if (!order) throw Object.assign(new Error("Order not found"), { status: 404 });

      if (expectedVersion !== null && expectedVersion !== undefined) {
        if (Number(order.version) !== Number(expectedVersion)) {
          throw Object.assign(new Error("Stale order version; please refresh and try again"), { status: 409 });
        }
      }

      order.status = "discontinued";
      order.discontinuedReason = reason;
      order.version = (order.version || 0) + 1;

      let cancelled = 0;
      for (const emar of state.emars.filter((e) => e.orderId.toString() === orderId.toString() && e.status === "scheduled")) {
        emar.status = "cancelled";
        emar.omissionNote = `Order discontinued: ${reason}`;
        cancelled++;
      }
      return { success: true, order, cancelledDosesCount: cancelled };
    },
    recordNursingVitals: async ({ admissionId: admId, vitals, actor }) => {
      const news2Result = calculateNews2Score(vitals);
      const vitalsRecord = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        admissionId: admId,
        patientId,
        recordedByStaffId: actor?.staffId || nurse1Id,
        ...vitals,
        news2: {
          score: news2Result.score,
          riskLevel: news2Result.riskLevel,
          action: news2Result.action,
          requiresDoctorEscalation: news2Result.requiresDoctorEscalation,
          requiresCodeBlue: news2Result.requiresCodeBlue,
        },
        escalationNotified: false,
        escalatedToDoctorId: null,
        escalationAcknowledgedAt: null,
        recordedAt: new Date(),
      };
      state.vitals.push(vitalsRecord);
      return { success: true, vitals: vitalsRecord, news2: news2Result, requiresCodeBlue: news2Result.requiresCodeBlue };
    },
    acknowledgeVitalsEscalation: async ({ vitalsId, actor, responseNotes }) => {
      const v = state.vitals.find((item) => item._id.toString() === vitalsId.toString());
      if (!v) throw Object.assign(new Error("Nursing vitals record not found"), { status: 404 });
      if (!v.news2?.requiresDoctorEscalation && !v.news2?.requiresCodeBlue) {
        throw Object.assign(new Error("Vitals record does not require clinical escalation"), { status: 400 });
      }
      if (v.escalationAcknowledgedAt) {
        throw Object.assign(new Error("Clinical escalation has already been acknowledged"), { status: 409 });
      }
      if (actor?.role && !["DOCTOR", "DEPARTMENT_HEAD"].includes(actor.role)) {
        throw Object.assign(new Error("Only licensed doctors or department heads can acknowledge clinical vitals escalation"), { status: 403 });
      }
      v.escalationNotified = true;
      v.escalatedToDoctorId = actor?.doctorId || actor?.staffId || doctorId;
      v.escalationAcknowledgedAt = new Date();
      v.escalationResponseNotes = responseNotes || "";
      return { success: true, vitals: v };
    },
    administerMedication: async ({ emarId, fiveRightsVerified, dualWitnessStaffId, dualWitnessSignature, actor }) => {
      const { rightPatient, rightDrug, rightDose, rightRoute, rightTime } = fiveRightsVerified || {};
      if (!rightPatient || !rightDrug || !rightDose || !rightRoute || !rightTime) {
        throw Object.assign(new Error("5-Rights bedside verification incomplete. Must verify Right Patient, Right Drug, Right Dose, Right Route, and Right Time."), { status: 400 });
      }

      const emar = state.emars.find((e) => e._id.toString() === emarId.toString());
      if (!emar) throw Object.assign(new Error("eMAR record not found"), { status: 404 });

      const isControlled = emar.order?.medicationDetails?.isControlledSubstance;
      const isHighAlert = emar.order?.medicationDetails?.isHighAlert;
      if (isControlled || isHighAlert) {
        if (!dualWitnessStaffId || !dualWitnessSignature) {
          throw Object.assign(new Error("Mandatory dual-nurse verification missing for controlled substance"), { status: 403 });
        }
        if (actor?.staffId && actor.staffId.toString() === dualWitnessStaffId.toString()) {
          throw Object.assign(new Error("Administering nurse cannot act as their own secondary witness"), { status: 403 });
        }
      }

      emar.status = "administered";
      emar.administeredAt = new Date();
      emar.administeredByStaffId = actor?.staffId || nurse1Id;
      emar.fiveRightsVerified = fiveRightsVerified;
      if (dualWitnessStaffId) {
        emar.dualWitnessStaffId = dualWitnessStaffId;
        emar.dualWitnessSignature = dualWitnessSignature;
      }
      return { success: true, emar };
    },
    recordMedicationOmission: async ({ emarId, omissionReason, omissionNote, actor }) => {
      const validReasons = ["patient_refused", "fasting_for_procedure", "medication_unavailable", "vital_contraindicated", "clinician_hold"];
      if (!validReasons.includes(omissionReason)) {
        throw Object.assign(new Error(`Invalid omission reason: ${omissionReason}`), { status: 400 });
      }
      const emar = state.emars.find((e) => e._id.toString() === emarId.toString());
      if (!emar) throw Object.assign(new Error("eMAR record not found"), { status: 404 });

      emar.status = omissionReason === "patient_refused" ? "refused" : "omitted";
      emar.omissionReason = omissionReason;
      emar.omissionNote = omissionNote;
      emar.administeredAt = new Date();
      emar.administeredByStaffId = actor?.staffId || nurse1Id;
      return { success: true, emar };
    },
    recordShiftHandover: async ({ shiftDate, shiftType, outgoingNurseStaffId, incomingNurseStaffId, patientSummaries, codeBlueEvents, handoverNotes }) => {
      if (!shiftDate) throw Object.assign(new Error("Shift date is required"), { status: 400 });
      if (outgoingNurseStaffId.toString() === incomingNurseStaffId.toString()) {
        throw Object.assign(new Error("Outgoing and incoming nurses must be distinct staff members for shift handover"), { status: 400 });
      }
      const criticalCount = (patientSummaries || []).filter((p) => (p.news2Score || 0) >= 5).length;
      const handover = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        shiftDate,
        shiftType,
        outgoingNurseStaffId,
        incomingNurseStaffId,
        status: "pending",
        totalPatients: (patientSummaries || []).length,
        criticalPatientsCount: criticalCount,
        patientSummaries,
        codeBlueEvents,
        acknowledgedAt: null,
        handoverNotes,
      };
      state.handovers.push(handover);
      return { success: true, handover, criticalPatientsCount: criticalCount };
    },
    acceptShiftHandover: async ({ handoverId, actor, acceptanceNotes }) => {
      const handover = state.handovers.find((h) => h._id.toString() === handoverId.toString());
      if (!handover) throw Object.assign(new Error("Shift handover record not found"), { status: 404 });
      if (handover.acknowledgedAt) throw Object.assign(new Error("Shift handover has already been accepted"), { status: 409 });
      if (actor?.staffId && handover.outgoingNurseStaffId.toString() === actor.staffId.toString()) {
        throw Object.assign(new Error("Outgoing nurse cannot accept their own shift handover"), { status: 403 });
      }
      if (actor?.staffId && handover.incomingNurseStaffId.toString() !== actor.staffId.toString() && actor.role !== "DEPARTMENT_HEAD") {
        throw Object.assign(new Error("Only the designated incoming nurse can accept this shift handover"), { status: 403 });
      }
      handover.status = "accepted";
      handover.acknowledgedAt = new Date();
      handover.acknowledgedByStaffId = actor?.staffId || handover.incomingNurseStaffId;
      handover.acceptanceNotes = acceptanceNotes || "";
      return { success: true, handover };
    },
    getInpatientFlowsheet: async () => ({
      admissionId,
      vitalsHistory: state.vitals,
      activeOrders: state.orders.filter((o) => o.status === "active"),
      emarSchedule: state.emars,
    }),
    getShiftHandovers: async () => state.handovers,
    getInpatientOrders: async () => state.orders,
    getNursingVitals: async () => state.vitals,
    getEmarSchedule: async () => state.emars,
  });

  await t.test("1. Inpatient order creation and automatic eMAR dose scheduling", async () => {
    // 1. Regular Antibiotic Order (Ceftriaxone 1g IV BD for 5 days)
    const antibioticRes = await createInpatientOrder({
      hospitalId,
      admissionId,
      patientId,
      orderType: "medication",
      medicationDetails: {
        drugName: "Ceftriaxone",
        dose: "1g",
        route: "iv",
        frequency: "bd",
        durationDays: 5,
      },
      nursingInstructions: "Infuse over 30 minutes in 100ml NS",
      actor: { role: "DOCTOR", doctorId, staffId: doctorId },
    });

    assert.equal(antibioticRes.success, true);
    assert.equal(antibioticRes.order.orderType, "medication");
    assert.equal(antibioticRes.order.medicationDetails.drugName, "Ceftriaxone");
    assert.ok(antibioticRes.scheduledDosesCount >= 1);

    // Administrative ordering attempt fails with 403
    await assert.rejects(
      () =>
        createInpatientOrder({
          hospitalId,
          admissionId,
          patientId,
          orderType: "medication",
          medicationDetails: { drugName: "Amoxicillin", dose: "500mg" },
          actor: { role: "HOSPITAL_ADMIN", staffId: nurse1Id },
        }),
      /Administrative staff cannot prescribe clinical orders/
    );

    // Prescribing doctor forgery attempt fails with 403
    await assert.rejects(
      () =>
        createInpatientOrder({
          hospitalId,
          admissionId,
          patientId,
          orderType: "medication",
          medicationDetails: { drugName: "Amoxicillin", dose: "500mg" },
          prescribedByDoctorId: new mongoose.Types.ObjectId(), // Forged!
          actor: { role: "DOCTOR", doctorId, staffId: doctorId },
        }),
      /Cannot forge prescribedByDoctorId/
    );

    // Mismatched patient ID fails with 400
    await assert.rejects(
      () =>
        createInpatientOrder({
          hospitalId,
          admissionId,
          patientId: new mongoose.Types.ObjectId(), // Foreign patient!
          orderType: "medication",
          medicationDetails: { drugName: "Amoxicillin", dose: "500mg" },
          actor: { role: "DOCTOR", doctorId, staffId: doctorId },
        }),
      /Patient ID does not match active admission/
    );

    // Stale version discontinuation fails with 409
    await assert.rejects(
      () =>
        discontinueInpatientOrder({
          hospitalId,
          orderId: antibioticRes.order._id,
          reason: "Stale update attempt",
          expectedVersion: 99,
          actor: { role: "DOCTOR", doctorId },
        }),
      /Stale order version/
    );

    // Non-doctor discontinuation fails with 403
    await assert.rejects(
      () =>
        discontinueInpatientOrder({
          hospitalId,
          orderId: antibioticRes.order._id,
          reason: "Unauthorized attempt",
          actor: { role: "HOSPITAL_ADMIN", staffId: nurse1Id },
        }),
      /Administrative staff cannot discontinue clinical orders/
    );

    // 2. Legitimate discontinuation cancels future scheduled doses
    const discRes = await discontinueInpatientOrder({
      hospitalId,
      orderId: antibioticRes.order._id,
      reason: "Culture showed sensitivity to oral amoxicillin",
      expectedVersion: 0,
      actor: { role: "DOCTOR", doctorId },
    });
    assert.equal(discRes.success, true);
    assert.equal(discRes.order.status, "discontinued");
    assert.ok(discRes.cancelledDosesCount >= 1);
  });

  await t.test("2. Nursing high-frequency vitals flowsheet & NEWS2 clinical escalation", async () => {
    // 1. Normal vitals -> Low risk
    const normalVitals = {
      respirationRate: 16,
      spO2: 98,
      supplementalOxygen: false,
      systolicBP: 120,
      pulse: 72,
      consciousness: "A",
      temperature: 37.0,
      painScore: 2,
    };
    const normRes = await recordNursingVitals({
      hospitalId,
      admissionId,
      vitals: normalVitals,
      actor: { staffId: nurse1Id },
    });
    assert.equal(normRes.news2.score, 0);
    assert.equal(normRes.news2.riskLevel, "LOW");
    assert.equal(normRes.requiresCodeBlue, false);

    // 2. Critically deteriorating vitals -> Triggers Code Blue
    const criticalVitals = {
      respirationRate: 30, // 3
      spO2: 89,            // 3
      supplementalOxygen: true, // 2
      systolicBP: 80,      // 3
      pulse: 140,          // 3
      consciousness: "P",  // 3
      temperature: 39.2,   // 2
      painScore: 9,
    };
    const critRes = await recordNursingVitals({
      hospitalId,
      admissionId,
      vitals: criticalVitals,
      actor: { staffId: nurse1Id },
    });
    assert.ok(critRes.news2.score >= 7);
    assert.equal(critRes.news2.riskLevel, "HIGH");
    assert.equal(critRes.requiresCodeBlue, true);

    // Nurse attempting to acknowledge escalation fails with 403
    await assert.rejects(
      () =>
        acknowledgeVitalsEscalation({
          hospitalId,
          vitalsId: critRes.vitals._id,
          actor: { role: "NURSE", staffId: nurse1Id },
        }),
      /Only licensed doctors or department heads/
    );

    // Non-escalated vitals cannot be acknowledged (fails with 400)
    await assert.rejects(
      () =>
        acknowledgeVitalsEscalation({
          hospitalId,
          vitalsId: normRes.vitals._id,
          actor: { role: "DOCTOR", doctorId },
        }),
      /does not require clinical escalation/
    );

    // Doctor acknowledges clinical vitals escalation -> succeeds
    const ackRes = await acknowledgeVitalsEscalation({
      hospitalId,
      vitalsId: critRes.vitals._id,
      actor: { role: "DOCTOR", doctorId },
      responseNotes: "Code blue team dispatched to ICU bed 1",
    });
    assert.equal(ackRes.success, true);
    assert.ok(ackRes.vitals.escalationAcknowledgedAt);
    assert.equal(ackRes.vitals.escalationNotified, true);

    // Duplicate acknowledgement fails with 409
    await assert.rejects(
      () =>
        acknowledgeVitalsEscalation({
          hospitalId,
          vitalsId: critRes.vitals._id,
          actor: { role: "DOCTOR", doctorId },
        }),
      /already been acknowledged/
    );
  });

  await t.test("3. 5-Rights bedside medication administration enforcement", async () => {
    // Create new scheduled medication
    const { order } = await createInpatientOrder({
      hospitalId,
      admissionId,
      patientId,
      orderType: "medication",
      medicationDetails: {
        drugName: "Paracetamol",
        dose: "1g",
        route: "oral",
        frequency: "stat",
      },
    });

    const emar = state.emars.find((e) => e.orderId.toString() === order._id.toString() && e.status === "scheduled");
    assert.ok(emar);

    // Incomplete 5 rights (missing rightPatient) -> Fails with 400
    await assert.rejects(
      () =>
        administerMedication({
          hospitalId,
          emarId: emar._id,
          fiveRightsVerified: {
            rightPatient: false,
            rightDrug: true,
            rightDose: true,
            rightRoute: true,
            rightTime: true,
          },
          actor: { staffId: nurse1Id },
        }),
      /5-Rights bedside verification incomplete/
    );

    // All 5 rights verified -> Administered successfully
    const adminRes = await administerMedication({
      hospitalId,
      emarId: emar._id,
      fiveRightsVerified: {
        rightPatient: true,
        rightDrug: true,
        rightDose: true,
        rightRoute: true,
        rightTime: true,
      },
      actor: { staffId: nurse1Id },
    });

    assert.equal(adminRes.success, true);
    assert.equal(adminRes.emar.status, "administered");
    assert.ok(adminRes.emar.administeredAt);
  });

  await t.test("4. Mandatory dual-nurse verification for controlled substances (Schedule X / Narcotics)", async () => {
    // Morphine Sulfate (Schedule X Controlled Substance)
    const { order: morphineOrder } = await createInpatientOrder({
      hospitalId,
      admissionId,
      patientId,
      orderType: "medication",
      medicationDetails: {
        drugName: "Morphine Sulfate",
        dose: "5mg",
        route: "iv",
        frequency: "stat",
        isControlledSubstance: true,
      },
    });

    const morphineEmar = state.emars.find((e) => e.orderId.toString() === morphineOrder._id.toString() && e.status === "scheduled");
    assert.ok(morphineEmar);

    // Attempting administration without secondary witness fails
    await assert.rejects(
      () =>
        administerMedication({
          hospitalId,
          emarId: morphineEmar._id,
          fiveRightsVerified: {
            rightPatient: true,
            rightDrug: true,
            rightDose: true,
            rightRoute: true,
            rightTime: true,
          },
          actor: { staffId: nurse1Id },
        }),
      /Mandatory dual-nurse verification missing for controlled substance/
    );

    // Administering nurse cannot be their own secondary witness
    await assert.rejects(
      () =>
        administerMedication({
          hospitalId,
          emarId: morphineEmar._id,
          fiveRightsVerified: {
            rightPatient: true,
            rightDrug: true,
            rightDose: true,
            rightRoute: true,
            rightTime: true,
          },
          dualWitnessStaffId: nurse1Id, // Same nurse!
          dualWitnessSignature: "Sister Mary",
          actor: { staffId: nurse1Id },
        }),
      /Administering nurse cannot act as their own secondary witness/
    );

    // Legitimate dual-witness with distinct registered nurse
    const validNarcoticRes = await administerMedication({
      hospitalId,
      emarId: morphineEmar._id,
      fiveRightsVerified: {
        rightPatient: true,
        rightDrug: true,
        rightDose: true,
        rightRoute: true,
        rightTime: true,
      },
      dualWitnessStaffId: nurse2Id, // Distinct nurse!
      dualWitnessSignature: "Nurse Rita D'Souza RN",
      actor: { staffId: nurse1Id },
    });

    assert.equal(validNarcoticRes.success, true);
    assert.equal(validNarcoticRes.emar.status, "administered");
    assert.equal(validNarcoticRes.emar.dualWitnessSignature, "Nurse Rita D'Souza RN");
  });

  await t.test("5. Structured medication omission / refusal logging", async () => {
    const { order } = await createInpatientOrder({
      hospitalId,
      admissionId,
      patientId,
      orderType: "medication",
      medicationDetails: {
        drugName: "Metformin",
        dose: "500mg",
        route: "oral",
        frequency: "stat",
      },
    });

    const emar = state.emars.find((e) => e.orderId.toString() === order._id.toString() && e.status === "scheduled");
    assert.ok(emar);

    // Invalid omission reason rejected
    await assert.rejects(
      () =>
        recordMedicationOmission({
          hospitalId,
          emarId: emar._id,
          omissionReason: "forgot_to_give", // not an allowed reason
          actor: { staffId: nurse1Id },
        }),
      /Invalid omission reason/
    );

    // Patient refused
    const refuseRes = await recordMedicationOmission({
      hospitalId,
      emarId: emar._id,
      omissionReason: "patient_refused",
      omissionNote: "Patient states nausea and vomiting; prefers not to swallow tablet",
      actor: { staffId: nurse1Id },
    });

    assert.equal(refuseRes.success, true);
    assert.equal(refuseRes.emar.status, "refused");
    assert.equal(refuseRes.emar.omissionReason, "patient_refused");
    assert.ok(refuseRes.emar.omissionNote.includes("nausea"));
  });

  await t.test("6. Structured nurse shift handover between distinct staff members", async () => {
    // Same nurse cannot hand over to themselves
    await assert.rejects(
      () =>
        recordShiftHandover({
          hospitalId,
          wardId: new mongoose.Types.ObjectId(),
          shiftDate: "2026-10-22",
          shiftType: "morning",
          outgoingNurseStaffId: nurse1Id,
          incomingNurseStaffId: nurse1Id, // same!
        }),
      /Outgoing and incoming nurses must be distinct staff members/
    );

    // Valid handover with critical patient summary
    const handoverRes = await recordShiftHandover({
      hospitalId,
      wardId: new mongoose.Types.ObjectId(),
      shiftDate: "2026-10-22",
      shiftType: "morning",
      outgoingNurseStaffId: nurse1Id,
      incomingNurseStaffId: nurse2Id,
      patientSummaries: [
        {
          admissionId,
          bedNumber: "BED-101-A",
          patientName: "Ramesh Patel",
          diagnosis: "Post-op Cholecystectomy",
          news2Score: 2,
          pendingTasks: ["Change IV cannula site at 14:00"],
        },
        {
          admissionId: new mongoose.Types.ObjectId(),
          bedNumber: "BED-101-B",
          patientName: "Arun Joshi",
          diagnosis: "Severe Acute Pancreatitis",
          news2Score: 6, // Critical!
          pendingTasks: ["Urgent blood gas repeat at 12:00"],
          criticalAlerts: "Hypotensive episode at 06:30, notify Dr. Sharma",
        },
      ],
      codeBlueEvents: [],
      handoverNotes: "Ward fully staffed. Narcotic count verified with Sister Rita.",
      actor: { staffId: nurse1Id },
    });

    assert.equal(handoverRes.success, true);
    assert.equal(handoverRes.handover.totalPatients, 2);
    assert.equal(handoverRes.criticalPatientsCount, 1);
    assert.equal(handoverRes.handover.status, "pending");
    assert.equal(handoverRes.handover.acknowledgedAt, null);

    // Outgoing nurse attempting self-acceptance fails with 403
    await assert.rejects(
      () =>
        acceptShiftHandover({
          hospitalId,
          handoverId: handoverRes.handover._id,
          actor: { role: "NURSE", staffId: nurse1Id },
        }),
      /Outgoing nurse cannot accept their own shift handover/
    );

    // Wrong nurse attempting acceptance fails with 403
    await assert.rejects(
      () =>
        acceptShiftHandover({
          hospitalId,
          handoverId: handoverRes.handover._id,
          actor: { role: "NURSE", staffId: new mongoose.Types.ObjectId() },
        }),
      /Only the designated incoming nurse can accept this shift handover/
    );

    // Legitimate incoming nurse accepts handover
    const acceptRes = await acceptShiftHandover({
      hospitalId,
      handoverId: handoverRes.handover._id,
      actor: { role: "NURSE", staffId: nurse2Id },
      acceptanceNotes: "Acknowledged all 2 patients and checked narcotic count.",
    });
    assert.equal(acceptRes.success, true);
    assert.equal(acceptRes.handover.status, "accepted");
    assert.ok(acceptRes.handover.acknowledgedAt);

    // Duplicate acceptance fails with 409
    await assert.rejects(
      () =>
        acceptShiftHandover({
          hospitalId,
          handoverId: handoverRes.handover._id,
          actor: { role: "NURSE", staffId: nurse2Id },
        }),
      /Shift handover has already been accepted/
    );

    // Verify flowsheet aggregation
    const flowsheet = await getInpatientFlowsheet({ hospitalId, admissionId });
    assert.ok(flowsheet.vitalsHistory.length >= 2);
    assert.ok(flowsheet.emarSchedule.length >= 1);
  });

  await t.test("7. Disconnected DB fail-closed check", async () => {
    setNursingTestDouble(null);

    await assert.rejects(
      () => createInpatientOrder({ hospitalId, admissionId, orderType: "medication" }),
      (err) => err.status === 503 || err.message.includes("Database service is unavailable")
    );
  });

  await t.test("8. Flowsheet query helpers (handovers, orders, vitals, emar)", async () => {
    // Re-bind test double
    setNursingTestDouble({
      getShiftHandovers: async () => state.handovers,
      getInpatientOrders: async () => state.orders,
      getNursingVitals: async () => state.vitals,
      getEmarSchedule: async () => state.emars,
    });

    const [handovers, orders, vitals, emar] = await Promise.all([
      getShiftHandovers({ hospitalId }),
      getInpatientOrders({ hospitalId, admissionId }),
      getNursingVitals({ hospitalId, admissionId }),
      getEmarSchedule({ hospitalId, admissionId }),
    ]);

    assert.ok(Array.isArray(handovers));
    assert.ok(Array.isArray(orders));
    assert.ok(Array.isArray(vitals));
    assert.ok(Array.isArray(emar));
  });
});
