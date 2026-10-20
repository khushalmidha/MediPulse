import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { localTestTargets } from "../../util/testTargets.js";
import EncounterJourney from "../../model/encounterJourney.js";
import LabOrder from "../../model/labOrder.js";
import Prescription from "../../model/prescription.js";
import OpdToken from "../../model/opdToken.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import Department from "../../model/department.js";
import Hospital from "../../model/hospital.js";
import User from "../../model/user.js";
import {
  clinicalModels,
  inspectClinicalSchema,
  applyClinicalSchema,
  rollbackClinicalSchema,
  assertClinicalSchema,
  assertClinicalWorkflowReady,
} from "../../services/clinicalSchema.js";
import { initializeEncounterJourney } from "../../services/encounterJourneyService.js";
import { createLabOrder } from "../../services/labService.js";
import { createPrescription } from "../../services/pharmacyService.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_clinical_schema_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id();
const departmentId = id();
const doctorId = id();
const patientId = id();
const tokenId1 = id();
const tokenId2 = id();
const appointmentId1 = id();

before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
});

after(async () => {
  delete process.env.REQUIRE_CLINICAL_SCHEMA;
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("missing indexes fail the selected workflow clearly when schema readiness is gated", async () => {
  process.env.REQUIRE_CLINICAL_SCHEMA = "true";

  // Before schema initialization, missing indexes cause workflow gates to throw 503
  await assert.rejects(
    initializeEncounterJourney({
      hospitalId,
      departmentId,
      tokenId: tokenId1,
      ticketNumber: "T001",
    }),
    err => {
      assert.equal(err.status, 503);
      assert.match(err.message, /Encounter workflow is undergoing maintenance/);
      return true;
    }
  );

  await assert.rejects(
    createLabOrder({
      hospitalId,
      tokenId: tokenId1,
      tests: [{ testCode: "T1", testName: "Test 1" }],
    }),
    err => {
      assert.equal(err.status, 503);
      assert.match(err.message, /Laboratory workflow is undergoing maintenance/);
      return true;
    }
  );

  await assert.rejects(
    createPrescription({
      hospitalId,
      tokenId: tokenId1,
      items: [{ medicationCode: "M1", medicationName: "Med 1", directions: "Daily", quantityPrescribed: 1 }],
    }),
    err => {
      assert.equal(err.status, 503);
      assert.match(err.message, /Pharmacy workflow is undergoing maintenance/);
      return true;
    }
  );
});

test("dry-run inspection detects all missing ag01 indexes without modifying the database", async () => {
  const plan = await inspectClinicalSchema();
  assert.equal(plan.ready, false);
  assert.equal(plan.issues.length, 0);

  for (const coll of plan.collections) {
    assert.ok(coll.missing.length > 0, `Collection ${coll.collection} should have missing indexes`);
    assert.equal(coll.conflicts.length, 0);
  }

  // Dry run apply returns plan without creating indexes
  const dryRunPlan = await applyClinicalSchema({ dryRun: true });
  assert.equal(dryRunPlan.ready, false);

  // Still not ready after dry run
  const reinspect = await inspectClinicalSchema();
  assert.equal(reinspect.ready, false);
});

test("rehearse valid populated fixtures and additive apply without startup autoIndex", async () => {
  // Populate valid records before indexes are applied
  const enc1 = await EncounterJourney.collection.insertOne({
    _id: id(),
    hospitalId,
    departmentId,
    tokenId: tokenId1,
    appointmentId: appointmentId1,
    ticketNumber: "T100",
    currentStage: "booked",
    requiredSteps: ["reception"],
    stageHistory: [],
    physicalFile: { hasPhysicalFile: false, handoffHistory: [] },
    revision: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const enc2 = await EncounterJourney.collection.insertOne({
    _id: id(),
    hospitalId,
    departmentId,
    tokenId: tokenId2,
    ticketNumber: "T101",
    currentStage: "booked",
    requiredSteps: ["reception"],
    stageHistory: [],
    physicalFile: { hasPhysicalFile: false, handoffHistory: [] },
    revision: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const lab1 = await LabOrder.collection.insertOne({
    _id: id(),
    hospitalId,
    tokenId: tokenId1,
    creationKey: "key-lab-001",
    requestHash: "hash-lab-001",
    accessionBarcode: "LAB-BC-001",
    orderStatus: "ordered",
    patientInfo: { name: "Patient One" },
    tests: [],
    workflowCommands: [],
    reportVersions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const rx1 = await Prescription.collection.insertOne({
    _id: id(),
    hospitalId,
    tokenId: tokenId1,
    creationKey: "key-rx-001",
    requestHash: "hash-rx-001",
    verificationToken: "RX-AAAABBBBCCCC0001",
    status: "approved_by_doctor",
    patientInfo: { name: "Patient One" },
    items: [],
    fulfillmentOperations: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Inspect valid populated data
  const inspectBefore = await inspectClinicalSchema();
  assert.equal(inspectBefore.issues.length, 0);

  // Apply schema additively
  const applied = await applyClinicalSchema();
  assert.ok(applied);

  // Re-inspect: ready must be true, zero missing, zero conflicts
  const inspectAfter = await inspectClinicalSchema();
  assert.equal(inspectAfter.ready, true);
  assert.equal(inspectAfter.issues.length, 0);
  assert.equal(inspectAfter.summary.missingTotal, 0);
  assert.equal(inspectAfter.summary.conflictsTotal, 0);

  // assertClinicalSchema passes
  await assertClinicalSchema();

  // Unique index enforcement prevents duplicate tokenId on EncounterJourney
  await assert.rejects(
    EncounterJourney.collection.insertOne({
      _id: id(),
      hospitalId,
      departmentId,
      tokenId: tokenId1, // Duplicate!
      ticketNumber: "T102",
      currentStage: "booked",
      requiredSteps: ["reception"],
      stageHistory: [],
      physicalFile: { hasPhysicalFile: false, handoffHistory: [] },
      revision: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    err => err.code === 11000
  );

  // Unique index enforcement prevents duplicate creationKey on LabOrder
  await assert.rejects(
    LabOrder.collection.insertOne({
      _id: id(),
      hospitalId,
      tokenId: tokenId2,
      creationKey: "key-lab-001", // Duplicate!
      accessionBarcode: "LAB-BC-002",
      orderStatus: "ordered",
      patientInfo: { name: "Patient Two" },
      tests: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    err => err.code === 11000
  );

  // Clean up test documents
  await EncounterJourney.deleteMany({});
  await LabOrder.deleteMany({});
  await Prescription.deleteMany({});
});

test("guarded rollback drops only ag01 indexes and preserves documents", async () => {
  // Take snapshot of current applied indexes
  const snapshot = {
    task: "AG01",
    database: mongoose.connection.name,
    collections: (await inspectClinicalSchema()).collections.map(c => ({
      collection: c.collection,
      missing: c.indexes
        .filter(idx => idx.name.startsWith("ag01_"))
        .map(idx => ({ options: { name: idx.name } })),
    })),
  };

  // Insert a test document to ensure it survives rollback
  const docId = id();
  await EncounterJourney.collection.insertOne({
    _id: docId,
    hospitalId,
    departmentId,
    ticketNumber: "T-SURVIVE",
    currentStage: "booked",
  });

  // Rollback
  await rollbackClinicalSchema(snapshot);

  // Verified: ag01 indexes dropped
  const reinspect = await inspectClinicalSchema();
  assert.equal(reinspect.ready, false);
  assert.ok(reinspect.summary.missingTotal > 0);

  // Verified: document preserved
  const doc = await EncounterJourney.collection.findOne({ _id: docId });
  assert.ok(doc, "Document must be preserved after index rollback");
  await EncounterJourney.deleteMany({});
});

test("rehearse corrupt populated fixtures: duplicates are preserved and block apply without destructive rewrite", async () => {
  // Ensure collections are in unindexed state for corrupt fixture rehearsal
  for (const Model of clinicalModels) {
    try {
      const idxs = await Model.collection.listIndexes().toArray();
      for (const idx of idxs) {
        if (idx.name.startsWith("ag01_")) {
          await Model.collection.dropIndex(idx.name);
        }
      }
    } catch {}
  }

  // Insert corrupt duplicate fixtures into the unindexed database
  const dupToken = id();
  const dupCreationKey = "corrupt-dup-key";
  const dupBarcode = "LAB-DUP-BARCODE";
  const dupRxToken = "RX-DUP-TOKEN-0001";

  // Two encounters with the same tokenId
  const encA = {
    _id: id(),
    hospitalId,
    departmentId,
    tokenId: dupToken,
    ticketNumber: "DUP-1",
    currentStage: "booked",
    createdAt: new Date(),
  };
  const encB = {
    _id: id(),
    hospitalId,
    departmentId,
    tokenId: dupToken,
    ticketNumber: "DUP-2",
    currentStage: "waiting",
    createdAt: new Date(),
  };
  await EncounterJourney.collection.insertMany([encA, encB]);

  // Two lab orders with duplicate creationKey and duplicate accessionBarcode
  const labA = {
    _id: id(),
    hospitalId,
    creationKey: dupCreationKey,
    accessionBarcode: dupBarcode,
    orderStatus: "ordered",
    patientInfo: { name: "Patient A" },
    createdAt: new Date(),
  };
  const labB = {
    _id: id(),
    hospitalId,
    creationKey: dupCreationKey,
    accessionBarcode: dupBarcode,
    orderStatus: "ordered",
    patientInfo: { name: "Patient B" },
    createdAt: new Date(),
  };
  await LabOrder.collection.insertMany([labA, labB]);

  // Two prescriptions with duplicate verificationToken
  const rxA = {
    _id: id(),
    hospitalId,
    creationKey: "key-a",
    verificationToken: dupRxToken,
    status: "approved_by_doctor",
    patientInfo: { name: "Patient A" },
    createdAt: new Date(),
  };
  const rxB = {
    _id: id(),
    hospitalId,
    creationKey: "key-b",
    verificationToken: dupRxToken,
    status: "approved_by_doctor",
    patientInfo: { name: "Patient B" },
    createdAt: new Date(),
  };
  await Prescription.collection.insertMany([rxA, rxB]);

  // Inspection detects all duplicates without modifying them
  const corruptPlan = await inspectClinicalSchema();
  assert.equal(corruptPlan.ready, false);
  assert.ok(corruptPlan.issues.includes("duplicate_encounter_token"));
  assert.ok(corruptPlan.issues.includes("duplicate_lab_order_creation_key"));
  assert.ok(corruptPlan.issues.includes("duplicate_lab_order_accession_barcode"));
  assert.ok(corruptPlan.issues.includes("duplicate_prescription_verification_token"));

  // Apply is strictly refused with an error detailing the duplicates
  await assert.rejects(
    applyClinicalSchema(),
    err => {
      assert.match(err.message, /Clinical data duplicates require operator review/);
      assert.match(err.message, /duplicate_encounter_token/);
      return true;
    }
  );

  // Crucial check: No destructive legacy rewrite! Both corrupt records still exist exactly as inserted
  const foundEncA = await EncounterJourney.collection.findOne({ _id: encA._id });
  const foundEncB = await EncounterJourney.collection.findOne({ _id: encB._id });
  assert.ok(foundEncA && foundEncB, "Duplicate encounters must be preserved for reviewed repair");

  const foundLabA = await LabOrder.collection.findOne({ _id: labA._id });
  const foundLabB = await LabOrder.collection.findOne({ _id: labB._id });
  assert.ok(foundLabA && foundLabB, "Duplicate lab orders must be preserved for reviewed repair");

  const foundRxA = await Prescription.collection.findOne({ _id: rxA._id });
  const foundRxB = await Prescription.collection.findOne({ _id: rxB._id });
  assert.ok(foundRxA && foundRxB, "Duplicate prescriptions must be preserved for reviewed repair");

  // Clean up corrupt test data
  await EncounterJourney.deleteMany({});
  await LabOrder.deleteMany({});
  await Prescription.deleteMany({});
});

test("conflicting index definitions fail inspection and refuse apply", async () => {
  try {
    await EncounterJourney.collection.dropIndex("ag01_encounter_hospital_stage");
  } catch {}

  // Manually create an index on EncounterJourney with a conflicting name and different options
  await EncounterJourney.collection.createIndex(
    { hospitalId: 1, currentStage: -1 }, // Conflicting sort direction
    { name: "ag01_encounter_hospital_stage" }
  );

  const conflictPlan = await inspectClinicalSchema();
  assert.equal(conflictPlan.ready, false);
  const encounterColl = conflictPlan.collections.find(c => c.collection === "encounterjourneys");
  assert.ok(encounterColl.conflicts.includes("ag01_encounter_hospital_stage"));

  await assert.rejects(
    applyClinicalSchema(),
    err => {
      assert.match(err.message, /Conflicting clinical indexes require operator review/);
      assert.match(err.message, /ag01_encounter_hospital_stage/);
      return true;
    }
  );

  // Drop conflicting test index
  await EncounterJourney.collection.dropIndex("ag01_encounter_hospital_stage");
});
