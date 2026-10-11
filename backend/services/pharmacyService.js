import mongoose from "mongoose";
import crypto from "crypto";
import Prescription from "../model/prescription.js";
import PharmacyInventory from "../model/pharmacyInventory.js";
import EncounterJourney from "../model/encounterJourney.js";
import { accessError } from "./hospitalAccess.js";

export const generatePrescriptionToken = () => {
  return "RX-" + crypto.randomBytes(8).toString("hex").toUpperCase();
};

let testDouble = null;
export const setPharmacyTestDouble = (adapter) => {
  testDouble = adapter;
};

export const createPrescription = async ({
  hospitalId,
  encounterJourneyId,
  tokenId,
  patientId,
  patientInfo,
  prescribingDoctorId,
  prescribingDoctorName = "Attending Physician",
  diagnosis = "",
  items,
  actor,
}) => {
  if (!hospitalId) throw accessError(400, "Hospital tenant is required");
  if (!patientInfo || !patientInfo.name) throw accessError(400, "Patient information is required");
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

  const verificationToken = generatePrescriptionToken();

  const prescription = new Prescription({
    hospitalId,
    encounterJourneyId: encounterJourneyId || null,
    tokenId: tokenId || null,
    patientId: patientId || null,
    patientInfo: {
      name: patientInfo.name,
      age: patientInfo.age,
      gender: patientInfo.gender,
      phone: patientInfo.phone,
    },
    prescribingDoctorId: prescribingDoctorId || null,
    prescribingDoctorName,
    diagnosis,
    status: "approved_by_doctor",
    verificationToken,
    items: items.map((item) => ({
      inventoryId: item.inventoryId || null,
      medicationCode: item.medicationCode || item.code,
      medicationName: item.medicationName || item.name,
      directions: item.directions || "As directed by physician",
      durationDays: Number(item.durationDays) || 5,
      quantityPrescribed: Math.max(1, Number(item.quantityPrescribed) || 1),
      quantityDispensed: 0,
      unitPriceMinor: Number(item.unitPriceMinor) || 0,
      itemStatus: "pending",
    })),
    auditHistory: [
      {
        stage: "approved_by_doctor",
        actorId: actor?.id || prescribingDoctorId,
        actorName: actor?.name || prescribingDoctorName,
        timestamp: new Date(),
        notes: `Prescription issued with ${items.length} medication items`,
      },
    ],
  });

  await prescription.save();

  // If linked to an encounter journey, update pharmacy step status
  if (encounterJourneyId) {
    await EncounterJourney.updateOne(
      { _id: encounterJourneyId, hospitalId, "steps.step": "pharmacy" },
      { $set: { "steps.$.status": "in_progress" } }
    ).catch(() => {});
  }

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

  const prescription = await Prescription.findOne({ _id: prescriptionId, hospitalId });
  if (!prescription) throw accessError(404, "Prescription not found in this hospital");

  if (["dispensed", "cancelled", "returned"].includes(prescription.status)) {
    throw accessError(409, `Cannot dispense prescription in status ${prescription.status}`);
  }

  const now = new Date();
  let anyDispensed = false;

  for (const di of dispenseItems) {
    const rxItem = prescription.items.id(di.itemId) || prescription.items.find((i) => i.medicationCode === di.medicationCode);
    if (!rxItem) continue;

    const remainingToDispense = rxItem.quantityPrescribed - (rxItem.quantityDispensed || 0);
    if (remainingToDispense <= 0) continue;

    const requestedQty = Number(di.quantityToDispense);
    if (isNaN(requestedQty) || requestedQty <= 0) continue;

    const qtyToDispense = Math.min(requestedQty, remainingToDispense);

    const inventory = await PharmacyInventory.findOne({
      hospitalId,
      medicationCode: rxItem.medicationCode,
    });

    if (!inventory) {
      throw accessError(404, `Medication '${rxItem.medicationCode}' not found in hospital inventory`);
    }

    let batch = null;
    if (di.batchNumber) {
      batch = inventory.batches.find(
        (b) => b.batchNumber === di.batchNumber && b.expiryDate > now && b.quantityAvailable >= qtyToDispense
      );
      if (!batch) {
        throw accessError(
          409,
          `Requested batch '${di.batchNumber}' is expired, missing, or has insufficient stock (${qtyToDispense} units required)`
        );
      }
    } else {
      batch = inventory.batches.find(
        (b) => b.expiryDate > now && b.quantityAvailable >= qtyToDispense
      );
    }

    if (!batch) {
      rxItem.itemStatus = "out_of_stock";
      continue;
    }

    batch.quantityAvailable -= qtyToDispense;
    inventory.totalStock = inventory.batches.reduce((sum, b) => sum + b.quantityAvailable, 0);
    await inventory.save();

    rxItem.quantityDispensed = (rxItem.quantityDispensed || 0) + qtyToDispense;
    rxItem.batchNumber = batch.batchNumber;
    rxItem.itemStatus = rxItem.quantityDispensed >= rxItem.quantityPrescribed ? "dispensed" : "pending";
    anyDispensed = true;
  }

  if (!anyDispensed) {
    throw accessError(409, "No items could be dispensed due to out-of-stock or expired batches");
  }

  const allDispensed = prescription.items.every((i) => (i.quantityDispensed || 0) >= i.quantityPrescribed);
  prescription.status = allDispensed ? "dispensed" : "partially_dispensed";
  prescription.dispensedAt = now;
  prescription.dispensedBy = actor?.id;
  prescription.dispensedByName = actor?.name || "Pharmacist";

  prescription.auditHistory.push({
    stage: prescription.status,
    actorId: actor?.id,
    actorName: actor?.name || "Pharmacist",
    timestamp: now,
    notes: `Dispensed medications. Status: ${prescription.status}`,
  });

  await prescription.save();

  // If fully dispensed and linked to an encounter journey, complete pharmacy step
  if (allDispensed && prescription.encounterJourneyId) {
    await EncounterJourney.updateOne(
      { _id: prescription.encounterJourneyId, hospitalId, "steps.step": "pharmacy" },
      { $set: { "steps.$.status": "completed", "steps.$.completedAt": now } }
    ).catch(() => {});
  }

  return prescription;
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

  const prescription = await Prescription.findOne({ _id: prescriptionId, hospitalId });
  if (!prescription) throw accessError(404, "Prescription not found in this hospital");

  for (const ri of returnItems) {
    const rxItem = prescription.items.id(ri.itemId) || prescription.items.find((i) => i.medicationCode === ri.medicationCode);
    if (!rxItem || (rxItem.quantityDispensed || 0) <= 0) continue;

    const requestedQty = Number(ri.quantity);
    if (isNaN(requestedQty) || requestedQty <= 0) {
      throw accessError(400, "Return quantity must be a positive number");
    }
    if (requestedQty > rxItem.quantityDispensed) {
      throw accessError(
        400,
        `Return quantity (${requestedQty}) cannot exceed dispensed quantity (${rxItem.quantityDispensed})`
      );
    }

    const returnQty = requestedQty;

    // Restore to inventory batch
    const inventory = await PharmacyInventory.findOne({
      hospitalId,
      medicationCode: rxItem.medicationCode,
    });

    if (inventory && rxItem.batchNumber) {
      const batch = inventory.batches.find((b) => b.batchNumber === rxItem.batchNumber);
      if (batch) {
        batch.quantityAvailable += returnQty;
        inventory.totalStock = inventory.batches.reduce((sum, b) => sum + b.quantityAvailable, 0);
        await inventory.save();
      }
    }

    rxItem.quantityDispensed -= returnQty;
    rxItem.itemStatus = rxItem.quantityDispensed === 0 ? "returned" : "pending";
  }

  const allReturned = prescription.items.every((i) => i.itemStatus === "returned" || i.quantityDispensed === 0);
  if (allReturned) prescription.status = "returned";

  prescription.auditHistory.push({
    stage: "returned",
    actorId: actor?.id,
    actorName: actor?.name || "Pharmacist",
    timestamp: new Date(),
    notes: `Returned items. Reason: ${reason.trim()}`,
  });

  await prescription.save();
  return prescription;
};

export const verifyPrescriptionQR = async ({ verificationToken }) => {
  if (!verificationToken) throw accessError(400, "Verification token is required");

  if (testDouble?.verifyPrescriptionQR) {
    return testDouble.verifyPrescriptionQR({ verificationToken });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const prescription = await Prescription.findOne({ verificationToken })
    .populate("hospitalId", "name slug")
    .lean();

  if (!prescription) throw accessError(404, "Invalid or unrecognized prescription QR code");

  // Privacy-safe projection: only essential verification details
  const nameParts = (prescription.patientInfo?.name || "").trim().split(/\s+/);
  const initials = nameParts.map((p) => p[0] + ".").join(" ");

  return {
    verified: true,
    verificationToken: prescription.verificationToken,
    hospitalName: prescription.hospitalId?.name || "Hospital Pharmacy",
    patientInitials: initials,
    patientGender: prescription.patientInfo?.gender,
    prescribedAt: prescription.createdAt,
    prescribingDoctorName: prescription.prescribingDoctorName,
    status: prescription.status,
    dispensedAt: prescription.dispensedAt,
    items: (prescription.items || []).map((item) => ({
      medicationName: item.medicationName,
      directions: item.directions,
      durationDays: item.durationDays,
      quantityPrescribed: item.quantityPrescribed,
      quantityDispensed: item.quantityDispensed,
      itemStatus: item.itemStatus,
    })),
  };
};
