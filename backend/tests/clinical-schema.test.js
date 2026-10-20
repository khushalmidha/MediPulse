import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import EncounterJourney from "../model/encounterJourney.js";
import LabOrder from "../model/labOrder.js";
import Prescription from "../model/prescription.js";
import {
  clinicalModels,
  inspectClinicalSchema,
  applyClinicalSchema,
  rollbackClinicalSchema,
  assertClinicalSchema,
  assertClinicalWorkflowReady,
} from "../services/clinicalSchema.js";
import { inspectStartupReadiness, schemaChecks } from "../services/startupReadiness.js";

test("AG01: clinical and encounter schema models define required ag01 named indexes", () => {
  for (const Model of clinicalModels) {
    const indexes = Model.schema.indexes();
    const ag01Indexes = indexes.filter(([, options]) => options.name?.startsWith("ag01_"));
    assert.ok(ag01Indexes.length > 0, `${Model.modelName} must define ag01_ named indexes`);
    for (const [key, options] of ag01Indexes) {
      assert.ok(options.name.startsWith("ag01_"), `Index ${options.name} must start with ag01_`);
      assert.ok(typeof key === "object" && Object.keys(key).length > 0, `Index ${options.name} must specify keys`);
    }
  }

  // Check specific required named indexes
  const encounterIdx = EncounterJourney.schema.indexes().map(([, opt]) => opt.name);
  assert.ok(encounterIdx.includes("ag01_encounter_token_unique"));
  assert.ok(encounterIdx.includes("ag01_encounter_appointment_unique"));
  assert.ok(encounterIdx.includes("ag01_encounter_hospital_stage"));

  const labIdx = LabOrder.schema.indexes().map(([, opt]) => opt.name);
  assert.ok(labIdx.includes("ag01_lab_order_creation_key"));
  assert.ok(labIdx.includes("ag01_lab_order_accession_barcode"));

  const rxIdx = Prescription.schema.indexes().map(([, opt]) => opt.name);
  assert.ok(rxIdx.includes("ag01_prescription_creation_key"));
  assert.ok(rxIdx.includes("ag01_prescription_verification_token"));
});

test("AG01: inspectStartupReadiness conditionally includes clinical checks", async () => {
  // By default without REQUIRE_CLINICAL_SCHEMA=true, schemaChecks does not include clinical to avoid blocking unrelated services
  assert.equal(Boolean(schemaChecks.clinical), process.env.REQUIRE_CLINICAL_SCHEMA === "true");

  // When explicit checks with clinical schema are provided, it runs and reports status
  const mockCheckFailing = async () => { throw new Error("clinical schema not ready"); };
  const mockCheckPassing = async () => {};

  const failingResult = await inspectStartupReadiness({
    checks: { clinical: mockCheckFailing },
    dependencies: async () => ({ ready: true, dependencies: {} }),
  });
  assert.equal(failingResult.initial.schemas.clinical, "migration-required");
  assert.equal(failingResult.initial.ready, false);

  const passingResult = await inspectStartupReadiness({
    checks: { clinical: mockCheckPassing },
    dependencies: async () => ({ ready: true, dependencies: {} }),
  });
  assert.equal(passingResult.initial.schemas.clinical, "ready");
});

test("AG01: assertClinicalWorkflowReady formats clear 503 error", async () => {
  // If inspectClinicalSchema fails or finds missing indexes, assertClinicalWorkflowReady throws 503
  await assert.rejects(
    assertClinicalWorkflowReady({ workflow: "Laboratory" }),
    err => err.status === 503 && err.message.includes("Laboratory workflow is undergoing maintenance")
  );
});
