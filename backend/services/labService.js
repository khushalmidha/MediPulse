import crypto from "node:crypto";
import { resolveClinicalCreation } from "./clinicalOrderAccess.js";
import { resolveClinicalItems, clinicalText } from "./clinicalOrderItems.js";
import mongoose from "mongoose";
import LabOrder from "../model/labOrder.js";
import Hospital from "../model/hospital.js";
import { accessError } from "./hospitalAccess.js";
import { assertClinicalWorkflowReady } from "./clinicalSchema.js";
import { moneyTransaction } from "./moneyTransaction.js";
import { assertTenantNotSuspended, checkFeatureEntitlement } from "./saasOperationsService.js";

export { generateAccessionBarcode } from "./labWorkflow.js";
import { labCommand } from "./labWorkflow.js";

let testCreationFault = null;
export function setLabCreationFault(callback) {
  if (process.env.NODE_ENV !== "test") throw new Error("Creation fault injection is only available in tests");
  testCreationFault = callback;
}

export function fingerprintLabOrder({ tokenId, encounterJourneyId, serviceDepartmentId, tests, clinicalNotes, patientId, familyMemberId }) {
  const normalizedTests = (Array.isArray(tests) ? tests : []).map(t => ({
    catalogId: String(t?.catalogId || ""),
  })).sort((a, b) => a.catalogId.localeCompare(b.catalogId));
  const payload = {
    tokenId: tokenId ? String(tokenId) : "",
    encounterJourneyId: encounterJourneyId ? String(encounterJourneyId) : "",
    serviceDepartmentId: serviceDepartmentId ? String(serviceDepartmentId) : "",
    patientId: patientId ? String(patientId) : "",
    familyMemberId: familyMemberId ? String(familyMemberId) : "",
    clinicalNotes: typeof clinicalNotes === "string" ? clinicalNotes.trim() : "",
    tests: normalizedTests,
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

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
  creationKey,
  requestKey,
  key,
  session: providedSession,
}) => {
  if (process.env.REQUIRE_CLINICAL_SCHEMA === "true") {
    await assertClinicalWorkflowReady({ workflow: "Laboratory" });
  }

  if (!hospitalId) throw accessError(400, "Hospital tenant is required");
  if (!Array.isArray(tests) || tests.length === 0) throw accessError(400, "At least one laboratory test is required");

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const hospital = await Hospital.findById(hospitalId);
  if (hospital) {
    assertTenantNotSuspended(hospital);
  }

  const effectiveKey = creationKey || requestKey || key;
  if (effectiveKey !== undefined && effectiveKey !== null) {
    if (typeof effectiveKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(effectiveKey)) {
      throw accessError(400, "Invalid creation key");
    }
  }

  const requestHash = fingerprintLabOrder({
    tokenId,
    encounterJourneyId,
    serviceDepartmentId,
    tests,
    clinicalNotes,
    patientId,
    familyMemberId,
  });

  if (effectiveKey) {
    const existing = await LabOrder.findOne({ hospitalId, creationKey: effectiveKey });
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
      const existingInTx = await LabOrder.findOne({ hospitalId, creationKey: effectiveKey }).session(session);
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
      { hospitalId, encounterJourneyId, tokenId, patientId, familyMemberId, personKey, departmentId, serviceDepartmentId, orderingDoctorId, actor },
      "lab",
      { session }
    );
    const resolvedItems = await resolveClinicalItems(hospitalId, tests, "lab", { session });

    const order = new LabOrder({
      ...context,
      clinicalNotes: clinicalText(clinicalNotes, "Clinical notes"),
      tests: resolvedItems,
      orderStatus: "ordered",
      workflowVersion: 1,
      workflowRevision: 0,
      creationKey: effectiveKey || undefined,
      requestHash,
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

    await order.save({ session });

    if (process.env.NODE_ENV === "test" && testCreationFault) {
      await testCreationFault("before_commit", { order, session });
    }

    return order;
  };

  if (providedSession) {
    return await execute(providedSession);
  }
  return await moneyTransaction(execute);
};

export const clearOrderBilling = async input => {
  return labCommand(input, "billing");
};

export const collectSample = async input => {
  return labCommand(input, "collect");
};

export const rejectSample = async input => {
  return labCommand(input, "reject");
};

export const enterLabResults = async input => {
  return labCommand(input, "results");
};

export const verifyLabResults = async input => {
  return labCommand(input, "verify");
};

export const releaseLabResults = async input => {
  return labCommand(input, "release");
};

export const correctLabReport = async input => {
  return labCommand(input, "correct");
};

export const acknowledgeCriticalValue = async input => {
  return labCommand(input, "acknowledge");
};
