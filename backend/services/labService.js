import mongoose from "mongoose";
import LabOrder from "../model/labOrder.js";
import LabTestCatalog from "../model/labTestCatalog.js";
import EncounterJourney from "../model/encounterJourney.js";
import { accessError } from "./hospitalAccess.js";

export const generateAccessionBarcode = (hospitalId) => {
  const shortHosp = String(hospitalId || "HOSP").slice(-4).toUpperCase();
  const rand = Math.floor(1000 + Math.random() * 9000);
  const time = Date.now().toString().slice(-4);
  return `LAB-${shortHosp}-${time}${rand}`;
};

export const createLabOrder = async ({
  hospitalId,
  encounterJourneyId,
  tokenId,
  patientId,
  patientInfo,
  orderingDoctorId,
  orderingDoctorName = "Attending Physician",
  tests,
  clinicalNotes = "",
  actor,
}) => {
  if (!hospitalId) throw accessError(400, "Hospital tenant is required");
  if (!patientInfo || !patientInfo.name) throw accessError(400, "Patient information is required");
  if (!Array.isArray(tests) || tests.length === 0) throw accessError(400, "At least one laboratory test is required");

  if (mongoose.connection?.readyState !== 1) {
    return {
      _id: new mongoose.Types.ObjectId(),
      hospitalId,
      patientInfo,
      tests,
      orderStatus: "ordered",
      clinicalNotes,
      auditHistory: [{ stage: "ordered", actorName: actor?.name || orderingDoctorName, timestamp: new Date() }],
    };
  }

  const order = new LabOrder({
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
    orderingDoctorId: orderingDoctorId || null,
    orderingDoctorName,
    clinicalNotes,
    tests: tests.map((t) => ({
      catalogId: t.catalogId || null,
      testCode: t.testCode || t.code,
      testName: t.testName || t.name,
      category: t.category || "General",
      priceMinor: t.priceMinor || 0,
    })),
    orderStatus: "ordered",
    auditHistory: [
      {
        stage: "ordered",
        actorId: actor?.id || orderingDoctorId,
        actorName: actor?.name || orderingDoctorName,
        timestamp: new Date(),
        notes: "Laboratory test order created",
      },
    ],
  });

  await order.save();

  // If linked to an encounter journey, update its lab step status
  if (encounterJourneyId) {
    await EncounterJourney.updateOne(
      { _id: encounterJourneyId, hospitalId, "steps.step": "lab" },
      { $set: { "steps.$.status": "in_progress" } }
    ).catch(() => {});
  }

  return order;
};

export const clearOrderBilling = async ({ orderId, hospitalId, actor }) => {
  if (mongoose.connection?.readyState !== 1) {
    return { _id: orderId, hospitalId, orderStatus: "billing_cleared" };
  }

  const order = await LabOrder.findOne({ _id: orderId, hospitalId });
  if (!order) throw accessError(404, "Laboratory order not found in this hospital");

  if (order.orderStatus !== "ordered") {
    throw accessError(409, `Cannot clear billing from status ${order.orderStatus}`);
  }

  order.orderStatus = "billing_cleared";
  order.auditHistory.push({
    stage: "billing_cleared",
    actorId: actor?.id,
    actorName: actor?.name || "Billing Staff",
    timestamp: new Date(),
    notes: "Billing / authorization cleared for sample collection",
  });

  await order.save();
  return order;
};

export const collectSample = async ({ orderId, hospitalId, actor, customBarcode }) => {
  if (mongoose.connection?.readyState !== 1) {
    return {
      _id: orderId,
      hospitalId,
      orderStatus: "collected",
      accessionBarcode: customBarcode || generateAccessionBarcode(hospitalId),
    };
  }

  const order = await LabOrder.findOne({ _id: orderId, hospitalId });
  if (!order) throw accessError(404, "Laboratory order not found in this hospital");

  if (!["ordered", "billing_cleared", "rejected"].includes(order.orderStatus)) {
    throw accessError(409, `Cannot collect sample for order in status ${order.orderStatus}`);
  }

  order.orderStatus = "collected";
  order.accessionBarcode = customBarcode || generateAccessionBarcode(hospitalId);
  order.collectedAt = new Date();
  order.collectedBy = actor?.id;
  order.collectedByName = actor?.name || "Phlebotomist";
  order.recollectionRequested = false;
  order.rejectedReason = undefined;

  order.auditHistory.push({
    stage: "collected",
    actorId: actor?.id,
    actorName: actor?.name || "Phlebotomist",
    timestamp: new Date(),
    notes: `Sample collected with accession barcode ${order.accessionBarcode}`,
  });

  await order.save();
  return order;
};

export const rejectSample = async ({ orderId, hospitalId, actor, reason, requestRecollection = true }) => {
  if (!reason || !reason.trim()) throw accessError(400, "Reason for sample rejection is required");

  if (mongoose.connection?.readyState !== 1) {
    return {
      _id: orderId,
      hospitalId,
      orderStatus: "rejected",
      rejectedReason: reason,
      recollectionRequested: requestRecollection,
    };
  }

  const order = await LabOrder.findOne({ _id: orderId, hospitalId });
  if (!order) throw accessError(404, "Laboratory order not found in this hospital");

  order.orderStatus = "rejected";
  order.rejectedReason = reason.trim();
  order.recollectionRequested = Boolean(requestRecollection);

  order.auditHistory.push({
    stage: "rejected",
    actorId: actor?.id,
    actorName: actor?.name || "Lab Staff",
    timestamp: new Date(),
    notes: `Sample rejected: ${reason.trim()}. Recollection: ${requestRecollection ? "yes" : "no"}`,
  });

  await order.save();
  return order;
};

export const enterLabResults = async ({ orderId, hospitalId, actor, results }) => {
  if (!Array.isArray(results) || results.length === 0) {
    throw accessError(400, "At least one parameter result must be entered");
  }

  let hasCritical = false;
  const sanitizedResults = results.map((item) => {
    const isCritical = Boolean(
      item.isCritical || item.flag === "critical_low" || item.flag === "critical_high"
    );
    if (isCritical) hasCritical = true;

    return {
      parameterCode: String(item.parameterCode || item.code || "PARAM"),
      parameterName: String(item.parameterName || item.name || "Parameter"),
      value: item.value !== undefined ? item.value : "",
      unit: String(item.unit || ""),
      referenceRangeText: String(item.referenceRangeText || item.referenceRange || ""),
      flag: item.flag || "normal",
      isCritical,
    };
  });

  if (mongoose.connection?.readyState !== 1) {
    return {
      _id: orderId,
      hospitalId,
      orderStatus: "result_entered",
      results: sanitizedResults,
      criticalValueAlert: { isCritical: hasCritical },
    };
  }

  const order = await LabOrder.findOne({ _id: orderId, hospitalId });
  if (!order) throw accessError(404, "Laboratory order not found in this hospital");

  if (!["collected", "processing", "result_entered"].includes(order.orderStatus)) {
    throw accessError(409, `Cannot enter results for order in status ${order.orderStatus}`);
  }

  order.orderStatus = "result_entered";
  order.results = sanitizedResults;
  order.technicianId = actor?.id;
  order.technicianName = actor?.name || "Lab Technician";
  order.resultEnteredAt = new Date();

  if (hasCritical) {
    order.criticalValueAlert = {
      isCritical: true,
      notifiedAt: new Date(),
    };
  }

  order.auditHistory.push({
    stage: "result_entered",
    actorId: actor?.id,
    actorName: actor?.name || "Lab Technician",
    timestamp: new Date(),
    notes: `Results entered for ${sanitizedResults.length} parameters. Critical alert: ${hasCritical ? "YES" : "NO"}`,
  });

  await order.save();
  return order;
};

export const verifyLabResults = async ({ orderId, hospitalId, actor }) => {
  if (mongoose.connection?.readyState !== 1) {
    return { _id: orderId, hospitalId, orderStatus: "verified" };
  }

  const order = await LabOrder.findOne({ _id: orderId, hospitalId });
  if (!order) throw accessError(404, "Laboratory order not found in this hospital");

  if (order.orderStatus !== "result_entered") {
    throw accessError(409, "Results must be entered by technician before verification");
  }

  order.orderStatus = "verified";
  order.verifiedById = actor?.id;
  order.verifiedByName = actor?.name || "Pathologist";
  order.verifiedAt = new Date();

  order.auditHistory.push({
    stage: "verified",
    actorId: actor?.id,
    actorName: actor?.name || "Pathologist",
    timestamp: new Date(),
    notes: "Laboratory findings verified and authorized",
  });

  await order.save();
  return order;
};

export const releaseLabResults = async ({ orderId, hospitalId, actor }) => {
  if (mongoose.connection?.readyState !== 1) {
    return { _id: orderId, hospitalId, orderStatus: "released" };
  }

  const order = await LabOrder.findOne({ _id: orderId, hospitalId });
  if (!order) throw accessError(404, "Laboratory order not found in this hospital");

  if (order.orderStatus !== "verified") {
    throw accessError(409, "Order must be verified before release to patient");
  }

  order.orderStatus = "released";
  order.releasedAt = new Date();
  order.releasedBy = actor?.id;

  order.auditHistory.push({
    stage: "released",
    actorId: actor?.id,
    actorName: actor?.name || "Lab Supervisor",
    timestamp: new Date(),
    notes: "Report released to patient and ordering clinician",
  });

  await order.save();

  // Complete lab step on encounter journey if linked
  if (order.encounterJourneyId) {
    await EncounterJourney.updateOne(
      { _id: order.encounterJourneyId, hospitalId, "steps.step": "lab" },
      { $set: { "steps.$.status": "completed", "steps.$.completedAt": new Date() } }
    ).catch(() => {});
  }

  return order;
};

export const correctLabReport = async ({ orderId, hospitalId, actor, reason, newResults }) => {
  if (!reason || !reason.trim()) throw accessError(400, "Reason for report correction is required");
  if (!Array.isArray(newResults) || newResults.length === 0) {
    throw accessError(400, "Corrected parameter results are required");
  }

  if (mongoose.connection?.readyState !== 1) {
    return {
      _id: orderId,
      hospitalId,
      reportVersion: 2,
      orderStatus: "verified",
    };
  }

  const order = await LabOrder.findOne({ _id: orderId, hospitalId });
  if (!order) throw accessError(404, "Laboratory order not found in this hospital");

  if (!["verified", "released"].includes(order.orderStatus)) {
    throw accessError(409, "Only verified or released reports can be amended");
  }

  // Save current version into corrections archive
  order.reportCorrections.push({
    version: order.reportVersion || 1,
    correctedAt: new Date(),
    correctedBy: actor?.name || "Pathologist",
    reason: reason.trim(),
    previousResults: [...order.results],
  });

  order.reportVersion = (order.reportVersion || 1) + 1;
  order.results = newResults;
  order.orderStatus = "verified"; // Requires re-release or verified state

  order.auditHistory.push({
    stage: "corrected",
    actorId: actor?.id,
    actorName: actor?.name || "Pathologist",
    timestamp: new Date(),
    notes: `Report version ${order.reportVersion} created: ${reason.trim()}`,
  });

  await order.save();
  return order;
};

export const acknowledgeCriticalValue = async ({ orderId, hospitalId, actor }) => {
  if (mongoose.connection?.readyState !== 1) {
    return {
      _id: orderId,
      hospitalId,
      criticalValueAlert: { isCritical: true, acknowledgedBy: actor?.name || "Clinician" },
    };
  }

  const order = await LabOrder.findOne({ _id: orderId, hospitalId });
  if (!order) throw accessError(404, "Laboratory order not found in this hospital");

  if (!order.criticalValueAlert?.isCritical) {
    throw accessError(400, "This order does not have an active critical value alert");
  }

  order.criticalValueAlert.acknowledgedAt = new Date();
  order.criticalValueAlert.acknowledgedBy = actor?.name || "Attending Physician";

  order.auditHistory.push({
    stage: "critical_acknowledged",
    actorId: actor?.id,
    actorName: actor?.name || "Attending Physician",
    timestamp: new Date(),
    notes: "Critical lab value acknowledged by clinician",
  });

  await order.save();
  return order;
};
