import { resolveClinicalCreation, loadClinicalRecord } from "./clinicalOrderAccess.js";
import { resolveClinicalItems, clinicalText } from "./clinicalOrderItems.js";
import mongoose from "mongoose";
import LabOrder from "../model/labOrder.js";
import { accessError } from "./hospitalAccess.js";

export const generateAccessionBarcode = (hospitalId) => {
  const shortHosp = String(hospitalId || "HOSP").slice(-4).toUpperCase();
  const rand = Math.floor(1000 + Math.random() * 9000);
  const time = Date.now().toString().slice(-4);
  return `LAB-${shortHosp}-${time}${rand}`;
};

let testDouble = null;
export const setLabTestDouble = (adapter) => {
  if (process.env.NODE_ENV !== "test") throw new Error("Clinical test adapters are only available in tests");
  testDouble = adapter;
};

export const createLabOrder = async ({
  hospitalId,
  encounterJourneyId,
  tokenId,
  patientId,
  familyMemberId,
  personKey,
  departmentId,
  serviceDepartmentId,
  patientInfo,
  orderingDoctorId,
  orderingDoctorName = "Attending Physician",
  tests,
  clinicalNotes = "",
  actor,
}) => {
  if (!hospitalId) throw accessError(400, "Hospital tenant is required");
  if (testDouble && (!patientInfo || !patientInfo.name)) throw accessError(400, "Patient information is required");
  if (!Array.isArray(tests) || tests.length === 0) throw accessError(400, "At least one laboratory test is required");

  if (testDouble?.createLabOrder) {
    return testDouble.createLabOrder({
      hospitalId,
      encounterJourneyId,
      tokenId,
      patientId,
      patientInfo,
      orderingDoctorId,
      orderingDoctorName,
      tests,
      clinicalNotes,
      actor,
    });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const context = await resolveClinicalCreation({ hospitalId, encounterJourneyId, tokenId, patientId, familyMemberId, personKey, departmentId, serviceDepartmentId, orderingDoctorId, actor }, "lab");
  const resolvedItems = await resolveClinicalItems(hospitalId, tests, "lab");
  const order = new LabOrder({
    ...context,
    clinicalNotes: clinicalText(clinicalNotes, "Clinical notes"),
    tests: resolvedItems,
    orderStatus: "ordered",
    auditHistory: [
      {
        stage: "ordered",
        actorId: context.actor.id,
        actorName: context.actor.name,
        timestamp: new Date(),
        notes: "Laboratory test order created",
      },
    ],
  });

  await order.save();

  return order;
};

export const clearOrderBilling = async ({ orderId, hospitalId, actor }) => {
  if (testDouble?.clearOrderBilling) {
    return testDouble.clearOrderBilling({ orderId, hospitalId, actor });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const order = await loadClinicalRecord(LabOrder, orderId, hospitalId, actor, "lab", ["RECEPTIONIST", "HOSPITAL_ADMIN"], { billing: true });
  actor = order.$locals.clinicalActor;

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
  if (testDouble?.collectSample) {
    return testDouble.collectSample({ orderId, hospitalId, actor, customBarcode });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const order = await loadClinicalRecord(LabOrder, orderId, hospitalId, actor, "lab", ["NURSE", "LAB_TECH"]);
  actor = order.$locals.clinicalActor;

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

  if (testDouble?.rejectSample) {
    return testDouble.rejectSample({ orderId, hospitalId, actor, reason, requestRecollection });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const order = await loadClinicalRecord(LabOrder, orderId, hospitalId, actor, "lab", ["LAB_TECH"]);
  actor = order.$locals.clinicalActor;

  if (order.orderStatus === "released") {
    throw accessError(409, "Cannot reject sample for an already released report");
  }

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

  if (testDouble?.enterLabResults) {
    return testDouble.enterLabResults({ orderId, hospitalId, actor, results: sanitizedResults, hasCritical });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const order = await loadClinicalRecord(LabOrder, orderId, hospitalId, actor, "lab", ["LAB_TECH"]);
  actor = order.$locals.clinicalActor;

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
      requiresAcknowledgement: true,
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
  if (testDouble?.verifyLabResults) {
    return testDouble.verifyLabResults({ orderId, hospitalId, actor });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  await loadClinicalRecord(LabOrder, orderId, hospitalId, actor, "lab", ["DOCTOR", "LAB_TECH"]);
  throw accessError(503, "Laboratory verification and release require reviewed clinical capabilities and report version safety; this action is temporarily unavailable");
};

export const releaseLabResults = async ({ orderId, hospitalId, actor }) => {
  if (testDouble?.releaseLabResults) {
    return testDouble.releaseLabResults({ orderId, hospitalId, actor });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  await loadClinicalRecord(LabOrder, orderId, hospitalId, actor, "lab", ["DOCTOR", "LAB_TECH"]);
  throw accessError(503, "Laboratory verification and release require reviewed clinical capabilities and report version safety; this action is temporarily unavailable");
};

export const correctLabReport = async ({ orderId, hospitalId, actor, reason, newResults }) => {
  if (!reason || !reason.trim()) throw accessError(400, "Reason for report correction is required");
  if (!Array.isArray(newResults) || newResults.length === 0) {
    throw accessError(400, "Corrected parameter results are required");
  }

  if (testDouble?.correctLabReport) {
    return testDouble.correctLabReport({ orderId, hospitalId, actor, reason, newResults });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  await loadClinicalRecord(LabOrder, orderId, hospitalId, actor, "lab", ["DOCTOR", "LAB_TECH"]);
  throw accessError(503, "Laboratory verification and release require reviewed clinical capabilities and report version safety; this action is temporarily unavailable");
};

export const acknowledgeCriticalValue = async ({ orderId, hospitalId, actor }) => {
  if (testDouble?.acknowledgeCriticalValue) {
    return testDouble.acknowledgeCriticalValue({ orderId, hospitalId, actor });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const order = await loadClinicalRecord(LabOrder, orderId, hospitalId, actor, "lab", ["DOCTOR"]);
  actor = order.$locals.clinicalActor;

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
