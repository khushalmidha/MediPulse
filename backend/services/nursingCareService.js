import mongoose from "mongoose";
import {
  InpatientOrder,
  NursingVitals,
  MedicationAdministrationRecord,
  NurseShiftHandover,
} from "../model/nursingCare.js";
import { IpdAdmission } from "../model/inpatient.js";
import Hospital from "../model/hospital.js";
import { accessError } from "./hospitalAccess.js";
import { moneyTransaction } from "./moneyTransaction.js";
import { calculateNews2Score } from "../config/enterprisePlan.js";
import { assertTenantNotSuspended, checkFeatureEntitlement } from "./saasOperationsService.js";

let testDouble = null;
export const setNursingTestDouble = (double) => {
  if (process.env.NODE_ENV !== "test") throw new Error("Enterprise test adapters are only available in tests");
  testDouble = double;
};

const assertDbConnected = () => {
  if (!testDouble && mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }
};

/**
 * Frequency helper to calculate administration intervals in hours
 */
const FREQUENCY_INTERVALS_HOURS = {
  stat: 0,
  od: 24,
  bd: 12,
  tds: 8,
  qid: 6,
  q4h: 4,
  q6h: 6,
  q8h: 8,
  prn: 0,
};

/**
 * 1. Clinician Inpatient Orders (Medication, Nursing, Monitoring)
 */
export const createInpatientOrder = async ({
  hospitalId,
  admissionId,
  patientId,
  orderType,
  medicationDetails = {},
  nursingInstructions = "",
  startDate = new Date(),
  prescribedByDoctorId = null,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.createInpatientOrder) {
    return testDouble.createInpatientOrder({
      hospitalId,
      admissionId,
      patientId,
      orderType,
      medicationDetails,
      nursingInstructions,
      startDate,
      prescribedByDoctorId,
      actor,
    });
  }

  const validTypes = ["medication", "investigation", "nursing_care", "diet", "monitoring"];
  if (!validTypes.includes(orderType)) {
    throw accessError(400, `Invalid order type: ${orderType}. Allowed: ${validTypes.join(", ")}`);
  }

  if (orderType === "medication") {
    if (!medicationDetails.drugName || !String(medicationDetails.drugName).trim()) {
      throw accessError(400, "Drug name is required for medication orders");
    }
    if (!medicationDetails.dose || !String(medicationDetails.dose).trim()) {
      throw accessError(400, "Dose is required for medication orders");
    }
  }

  return await moneyTransaction(async (session) => {
    const hospital = await Hospital.findById(hospitalId).session(session);
    if (!hospital) throw accessError(404, "Hospital not found");
    assertTenantNotSuspended(hospital);
    checkFeatureEntitlement(hospital, "ipd_beds");

    const admission = await IpdAdmission.findOne({
      _id: admissionId,
      hospitalId,
      status: "admitted",
    }).session(session);
    if (!admission) throw accessError(404, "Active inpatient admission not found");

    const durationDays = Math.max(1, Number(medicationDetails.durationDays) || 1);
    const orderStartDate = new Date(startDate);
    const orderEndDate = new Date(orderStartDate.getTime() + durationDays * 24 * 3600 * 1000);

    const [order] = await InpatientOrder.create(
      [
        {
          hospitalId,
          admissionId,
          patientId: admission.patientId,
          orderType,
          status: "active",
          prescribedByDoctorId: prescribedByDoctorId || actor?.doctorId || admission.admittingDoctorId,
          departmentId: admission.departmentId,
          medicationDetails: {
            drugName: String(medicationDetails.drugName || "").trim(),
            dose: String(medicationDetails.dose || "").trim(),
            route: medicationDetails.route || "oral",
            frequency: medicationDetails.frequency || "od",
            durationDays,
            isHighAlert: Boolean(medicationDetails.isHighAlert),
            isControlledSubstance: Boolean(medicationDetails.isControlledSubstance),
            specialInstructions: String(medicationDetails.specialInstructions || "").trim(),
          },
          nursingInstructions: String(nursingInstructions || "").trim(),
          startDate: orderStartDate,
          endDate: orderEndDate,
        },
      ],
      { session }
    );

    // If medication order, automatically schedule eMAR doses
    const emarDoses = [];
    if (orderType === "medication") {
      const freq = medicationDetails.frequency || "od";
      const intervalHours = FREQUENCY_INTERVALS_HOURS[freq] ?? 24;

      if (freq === "stat" || freq === "prn" || intervalHours === 0) {
        emarDoses.push({
          hospitalId,
          admissionId,
          orderId: order._id,
          patientId: admission.patientId,
          scheduledTime: orderStartDate,
          status: "scheduled",
        });
      } else {
        const totalDoses = Math.max(1, Math.floor((durationDays * 24) / intervalHours));
        for (let i = 0; i < totalDoses; i++) {
          const doseTime = new Date(orderStartDate.getTime() + i * intervalHours * 3600 * 1000);
          emarDoses.push({
            hospitalId,
            admissionId,
            orderId: order._id,
            patientId: admission.patientId,
            scheduledTime: doseTime,
            status: "scheduled",
          });
        }
      }

      if (emarDoses.length > 0) {
        await MedicationAdministrationRecord.insertMany(emarDoses, { session });
      }
    }

    return {
      success: true,
      order,
      scheduledDosesCount: emarDoses.length,
    };
  });
};

/**
 * 2. Order Discontinuation (preserving historical administrations)
 */
export const discontinueInpatientOrder = async ({
  hospitalId,
  orderId,
  reason,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.discontinueInpatientOrder) {
    return testDouble.discontinueInpatientOrder({ hospitalId, orderId, reason, actor });
  }

  if (!reason || !String(reason).trim()) {
    throw accessError(400, "Reason for order discontinuation is required");
  }

  return await moneyTransaction(async (session) => {
    const order = await InpatientOrder.findOne({
      _id: orderId,
      hospitalId,
      status: "active",
    }).session(session);

    if (!order) throw accessError(404, "Active inpatient order not found");

    order.status = "discontinued";
    order.discontinuedReason = String(reason).trim();
    order.discontinuedByDoctorId = actor?.doctorId || null;
    order.version = (order.version || 0) + 1;
    await order.save({ session });

    // Cancel remaining future scheduled doses without touching administered/omitted records
    const cancelResult = await MedicationAdministrationRecord.updateMany(
      {
        hospitalId,
        orderId: order._id,
        status: "scheduled",
      },
      {
        $set: { status: "cancelled", omissionNote: `Order discontinued: ${reason}` },
      },
      { session }
    );

    return {
      success: true,
      order,
      cancelledDosesCount: cancelResult.modifiedCount,
    };
  });
};

/**
 * 3. High-Frequency Nursing Vitals & Objective NEWS2 Scoring
 */
export const recordNursingVitals = async ({
  hospitalId,
  admissionId,
  vitals,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.recordNursingVitals) {
    return testDouble.recordNursingVitals({ hospitalId, admissionId, vitals, actor });
  }

  if (!vitals || typeof vitals !== "object") {
    throw accessError(400, "Vitals measurements payload is required");
  }

  const admission = await IpdAdmission.findOne({
    _id: admissionId,
    hospitalId,
    status: "admitted",
  });
  if (!admission) throw accessError(404, "Active inpatient admission not found");

  // Calculate deterministic NEWS2 score using our audited clinical formula
  const news2Result = calculateNews2Score(vitals);

  const vitalsRecord = await NursingVitals.create({
    hospitalId,
    admissionId,
    patientId: admission.patientId,
    recordedByStaffId: actor?.staffId || admission.primaryNurseId,
    respirationRate: vitals.respirationRate,
    spO2: vitals.spO2,
    supplementalOxygen: Boolean(vitals.supplementalOxygen),
    systolicBP: vitals.systolicBP,
    diastolicBP: vitals.diastolicBP || 80,
    pulse: vitals.pulse,
    consciousness: (vitals.consciousness || "A").toUpperCase(),
    temperature: vitals.temperature,
    painScore: Number(vitals.painScore) || 0,
    bloodGlucose: vitals.bloodGlucose || null,
    news2: {
      score: news2Result.score,
      riskLevel: news2Result.riskLevel,
      action: news2Result.action,
      requiresDoctorEscalation: news2Result.requiresDoctorEscalation,
      requiresCodeBlue: news2Result.requiresCodeBlue,
    },
    escalationNotified: news2Result.requiresDoctorEscalation,
    escalatedToDoctorId: news2Result.requiresDoctorEscalation ? admission.attendingDoctorId : null,
  });

  return {
    success: true,
    vitals: vitalsRecord,
    news2: news2Result,
    requiresCodeBlue: news2Result.requiresCodeBlue,
  };
};

/**
 * 4. Bedside Medication Administration (5-Rights & Dual-Nurse Controlled Sign-off)
 */
export const administerMedication = async ({
  hospitalId,
  emarId,
  fiveRightsVerified = {},
  dualWitnessStaffId = null,
  dualWitnessSignature = "",
  injectionSite = "",
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.administerMedication) {
    return testDouble.administerMedication({
      hospitalId,
      emarId,
      fiveRightsVerified,
      dualWitnessStaffId,
      dualWitnessSignature,
      injectionSite,
      actor,
    });
  }

  const { rightPatient, rightDrug, rightDose, rightRoute, rightTime } = fiveRightsVerified;
  if (!rightPatient || !rightDrug || !rightDose || !rightRoute || !rightTime) {
    throw accessError(
      400,
      "5-Rights bedside verification incomplete. Must verify Right Patient, Right Drug, Right Dose, Right Route, and Right Time."
    );
  }

  return await moneyTransaction(async (session) => {
    const emar = await MedicationAdministrationRecord.findOne({
      _id: emarId,
      hospitalId,
      status: { $in: ["scheduled", "delayed"] },
    })
      .populate("orderId")
      .session(session);

    if (!emar) throw accessError(404, "Pending medication administration record not found");

    const order = emar.orderId;
    const isControlled = order?.medicationDetails?.isControlledSubstance;
    const isHighAlert = order?.medicationDetails?.isHighAlert;

    // Dual-nurse witness verification rule for controlled substances / high alert
    if (isControlled || isHighAlert) {
      if (!dualWitnessStaffId || !String(dualWitnessSignature).trim()) {
        const substanceLabel = isControlled ? "Controlled Substance (Schedule X / Narcotic)" : "High-Alert Medication";
        throw accessError(
          403,
          `Mandatory dual-nurse verification missing. Administration of ${substanceLabel} requires a secondary witness staff ID and signature.`
        );
      }
      if (actor?.staffId && String(dualWitnessStaffId) === String(actor.staffId)) {
        throw accessError(403, "Administering nurse cannot act as their own secondary witness");
      }
    }

    emar.status = "administered";
    emar.administeredAt = new Date();
    emar.administeredByStaffId = actor?.staffId || null;
    emar.fiveRightsVerified = {
      rightPatient: true,
      rightDrug: true,
      rightDose: true,
      rightRoute: true,
      rightTime: true,
    };
    if (dualWitnessStaffId) {
      emar.dualWitnessStaffId = dualWitnessStaffId;
      emar.dualWitnessSignature = String(dualWitnessSignature).trim();
    }
    if (injectionSite) emar.injectionSite = String(injectionSite).trim();
    emar.version = (emar.version || 0) + 1;

    await emar.save({ session });

    return {
      success: true,
      emar,
      drugName: order?.medicationDetails?.drugName,
      dose: order?.medicationDetails?.dose,
    };
  });
};

/**
 * 5. Medication Omission / Refusal Logging with Structured Reasons
 */
export const recordMedicationOmission = async ({
  hospitalId,
  emarId,
  omissionReason,
  omissionNote = "",
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.recordMedicationOmission) {
    return testDouble.recordMedicationOmission({ hospitalId, emarId, omissionReason, omissionNote, actor });
  }

  const validReasons = [
    "patient_refused",
    "fasting_for_procedure",
    "medication_unavailable",
    "vital_contraindicated",
    "clinician_hold",
  ];
  if (!validReasons.includes(omissionReason)) {
    throw accessError(
      400,
      `Invalid omission reason: '${omissionReason}'. Allowed: [${validReasons.join(", ")}]`
    );
  }

  const emar = await MedicationAdministrationRecord.findOne({
    _id: emarId,
    hospitalId,
    status: { $in: ["scheduled", "delayed"] },
  });
  if (!emar) throw accessError(404, "Pending medication administration record not found");

  emar.status = omissionReason === "patient_refused" ? "refused" : "omitted";
  emar.omissionReason = omissionReason;
  emar.omissionNote = String(omissionNote).trim();
  emar.administeredByStaffId = actor?.staffId || null;
  emar.administeredAt = new Date();
  emar.version = (emar.version || 0) + 1;

  await emar.save();

  return {
    success: true,
    emar,
  };
};

/**
 * 6. Structured Nurse Shift Handover
 */
export const recordShiftHandover = async ({
  hospitalId,
  wardId,
  shiftDate,
  shiftType,
  outgoingNurseStaffId,
  incomingNurseStaffId,
  patientSummaries = [],
  codeBlueEvents = [],
  handoverNotes = "",
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.recordShiftHandover) {
    return testDouble.recordShiftHandover({
      hospitalId,
      wardId,
      shiftDate,
      shiftType,
      outgoingNurseStaffId,
      incomingNurseStaffId,
      patientSummaries,
      codeBlueEvents,
      handoverNotes,
      actor,
    });
  }

  if (!shiftDate) throw accessError(400, "Shift date (YYYY-MM-DD) is required");
  const validShifts = ["morning", "evening", "night"];
  if (!validShifts.includes(shiftType)) {
    throw accessError(400, `Invalid shift type: '${shiftType}'. Allowed: [${validShifts.join(", ")}]`);
  }

  if (String(outgoingNurseStaffId) === String(incomingNurseStaffId)) {
    throw accessError(400, "Outgoing and incoming nurses must be distinct staff members for shift handover");
  }

  const criticalCount = patientSummaries.filter((p) => (p.news2Score || 0) >= 5).length;

  const handover = await NurseShiftHandover.create({
    hospitalId,
    wardId,
    shiftDate: String(shiftDate).trim(),
    shiftType,
    outgoingNurseStaffId,
    incomingNurseStaffId,
    totalPatients: patientSummaries.length,
    criticalPatientsCount: criticalCount,
    patientSummaries,
    codeBlueEvents,
    acknowledgedAt: new Date(),
    handoverNotes: String(handoverNotes).trim(),
  });

  return {
    success: true,
    handover,
    criticalPatientsCount: criticalCount,
  };
};

/**
 * 7. Inpatient Nursing Flowsheet & eMAR Schedule View
 */
export const getInpatientFlowsheet = async ({ hospitalId, admissionId }) => {
  assertDbConnected();
  if (testDouble?.getInpatientFlowsheet) {
    return testDouble.getInpatientFlowsheet({ hospitalId, admissionId });
  }

  const [vitalsHistory, activeOrders, emarSchedule] = await Promise.all([
    NursingVitals.find({ hospitalId, admissionId })
      .populate("recordedByStaffId", "name role")
      .sort({ recordedAt: -1 })
      .limit(50)
      .lean(),
    InpatientOrder.find({ hospitalId, admissionId, status: "active" })
      .populate("prescribedByDoctorId", "name specialization")
      .lean(),
    MedicationAdministrationRecord.find({ hospitalId, admissionId })
      .populate("orderId", "medicationDetails orderType")
      .populate("administeredByStaffId", "name")
      .populate("dualWitnessStaffId", "name")
      .sort({ scheduledTime: 1 })
      .lean(),
  ]);

  return {
    admissionId,
    vitalsHistory,
    activeOrders,
    emarSchedule,
  };
};

/**
 * 8. Query Handovers by Ward / Shift Date
 */
export const getShiftHandovers = async ({ hospitalId, wardId, shiftDate, limit = 20 }) => {
  assertDbConnected();
  if (testDouble?.getShiftHandovers) {
    return testDouble.getShiftHandovers({ hospitalId, wardId, shiftDate, limit });
  }

  const query = { hospitalId };
  if (wardId) query.wardId = wardId;
  if (shiftDate) query.shiftDate = shiftDate;

  return await NurseShiftHandover.find(query)
    .populate("wardId", "name code")
    .populate("outgoingNurseStaffId", "name role")
    .populate("incomingNurseStaffId", "name role")
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 20, 100))
    .lean();
};

/**
 * 9. Query Inpatient Orders
 */
export const getInpatientOrders = async ({ hospitalId, admissionId, status, orderType }) => {
  assertDbConnected();
  if (testDouble?.getInpatientOrders) {
    return testDouble.getInpatientOrders({ hospitalId, admissionId, status, orderType });
  }

  const query = { hospitalId };
  if (admissionId) query.admissionId = admissionId;
  if (status) query.status = status;
  if (orderType) query.orderType = orderType;

  return await InpatientOrder.find(query)
    .populate("prescribedByDoctorId", "name specialization")
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * 10. Query Nursing Vitals Log
 */
export const getNursingVitals = async ({ hospitalId, admissionId, limit = 50 }) => {
  assertDbConnected();
  if (testDouble?.getNursingVitals) {
    return testDouble.getNursingVitals({ hospitalId, admissionId, limit });
  }

  const query = { hospitalId };
  if (admissionId) query.admissionId = admissionId;

  return await NursingVitals.find(query)
    .populate("recordedByStaffId", "name role")
    .sort({ recordedAt: -1 })
    .limit(Math.min(Number(limit) || 50, 100))
    .lean();
};

/**
 * 11. Query eMAR Records
 */
export const getEmarSchedule = async ({ hospitalId, admissionId, status }) => {
  assertDbConnected();
  if (testDouble?.getEmarSchedule) {
    return testDouble.getEmarSchedule({ hospitalId, admissionId, status });
  }

  const query = { hospitalId };
  if (admissionId) query.admissionId = admissionId;
  if (status) query.status = status;

  return await MedicationAdministrationRecord.find(query)
    .populate("orderId", "medicationDetails orderType")
    .populate("administeredByStaffId", "name")
    .populate("dualWitnessStaffId", "name")
    .sort({ scheduledTime: 1 })
    .lean();
};

export default {
  createInpatientOrder,
  discontinueInpatientOrder,
  recordNursingVitals,
  administerMedication,
  recordMedicationOmission,
  recordShiftHandover,
  getInpatientFlowsheet,
  getShiftHandovers,
  getInpatientOrders,
  getNursingVitals,
  getEmarSchedule,
};
