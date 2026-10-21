import { fulfillPrescription } from "./pharmacyFulfillment.js";
import { resolveClinicalCreation, clinicalRecordVisit } from "./clinicalOrderAccess.js";
import { resolveClinicalItems, clinicalText } from "./clinicalOrderItems.js";
import mongoose from "mongoose";
import crypto from "crypto";
import Prescription from "../model/prescription.js";
import { accessError } from "./hospitalAccess.js";
import { assertClinicalWorkflowReady } from "./clinicalSchema.js";
import { moneyTransaction } from "./moneyTransaction.js";

export const generatePrescriptionToken = () => {
  return "RX-" + crypto.randomBytes(8).toString("hex").toUpperCase();
};

let testDouble = null;
export const setPharmacyTestDouble = (adapter) => {
  if (process.env.NODE_ENV !== "test") throw new Error("Clinical test adapters are only available in tests");
  testDouble = adapter;
};

let testPharmacyCreationFault = null;
export function setPharmacyCreationFault(callback) {
  if (process.env.NODE_ENV !== "test") throw new Error("Creation fault injection is only available in tests");
  testPharmacyCreationFault = callback;
}

export function fingerprintPrescription({ tokenId, encounterJourneyId, serviceDepartmentId, items, diagnosis, patientId, familyMemberId }) {
  const normalizedItems = (Array.isArray(items) ? items : []).map(item => ({
    inventoryId: String(item?.inventoryId || ""),
    directions: typeof item?.directions === "string" ? item.directions.trim() : "",
    durationDays: item?.durationDays,
    quantityPrescribed: item?.quantityPrescribed,
  })).sort((a, b) => a.inventoryId.localeCompare(b.inventoryId));
  const payload = {
    tokenId: tokenId ? String(tokenId) : "",
    encounterJourneyId: encounterJourneyId ? String(encounterJourneyId) : "",
    serviceDepartmentId: serviceDepartmentId ? String(serviceDepartmentId) : "",
    patientId: patientId ? String(patientId) : "",
    familyMemberId: familyMemberId ? String(familyMemberId) : "",
    diagnosis: typeof diagnosis === "string" ? diagnosis.trim() : "",
    items: normalizedItems,
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

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
  creationKey,
  requestKey,
  key,
  session: providedSession,
}) => {
  if (process.env.REQUIRE_CLINICAL_SCHEMA === "true") {
    await assertClinicalWorkflowReady({ workflow: "Pharmacy" });
  }

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

  const effectiveKey = creationKey || requestKey || key;
  if (effectiveKey !== undefined && effectiveKey !== null) {
    if (typeof effectiveKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(effectiveKey)) {
      throw accessError(400, "Invalid creation key");
    }
  }

  const requestHash = fingerprintPrescription({
    tokenId,
    encounterJourneyId,
    serviceDepartmentId,
    items,
    diagnosis,
    patientId,
    familyMemberId,
  });

  if (effectiveKey) {
    const existing = await Prescription.findOne({ hospitalId, creationKey: effectiveKey });
    if (existing) {
      if (existing.requestHash === requestHash) {
        existing.$locals = existing.$locals || {};
        existing.$locals.replayed = true;
        return existing;
      }
      throw accessError(409, "Creation key already used with different contents");
    }
  }

  const execute = async (session) => {
    if (effectiveKey) {
      const existingInTx = await Prescription.findOne({ hospitalId, creationKey: effectiveKey }).session(session);
      if (existingInTx) {
        if (existingInTx.requestHash === requestHash) {
          existingInTx.$locals = existingInTx.$locals || {};
          existingInTx.$locals.replayed = true;
          return existingInTx;
        }
        throw accessError(409, "Creation key already used with different contents");
      }
    }

    const context = await resolveClinicalCreation(
      { hospitalId, encounterJourneyId, tokenId, patientId, familyMemberId, personKey, departmentId, serviceDepartmentId, prescribingDoctorId, actor },
      "pharmacy",
      { session }
    );
    const resolvedItems = await resolveClinicalItems(hospitalId, items, "pharmacy", { session });
    const verificationToken = generatePrescriptionToken();

    const prescription = new Prescription({
      ...context,
      diagnosis: clinicalText(diagnosis, "Diagnosis"),
      status: "approved_by_doctor",
      fulfillmentLedgerVersion: 1,
      fulfillmentRevision: 0,
      verificationToken,
      creationKey: effectiveKey || undefined,
      requestHash,
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

    await prescription.save({ session });

    if (process.env.NODE_ENV === "test" && testPharmacyCreationFault) {
      await testPharmacyCreationFault("before_commit", { prescription, session });
    }

    return prescription;
  };

  if (providedSession) {
    return await execute(providedSession);
  }
  return await moneyTransaction(execute);
};

export const dispensePrescription = async ({ prescriptionId, hospitalId, actor, dispenseItems, requestKey, expectedRevision }) => {
  if (!Array.isArray(dispenseItems) || dispenseItems.length === 0) {
    throw accessError(400, "Dispense item details are required");
  }

  if (testDouble?.dispensePrescription) {
    return testDouble.dispensePrescription({ prescriptionId, hospitalId, actor, dispenseItems });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  return fulfillPrescription({ prescriptionId, hospitalId, actor, dispenseItems, requestKey, expectedRevision }, "dispense");
};

export const returnPrescriptionItems = async ({ prescriptionId, hospitalId, actor, returnItems, reason, requestKey, expectedRevision }) => {
  reason = clinicalText(reason, "Return reason", 1000);
  if (!reason) throw accessError(400, "Reason for medication return is required");
  if (!Array.isArray(returnItems) || returnItems.length === 0) {
    throw accessError(400, "Return items are required");
  }

  if (testDouble?.returnPrescriptionItems) {
    return testDouble.returnPrescriptionItems({ prescriptionId, hospitalId, actor, returnItems, reason });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  return fulfillPrescription({ prescriptionId, hospitalId, actor, returnItems, reason, requestKey, expectedRevision }, "return");
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
