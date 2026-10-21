import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

// 1. Emergency Department Registration & Triage Schema
const emergencyRegistrationSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    emergencyNumber: { type: String, required: true, unique: true, index: true },
    patientId: { type: objectId, ref: "user", default: null, index: true },
    patientName: { type: String, required: true, trim: true },
    age: { type: Number, default: null },
    gender: { type: String, default: "unknown" },
    arrivalMode: {
      type: String,
      enum: ["walk_in", "ambulance", "police", "internal_transfer"],
      default: "walk_in",
    },
    arrivalTime: { type: Date, default: Date.now, index: true },
    triageLevel: { type: Number, enum: [1, 2, 3, 4, 5], required: true, index: true },
    triageCategory: {
      type: String,
      enum: ["RESUSCITATION", "EMERGENT", "URGENT", "LESS_URGENT", "NON_URGENT"],
      required: true,
    },
    chiefComplaint: { type: String, required: true, trim: true },
    assignedBay: { type: String, default: "" },
    attendingDoctorId: { type: objectId, ref: "doctor", default: null },
    triagedByStaffId: { type: objectId, ref: "HospitalStaff", default: null },
    status: {
      type: String,
      enum: ["triaged", "in_treatment", "admitted_ipd", "transferred_out", "discharged", "deceased"],
      default: "triaged",
      index: true,
    },
    linkedAdmissionId: { type: objectId, ref: "IpdAdmission", default: null },
    outcomeNotes: { type: String, default: "" },
    dispositionTime: { type: Date, default: null },
  },
  { timestamps: true }
);

// 2. Theatre Room Schema
const theatreRoomSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    theatreCode: { type: String, required: true, trim: true, uppercase: true },
    theatreName: { type: String, required: true, trim: true },
    theatreType: {
      type: String,
      enum: ["major", "minor", "emergency", "cardiac", "ortho", "neuro"],
      default: "major",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

theatreRoomSchema.index({ hospitalId: 1, theatreCode: 1 }, { unique: true });

// 3. Operation Theatre Booking & Surgical Safety Checklist Schema
const otScheduleSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    bookingNumber: { type: String, required: true, unique: true, index: true },
    theatreRoomId: { type: objectId, ref: "TheatreRoom", required: true, index: true },
    patientId: { type: objectId, ref: "user", required: true, index: true },
    admissionId: { type: objectId, ref: "IpdAdmission", default: null, index: true },
    emergencyRegistrationId: { type: objectId, ref: "EmergencyRegistration", default: null },
    leadSurgeonDoctorId: { type: objectId, ref: "doctor", required: true, index: true },
    anesthetistDoctorId: { type: objectId, ref: "doctor", required: true, index: true },
    scrubNurseStaffId: { type: objectId, ref: "HospitalStaff", default: null },
    procedureName: { type: String, required: true, trim: true },
    urgency: {
      type: String,
      enum: ["elective", "urgent", "emergency_stat"],
      default: "elective",
      index: true,
    },
    scheduledStartTime: { type: Date, required: true, index: true },
    scheduledEndTime: { type: Date, required: true },
    actualStartTime: { type: Date, default: null },
    actualEndTime: { type: Date, default: null },
    status: {
      type: String,
      enum: ["scheduled", "in_progress", "completed", "cancelled", "rescheduled"],
      default: "scheduled",
      index: true,
    },
    cancellationReason: { type: String, default: "" },
    cancellationTimestamp: { type: Date, default: null },
    whoChecklist: {
      signIn: {
        completed: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        verifiedByStaffId: { type: objectId, ref: "HospitalStaff", default: null },
        checkpoints: { type: Map, of: Boolean, default: {} },
      },
      timeOut: {
        completed: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        verifiedByDoctorId: { type: objectId, ref: "doctor", default: null },
        checkpoints: { type: Map, of: Boolean, default: {} },
      },
      signOut: {
        completed: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        verifiedByStaffId: { type: objectId, ref: "HospitalStaff", default: null },
        checkpoints: { type: Map, of: Boolean, default: {} },
      },
    },
    pacu: {
      aldreteScore: { type: Number, min: 0, max: 10, default: null },
      recoveryNurseStaffId: { type: objectId, ref: "HospitalStaff", default: null },
      dischargedToWard: { type: Boolean, default: false },
      dischargedAt: { type: Date, default: null },
    },
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

otScheduleSchema.index({ hospitalId: 1, theatreRoomId: 1, scheduledStartTime: 1, scheduledEndTime: 1 });

export const EmergencyRegistration =
  mongoose.models.EmergencyRegistration || mongoose.model("EmergencyRegistration", emergencyRegistrationSchema);
export const TheatreRoom =
  mongoose.models.TheatreRoom || mongoose.model("TheatreRoom", theatreRoomSchema);
export const OtSchedule =
  mongoose.models.OtSchedule || mongoose.model("OtSchedule", otScheduleSchema);

export default {
  EmergencyRegistration,
  TheatreRoom,
  OtSchedule,
};
