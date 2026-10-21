import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import User from "../../model/user.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import {
  ExternalInterfaceContract,
  LisMessageLog,
  DicomStudyReference,
  EnterpriseSsoProfile,
  DisasterRecoveryAudit,
} from "../../model/hospitalIntegrations.js";
import { localTestTargets } from "../../util/testTargets.js";
import {
  registerExternalInterfaceContract,
  processInboundLisMessage,
  registerDicomStudy,
  configureEnterpriseSso,
  executeDisasterRecoveryDrill,
  generateEnterpriseAcceptanceReport,
} from "../../services/hospitalIntegrationsService.js";

let uri = null;
try {
  uri = new URL(localTestTargets().mongo);
  uri.pathname = "/medipulse_test_integrations_" + crypto.randomBytes(6).toString("hex");
} catch {
  // Gracefully fallback when test targets not present in ambient environment
}

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id();
const departmentId = id();
const staffId = id();
const patientId = id();
let db;

before(async (t) => {
  if (!uri) {
    t.skip("Local test targets not configured; skipping live integration tests");
    return;
  }
  try {
    await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 3000 });
    db = mongoose.connection.db;
  } catch {
    t.skip("Local MongoDB replica set unavailable; skipping live integration tests");
  }
});

after(async () => {
  await db?.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!db) return;
  for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) {
    await db.collection(collection.name).deleteMany({});
  }

  await Hospital.create({
    _id: hospitalId,
    name: "Medanta The Medicity Enterprise Hospital",
    slug: "medanta-enterprise",
    status: "active",
    subscription: { plan: "enterprise", status: "active" },
  });

  await Department.create({
    _id: departmentId,
    hospitalId,
    name: "Health Informatics & Telemedicine",
    code: "HIT-DEPT",
    status: "active",
  });

  await HospitalStaff.create({
    _id: staffId,
    hospitalId,
    departmentIds: [departmentId],
    name: "Enterprise Solutions Architect Arvind Swaminathan",
    role: "ADMIN",
    isActive: true,
  });

  await User.create({
    _id: patientId,
    name: "Gopal Krishna Gokhale",
    email: "gopal.gokhale@test.org",
    phone: "9876543210",
  });
});

test("Task AG22: Hospital Integrations and Enterprise Operating Acceptance (Integration)", async (t) => {
  if (!db) {
    t.skip("Local MongoDB replica set unavailable; skipping live integration tests");
    return;
  }

  await t.test("1. External interface contract and LIS message logging in MongoDB", async () => {
    // 1. Register LIS interface
    const contractRes = await registerExternalInterfaceContract({
      hospitalId,
      interfaceType: "LIS_HL7",
      contractVersion: "HL7-v2.5.1",
      endpointUrl: "https://lis.medanta.internal/hl7",
      downtimeOwnership: {
        primaryContact: "LIS Admin Anil V (ext 104)",
        escalationMinutes: 20,
        offlineQueuePolicy: "store_and_forward",
      },
    });
    assert.equal(contractRes.success, true);
    assert.equal(contractRes.contract.status, "configured");

    // 2. Process inbound LIS message
    const msgRes = await processInboundLisMessage({
      hospitalId,
      messageControlId: "MSG-HL7-LIVE-001",
      messageType: "HL7_ORU_R01",
      accessionNumber: "ACC-LIVE-901",
      payload: { test: "CBC", wbc: 7.2, rbc: 4.8 },
    });
    assert.equal(msgRes.success, true);
    assert.equal(msgRes.status, "processed");

    const savedLog = await LisMessageLog.findOne({ messageControlId: "MSG-HL7-LIVE-001" });
    assert.ok(savedLog);
    assert.equal(savedLog.status, "processed");
  });

  await t.test("2. PACS DICOM study registration and enterprise DR drill execution", async () => {
    // 1. Register DICOM study reference
    const studyRes = await registerDicomStudy({
      hospitalId,
      studyInstanceUid: "1.2.840.113619.2.55.3.LIVE.9901",
      accessionNumber: "ACC-LIVE-RAD-01",
      patientId,
      modality: "MRI",
      studyDescription: "Brain MRI with Diffusion",
      seriesCount: 6,
      instanceCount: 280,
      wadoRsUri: "https://pacs.medanta.internal/wado/studies/1.2.840.113619.2.55.3.LIVE.9901",
      reportSummary: "Normal intracranial morphology without acute infarct or hemorrhage.",
    });
    assert.equal(studyRes.success, true);

    const savedStudy = await DicomStudyReference.findOne({ studyInstanceUid: "1.2.840.113619.2.55.3.LIVE.9901" });
    assert.ok(savedStudy);
    assert.equal(savedStudy.modality, "MRI");

    // 2. Execute DR drill
    const drillRes = await executeDisasterRecoveryDrill({
      hospitalId,
      drillType: "cold_standby_restore",
      measuredRpoMinutes: 6,
      measuredRtoMinutes: 28,
      recordsIntegrityVerified: true,
      conductedBy: "IT Director Dr. Sanjeev K",
      auditNotes: "Cold standby restored from continuous oplog backup with 100% data integrity verified.",
    });
    assert.equal(drillRes.metrics.overallStatus, "passed");

    // 3. Generate acceptance report
    const report = await generateEnterpriseAcceptanceReport({ hospitalId });
    assert.equal(report.operatingAcceptance.outpatientPilotPreserved, true);
    assert.equal(report.operatingAcceptance.unsupportedClaimsAbsent, true);
  });
});
