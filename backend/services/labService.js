import { resolveClinicalCreation } from "./clinicalOrderAccess.js";
import { resolveClinicalItems, clinicalText } from "./clinicalOrderItems.js";
import mongoose from "mongoose";
import LabOrder from "../model/labOrder.js";
import { accessError } from "./hospitalAccess.js";
import { assertClinicalWorkflowReady } from "./clinicalSchema.js";

export { generateAccessionBarcode } from "./labWorkflow.js";
import { labCommand } from "./labWorkflow.js";

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
  if (process.env.REQUIRE_CLINICAL_SCHEMA === "true") {
    await assertClinicalWorkflowReady({ workflow: "Laboratory" });
  }

  if (!hospitalId) throw accessError(400, "Hospital tenant is required");
  if (!Array.isArray(tests) || tests.length === 0) throw accessError(400, "At least one laboratory test is required");

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
    workflowVersion: 1,
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
