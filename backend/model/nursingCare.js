import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

// 1. Inpatient Clinical & Medication Order Schema
const inpatientOrderSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    admissionId: { type: objectId, ref: "IpdAdmission", required: true, index: true },
    patientId: { type: objectId, ref: "user", required: true, index: true },
    orderType: {
      type: String,
      enum: ["medication", "investigation", "nursing_care", "diet", "monitoring"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "active", "completed", "discontinued", "cancelled"],
      default: "active",
      index: true,
    },
    prescribedByDoctorId: { type: objectId, ref: "doctor", required: true },
    departmentId: { type: objectId, ref: "Department" },
    medicationDetails: {
      drugName: { type: String, trim: true },
      dose: { type: String, trim: true },
      route: {
        type: String,
        enum: ["oral", "iv", "im", "sc", "inhalation", "topical", "rectal"],
        default: "oral",
      },
      frequency: {
        type: String,
        enum: ["stat", "od", "bd", "tds", "qid", "prn", "q4h", "q6h", "q8h"],
        default: "od",
      },
      durationDays: { type: Number, default: 1, min: 1 },
      isHighAlert: { type: Boolean, default: false },
      isControlledSubstance: { type: Boolean, default: false }, // Narcotic / Schedule X
      specialInstructions: { type: String, default: "" },
    },
    nursingInstructions: { type: String, default: "" },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    discontinuedReason: { type: String, default: "" },
    discontinuedByDoctorId: { type: objectId, ref: "doctor", default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// 2. Nursing High-Frequency Vitals & NEWS2 Flowsheet Schema
const nursingVitalsSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    admissionId: { type: objectId, ref: "IpdAdmission", required: true, index: true },
    patientId: { type: objectId, ref: "user", required: true, index: true },
    recordedByStaffId: { type: objectId, ref: "HospitalStaff", required: true },
    respirationRate: { type: Number, required: true }, // breaths/min
    spO2: { type: Number, required: true }, // %
    supplementalOxygen: { type: Boolean, default: false },
    systolicBP: { type: Number, required: true }, // mmHg
    diastolicBP: { type: Number, default: 80 }, // mmHg
    pulse: { type: Number, required: true }, // bpm
    consciousness: {
      type: String,
      enum: ["A", "V", "P", "U"],
      default: "A",
    },
    temperature: { type: Number, required: true }, // Celsius
    painScore: { type: Number, min: 0, max: 10, default: 0 },
    bloodGlucose: { type: Number, default: null }, // mg/dL
    news2: {
      score: { type: Number, required: true },
      riskLevel: {
        type: String,
        enum: ["LOW", "LOW_MEDIUM", "MEDIUM", "HIGH"],
        required: true,
      },
      action: { type: String, required: true },
      requiresDoctorEscalation: { type: Boolean, default: false },
      requiresCodeBlue: { type: Boolean, default: false },
    },
    escalationNotified: { type: Boolean, default: false },
    escalatedToDoctorId: { type: objectId, ref: "doctor", default: null },
    recordedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// 3. Electronic Medication Administration Record (eMAR) Schema
const emarSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    admissionId: { type: objectId, ref: "IpdAdmission", required: true, index: true },
    orderId: { type: objectId, ref: "InpatientOrder", required: true, index: true },
    patientId: { type: objectId, ref: "user", required: true, index: true },
    scheduledTime: { type: Date, required: true, index: true },
    administeredAt: { type: Date, default: null },
    administeredByStaffId: { type: objectId, ref: "HospitalStaff", default: null },
    status: {
      type: String,
      enum: ["scheduled", "administered", "omitted", "refused", "delayed", "cancelled"],
      default: "scheduled",
      index: true,
    },
    fiveRightsVerified: {
      rightPatient: { type: Boolean, default: false },
      rightDrug: { type: Boolean, default: false },
      rightDose: { type: Boolean, default: false },
      rightRoute: { type: Boolean, default: false },
      rightTime: { type: Boolean, default: false },
    },
    omissionReason: {
      type: String,
      enum: [
        "",
        "patient_refused",
        "fasting_for_procedure",
        "medication_unavailable",
        "vital_contraindicated",
        "clinician_hold",
      ],
      default: "",
    },
    omissionNote: { type: String, default: "" },
    dualWitnessStaffId: { type: objectId, ref: "HospitalStaff", default: null },
    dualWitnessSignature: { type: String, default: "" },
    injectionSite: { type: String, default: "" },
    patientReaction: { type: String, default: "" },
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// 4. Nurse Shift Handover Schema
const nurseShiftHandoverSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    wardId: { type: objectId, ref: "Ward", required: true, index: true },
    shiftDate: { type: String, required: true }, // YYYY-MM-DD
    shiftType: {
      type: String,
      enum: ["morning", "evening", "night"],
      required: true,
    },
    outgoingNurseStaffId: { type: objectId, ref: "HospitalStaff", required: true },
    incomingNurseStaffId: { type: objectId, ref: "HospitalStaff", required: true },
    totalPatients: { type: Number, default: 0 },
    criticalPatientsCount: { type: Number, default: 0 },
    patientSummaries: [
      {
        admissionId: { type: objectId, ref: "IpdAdmission" },
        bedNumber: { type: String, default: "" },
        patientName: { type: String, default: "" },
        diagnosis: { type: String, default: "" },
        news2Score: { type: Number, default: 0 },
        pendingTasks: [{ type: String }],
        criticalAlerts: { type: String, default: "" },
      },
    ],
    codeBlueEvents: [
      {
        admissionId: { type: objectId, ref: "IpdAdmission" },
        eventTime: { type: Date, default: Date.now },
        intervention: { type: String, default: "" },
        outcome: { type: String, default: "" },
      },
    ],
    acknowledgedAt: { type: Date, default: null },
    handoverNotes: { type: String, default: "" },
  },
  { timestamps: true }
);

nurseShiftHandoverSchema.index({ hospitalId: 1, wardId: 1, shiftDate: 1, shiftType: 1 });

export const InpatientOrder = mongoose.models.InpatientOrder || mongoose.model("InpatientOrder", inpatientOrderSchema);
export const NursingVitals = mongoose.models.NursingVitals || mongoose.model("NursingVitals", nursingVitalsSchema);
export const MedicationAdministrationRecord = mongoose.models.MedicationAdministrationRecord || mongoose.model("MedicationAdministrationRecord", emarSchema);
export const NurseShiftHandover = mongoose.models.NurseShiftHandover || mongoose.model("NurseShiftHandover", nurseShiftHandoverSchema);

export default {
  InpatientOrder,
  NursingVitals,
  MedicationAdministrationRecord,
  NurseShiftHandover,
};
