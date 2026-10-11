import { resolveClinicalCreation, loadClinicalRecord, clinicalRecordVisit } from "./clinicalOrderAccess.js";
import { resolveClinicalItems, clinicalText } from "./clinicalOrderItems.js";
import mongoose from "mongoose";
import crypto from "crypto";
import Prescription from "../model/prescription.js";
import { accessError } from "./hospitalAccess.js";

export const generatePrescriptionToken = () => {
  return "RX-" + crypto.randomBytes(8).toString("hex").toUpperCase();
};

let testDouble = null;
export const setPharmacyTestDouble = (adapter) => {
  if (process.env.NODE_ENV !== "test") throw new Error("Clinical test adapters are only available in tests");
  testDouble = adapter;
};

export const createPrescription = async ({
  hospitalId,
  encounterJourneyId,
  tokenId,
  patientId,
  familyMemberId,
  personKey,
  departmentId,
  serviceDepartmentId,
  patientInfo,
  prescribingDoctorId,
  prescribingDoctorName = "Attending Physician",
  diagnosis = "",
  items,
  actor,
}) => {
  if (!hospitalId) throw accessError(400, "Hospital tenant is required");
  if (testDouble && (!patientInfo || !patientInfo.name)) throw accessError(400, "Patient information is required");
  if (!Array.isArray(items) || items.length === 0) throw accessError(400, "At least one medication is required");

  if (testDouble?.createPrescription) {
    return testDouble.createPrescription({
      hospitalId,
      encounterJourneyId,
      tokenId,
      patientId,
      patientInfo,
      prescribingDoctorId,
      prescribingDoctorName,
      diagnosis,
      items,
      actor,
    });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const context = await resolveClinicalCreation({ hospitalId, encounterJourneyId, tokenId, patientId, familyMemberId, personKey, departmentId, serviceDepartmentId, prescribingDoctorId, actor }, "pharmacy");
  const resolvedItems = await resolveClinicalItems(hospitalId, items, "pharmacy");
  const verificationToken = generatePrescriptionToken();

  const prescription = new Prescription({
    ...context,
    diagnosis: clinicalText(diagnosis, "Diagnosis"),
    status: "approved_by_doctor",
    verificationToken,
    items: resolvedItems,
    auditHistory: [
      {
        stage: "approved_by_doctor",
        actorId: context.actor.id,
        actorName: context.actor.name,
        timestamp: new Date(),
        notes: `Prescription issued with ${items.length} medication items`,
      },
    ],
  });

  await prescription.save();

  return prescription;
};

export const dispensePrescription = async ({ prescriptionId, hospitalId, actor, dispenseItems }) => {
  if (!Array.isArray(dispenseItems) || dispenseItems.length === 0) {
    throw accessError(400, "Dispense item details are required");
  }

  if (testDouble?.dispensePrescription) {
    return testDouble.dispensePrescription({ prescriptionId, hospitalId, actor, dispenseItems });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  await loadClinicalRecord(Prescription, prescriptionId, hospitalId, actor, "pharmacy", ["PHARMACIST"]);
  throw accessError(503, "Dispensing and returns are temporarily unavailable pending atomic stock and allocation accounting");
};

export const returnPrescriptionItems = async ({ prescriptionId, hospitalId, actor, returnItems, reason }) => {
  if (!reason || !reason.trim()) throw accessError(400, "Reason for medication return is required");
  if (!Array.isArray(returnItems) || returnItems.length === 0) {
    throw accessError(400, "Return items are required");
  }

  if (testDouble?.returnPrescriptionItems) {
    return testDouble.returnPrescriptionItems({ prescriptionId, hospitalId, actor, returnItems, reason });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  await loadClinicalRecord(Prescription, prescriptionId, hospitalId, actor, "pharmacy", ["PHARMACIST"]);
  throw accessError(503, "Dispensing and returns are temporarily unavailable pending atomic stock and allocation accounting");
};

export const verifyPrescriptionQR = async ({ verificationToken }) => {
  if (typeof verificationToken !== "string" || !/^RX-[A-F0-9]{16}$/.test(verificationToken)) throw accessError(400, "Invalid verification token");

  if (testDouble?.verifyPrescriptionQR) {
    return testDouble.verifyPrescriptionQR({ verificationToken });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const prescription = await Prescription.findOne({ verificationToken }).lean();

  if (!prescription) throw accessError(404, "Invalid or unrecognized prescription QR code");

  await clinicalRecordVisit(prescription, "pharmacy");
  await Prescription.populate(prescription, { path: "hospitalId", select: "name slug" });

  // A public QR proves document status only. Clinical details require an owned or assigned session.
  return {
    verified: ["approved_by_doctor", "partially_dispensed", "dispensed"].includes(prescription.status),
    hospitalName: prescription.hospitalId?.name || "Hospital Pharmacy",
    prescribedAt: prescription.createdAt,
    status: prescription.status,
  };
};
