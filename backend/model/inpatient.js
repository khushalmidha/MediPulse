import mongoose from "mongoose";
import { BED_STATUSES } from "../config/enterprisePlan.js";

const objectId = mongoose.Schema.Types.ObjectId;

// 1. Ward Schema
const wardSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    floor: { type: String, default: "1" },
    building: { type: String, default: "Main" },
    genderPolicy: {
      type: String,
      enum: ["all", "male", "female", "pediatric"],
      default: "all",
    },
    nurseStation: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

wardSchema.index({ hospitalId: 1, code: 1 }, { unique: true });

// 2. Room Schema
const roomSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    wardId: { type: objectId, ref: "Ward", required: true, index: true },
    roomNumber: { type: String, required: true, trim: true },
    roomType: {
      type: String,
      enum: ["general", "semi_private", "private", "deluxe", "icu", "isolation"],
      default: "general",
    },
    dailyTariffMinor: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

roomSchema.index({ hospitalId: 1, wardId: 1, roomNumber: 1 }, { unique: true });

// 3. Bed Schema
const bedSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    wardId: { type: objectId, ref: "Ward", required: true, index: true },
    roomId: { type: objectId, ref: "Room", required: true, index: true },
    bedNumber: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: BED_STATUSES,
      default: "available",
      index: true,
    },
    currentAdmissionId: { type: objectId, ref: "IpdAdmission", default: null },
    currentPatientId: { type: objectId, ref: "User", default: null },
    maintenanceNote: { type: String, default: "" },
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

bedSchema.index({ hospitalId: 1, roomId: 1, bedNumber: 1 }, { unique: true });

// 4. Inpatient Admission Schema
const ipdAdmissionSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    admissionNumber: { type: String, required: true, unique: true, index: true },
    patientId: { type: objectId, ref: "User", required: true, index: true },
    familyMemberId: { type: String, default: null },
    encounterJourneyId: { type: objectId, ref: "EncounterJourney", default: null },
    admittingDoctorId: { type: objectId, ref: "Doctor", required: true },
    attendingDoctorId: { type: objectId, ref: "Doctor" },
    primaryNurseId: { type: objectId, ref: "HospitalStaff" },
    departmentId: { type: objectId, ref: "Department", required: true, index: true },
    currentWardId: { type: objectId, ref: "Ward", required: true },
    currentRoomId: { type: objectId, ref: "Room", required: true },
    currentBedId: { type: objectId, ref: "Bed", required: true, index: true },
    admittingDiagnosis: { type: String, required: true, trim: true },
    isMlc: { type: Boolean, default: false },
    advanceDepositMinor: { type: Number, default: 0, min: 0 },
    estimatedLengthOfStayDays: { type: Number, default: 3 },
    status: {
      type: String,
      enum: ["admitted", "discharged", "transferred_out", "cancelled"],
      default: "admitted",
      index: true,
    },
    admissionDate: { type: Date, default: Date.now },
    dischargeDate: { type: Date, default: null },
    dischargeSummary: {
      summaryText: { type: String, default: "" },
      signedByDoctorId: { type: objectId, ref: "Doctor", default: null },
      signedAt: { type: Date, default: null },
      dischargeCondition: {
        type: String,
        enum: ["", "cured", "improved", "transferred", "dama"],
        default: "",
      },
      followUpPlan: { type: String, default: "" },
    },
    dischargeClearance: {
      medicalClearance: {
        cleared: { type: Boolean, default: false },
        clearedBy: { type: String, default: "" },
        clearedAt: { type: Date, default: null },
      },
      pharmacyClearance: {
        cleared: { type: Boolean, default: false },
        clearedBy: { type: String, default: "" },
        clearedAt: { type: Date, default: null },
      },
      financeClearance: {
        cleared: { type: Boolean, default: false },
        clearedBy: { type: String, default: "" },
        clearedAt: { type: Date, default: null },
      },
      isFullyCleared: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

// 5. Bed Transfer Record Schema
const bedTransferRecordSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    admissionId: { type: objectId, ref: "IpdAdmission", required: true, index: true },
    fromBedId: { type: objectId, ref: "Bed", required: true },
    toBedId: { type: objectId, ref: "Bed", required: true },
    fromRoomId: { type: objectId, ref: "Room" },
    toRoomId: { type: objectId, ref: "Room" },
    fromWardId: { type: objectId, ref: "Ward" },
    toWardId: { type: objectId, ref: "Ward" },
    transferredBy: {
      staffId: { type: objectId, ref: "HospitalStaff" },
      name: { type: String, default: "Staff" },
      role: { type: String, default: "NURSE" },
    },
    transferReason: { type: String, required: true, trim: true },
    transferTimestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Ward = mongoose.models.Ward || mongoose.model("Ward", wardSchema);
export const Room = mongoose.models.Room || mongoose.model("Room", roomSchema);
export const Bed = mongoose.models.Bed || mongoose.model("Bed", bedSchema);
export const IpdAdmission = mongoose.models.IpdAdmission || mongoose.model("IpdAdmission", ipdAdmissionSchema);
export const BedTransferRecord = mongoose.models.BedTransferRecord || mongoose.model("BedTransferRecord", bedTransferRecordSchema);

export default {
  Ward,
  Room,
  Bed,
  IpdAdmission,
  BedTransferRecord,
};
