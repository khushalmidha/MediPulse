import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import User from "../../model/user.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import AuthSession from "../../model/authSession.js";
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
  replayFailedLisMessage,
  registerDicomStudy,
  configureEnterpriseSso,
  executeDisasterRecoveryDrill,
  generateEnterpriseAcceptanceReport,
  getExternalInterfaceContracts,
  getLisMessageLogs,
  getDicomStudyReferences,
  getDicomStudyById,
  getEnterpriseSsoProfile,
  getDisasterRecoveryAudits,
} from "../../services/hospitalIntegrationsService.js";
import hospitalIntegrationsRouter from "../../routes/hospitalIntegrations.js";

let uri = null;
try {
  uri = new URL(localTestTargets().mongo);
  uri.pathname = "/medipulse_test_integrations_" + crypto.randomBytes(6).toString("hex");
} catch {
  // Gracefully fallback when test targets not present in ambient environment
}

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id();
const foreignHospitalId = id();
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
    registrationNumber: "REG-MEDANTA-001",
    type: "private",
    email: "medanta-enterprise@example.test",
    address: { city: "Gurugram", state: "Haryana" },
    status: "active",
    subscription: { plan: "enterprise", status: "active" },
  });

  await Hospital.create({
    _id: foreignHospitalId,
    name: "Apollo Global Foreign Hospital",
    slug: "apollo-foreign",
    registrationNumber: "REG-APOLLO-999",
    type: "private",
    email: "foreign@apollo.test",
    address: { city: "Delhi", state: "Delhi" },
    status: "active",
    subscription: { plan: "enterprise", status: "active" },
  });

  await Department.create({
    _id: departmentId,
    hospitalId,
    name: "Health Informatics & Telemedicine",
    code: "HIT-DEPT",
    status: "active",
    opd: { consultationFee: 500, isActive: true },
  });

  await HospitalStaff.create({
    _id: staffId,
    hospitalId,
    departmentIds: [departmentId],
    name: "Enterprise Solutions Architect Arvind Swaminathan",
    email: "arvind.swaminathan@medanta.test",
    role: "HOSPITAL_ADMIN",
    isActive: true,
  });

  await User.create({
    _id: patientId,
    firstName: "Gopal",
    lastName: "Gokhale",
    email: "gopal.gokhale@test.org",
    password: "Password@123",
    gender: "male",
    phoneNumber: 9876543210,
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
    assert.equal(msgRes.status, "received");

    const savedLog = await LisMessageLog.findOne({ messageControlId: "MSG-HL7-LIVE-001" });
    assert.ok(savedLog);
    assert.equal(savedLog.status, "received");
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
    assert.equal(drillRes.metrics.overallStatus, "recorded_unverified");

    // 3. Generate acceptance report
    const report = await generateEnterpriseAcceptanceReport({ hospitalId });
    assert.equal(report.operatingAcceptance.outpatientPilotPreserved, false);
    assert.equal(report.operatingAcceptance.status, "not_accepted");
  });

  await t.test("3. Service queries for contracts, LIS logs, DICOM studies, SSO, and DR audits", async () => {
    const contracts = await getExternalInterfaceContracts({ hospitalId });
    assert.equal(contracts.success, true);
    assert.ok(Array.isArray(contracts.contracts));

    const lisLogs = await getLisMessageLogs({ hospitalId });
    assert.equal(lisLogs.success, true);
    assert.ok(Array.isArray(lisLogs.logs));

    const studies = await getDicomStudyReferences({ hospitalId });
    assert.equal(studies.success, true);
    assert.ok(Array.isArray(studies.studies));

    const sso = await getEnterpriseSsoProfile({ hospitalId });
    assert.equal(sso.success, true);

    const drAudits = await getDisasterRecoveryAudits({ hospitalId });
    assert.equal(drAudits.success, true);
    assert.ok(Array.isArray(drAudits.audits));
  });

  await t.test("4. Comprehensive HTTP Router Integration: Auth, Roles, Isolation, LIS Replay, DICOM & DR Truthfulness", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/integrations", hospitalIntegrationsRouter);
    app.use("/api/enterprise", hospitalIntegrationsRouter);

    app.use((err, req, res, next) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const server = app.listen(0);
    await once(server, "listening");
    const port = server.address().port;
    const apiOrigin = `http://127.0.0.1:${port}`;

    try {
      const createStaffSession = async ({ role, adminAccess = false, hId = hospitalId }) => {
        const staffMember = await HospitalStaff.create({
          hospitalId: hId,
          departmentIds: [departmentId],
          name: `Staff Member ${role}`,
          email: `staff.${role.toLowerCase()}.${crypto.randomBytes(4).toString("hex")}@medanta.test`,
          role,
          adminAccess,
          isActive: true,
          inviteStatus: "accepted",
        });
        const sid = crypto.randomUUID();
        await AuthSession.create({
          _id: sid,
          principalId: staffMember._id,
          kind: "staff",
          authVersion: 0,
          csrfToken: "csrf-token-test",
          expiresAt: new Date(Date.now() + 600000),
        });
        const token = jwt.sign(
          {
            id: String(staffMember._id),
            sid,
            role,
            type: "staff",
            hospitalId: String(hId),
          },
          process.env.TOKEN_KEY || "local-development-signing-key-replace-before-production"
        );
        return { staff: staffMember, token };
      };

      const { token: adminToken } = await createStaffSession({ role: "HOSPITAL_ADMIN", adminAccess: true });
      const { token: labTechToken } = await createStaffSession({ role: "LAB_TECH" });
      const { token: doctorToken } = await createStaffSession({ role: "DOCTOR" });
      const { token: nurseToken } = await createStaffSession({ role: "NURSE" });
      const { token: foreignAdminToken } = await createStaffSession({ role: "HOSPITAL_ADMIN", adminAccess: true, hId: foreignHospitalId });

      const request = async (path, { method = "GET", token, body } = {}) => {
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${apiOrigin}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data };
      };

      // 4.1 Unauthenticated request returns 401
      const unauthRes = await request("/api/integrations/contracts");
      assert.equal(unauthRes.status, 401);

      // 4.2 Role boundaries
      // Only HOSPITAL_ADMIN can register contracts: NURSE gets 403
      const nurseContractRes = await request("/api/integrations/contracts", {
        method: "POST",
        token: nurseToken,
        body: { interfaceType: "LIS_HL7", contractVersion: "v1", endpointUrl: "http://test" },
      });
      assert.equal(nurseContractRes.status, 403);

      // Only HOSPITAL_ADMIN can configure SSO: LAB_TECH gets 403
      const labSsoRes = await request("/api/integrations/sso/configure", {
        method: "POST",
        token: labTechToken,
        body: { idpType: "azure_ad", entityId: "spn:medanta" },
      });
      assert.equal(labSsoRes.status, 403);

      // Only HOSPITAL_ADMIN can execute DR drills: DOCTOR gets 403
      const docDrillRes = await request("/api/integrations/dr/drills", {
        method: "POST",
        token: doctorToken,
        body: { drillType: "failover_simulation", measuredRpoMinutes: 5, measuredRtoMinutes: 15, recordsIntegrityVerified: true, conductedBy: "Dr." },
      });
      assert.equal(docDrillRes.status, 403);

      // 4.3 External Interface Contract Registration via Admin HTTP
      const registerContractRes = await request("/api/integrations/contracts", {
        method: "POST",
        token: adminToken,
        body: {
          interfaceType: "PACS_DICOM",
          contractVersion: "DICOM-3.0-2026",
          endpointUrl: "https://pacs.medanta.internal/dicom-web",
          downtimeOwnership: {
            primaryContact: "Radiology Systems Engineer Ramesh (ext 502)",
            escalationMinutes: 15,
            offlineQueuePolicy: "store_and_forward",
          },
          authConfig: {
            clientId: "pacs-client-01",
            issuerUrl: "https://auth.medanta.internal",
          },
        },
      });
      assert.equal(registerContractRes.status, 201);
      assert.equal(registerContractRes.data.contract.interfaceType, "PACS_DICOM");

      // List contracts
      const listContractsRes = await request("/api/integrations/contracts", {
        token: adminToken,
      });
      assert.equal(listContractsRes.status, 200);
      assert.ok(listContractsRes.data.contracts.length >= 1);

      // 4.4 Inbound LIS Message Processing via LAB_TECH HTTP
      const lisRes = await request("/api/integrations/lis/inbound", {
        method: "POST",
        token: labTechToken,
        body: {
          messageControlId: "MSG-HL7-HTTP-001",
          messageType: "HL7_ORU_R01",
          accessionNumber: "ACC-LAB-881",
          payload: { hematology: { hb: 13.5, platelets: 250000 } },
        },
      });
      assert.equal(lisRes.status, 201);
      assert.equal(lisRes.data.idempotentReplay, false);
      assert.equal(lisRes.data.status, "received");

      // 4.5 Inbound LIS Idempotent Replay with duplicate messageControlId returns 200 without duplicate insertion
      const lisReplayRes = await request("/api/integrations/lis/inbound", {
        method: "POST",
        token: labTechToken,
        body: {
          messageControlId: "MSG-HL7-HTTP-001",
          messageType: "HL7_ORU_R01",
          accessionNumber: "ACC-LAB-881",
          payload: { hematology: { hb: 13.5, platelets: 250000 } },
        },
      });
      assert.equal(lisReplayRes.status, 200);
      assert.equal(lisReplayRes.data.idempotentReplay, true);

      // Replay failed LIS message endpoint
      const replayActionRes = await request("/api/integrations/lis/logs/MSG-HL7-HTTP-001/replay", {
        method: "POST",
        token: labTechToken,
      });
      assert.equal(replayActionRes.status, 503);
      assert.equal((await LisMessageLog.findOne({ hospitalId, messageControlId: "MSG-HL7-HTTP-001" })).replayCount, 0);

      // 4.6 PACS DICOM Study Registration via DOCTOR HTTP
      const dicomRes = await request("/api/integrations/pacs/studies", {
        method: "POST",
        token: doctorToken,
        body: {
          studyInstanceUid: "1.2.840.113619.2.55.3.HTTP.7711",
          accessionNumber: "ACC-RAD-7711",
          patientId,
          modality: "CT",
          studyDescription: "Contrast-Enhanced Chest CT",
          seriesCount: 4,
          instanceCount: 320,
          wadoRsUri: "https://pacs.medanta.internal/wado/studies/1.2.840.113619.2.55.3.HTTP.7711",
          reportSummary: "Clear lung parenchyma without evidence of pulmonary embolism or consolidation.",
        },
      });
      assert.equal(dicomRes.status, 201);
      const studyId = dicomRes.data.study._id;

      // Retrieve study by ID
      const studyGetRes = await request(`/api/integrations/pacs/studies/${studyId}`, {
        token: nurseToken,
      });
      assert.equal(studyGetRes.status, 200);
      assert.equal(studyGetRes.data.study.modality, "CT");

      // 4.7 Enterprise SSO Configuration via Admin HTTP
      const ssoConfigRes = await request("/api/integrations/sso/configure", {
        method: "POST",
        token: adminToken,
        body: {
          idpType: "azure_ad",
          entityId: "spn:medanta-enterprise-identity",
          metadataUrl: "https://login.microsoftonline.com/medanta/federationmetadata/2007-06/federationmetadata.xml",
          scimEnabled: true,
          autoProvisionRoles: ["DOCTOR", "NURSE"],
        },
      });
      assert.equal(ssoConfigRes.status, 200);
      assert.equal(ssoConfigRes.data.profile.scimEnabled, true);

      // 4.8 Disaster Recovery Drill Observation via Admin HTTP
      const drDrillRes = await request("/api/integrations/dr/drills", {
        method: "POST",
        token: adminToken,
        body: {
          drillType: "oplog_replay_check",
          measuredRpoMinutes: 4,
          measuredRtoMinutes: 22,
          recordsIntegrityVerified: true,
          conductedBy: "IT Lead Devinder Sharma",
          auditNotes: "Oplog replay verified against synthetic point-in-time snapshot.",
        },
      });
      assert.equal(drDrillRes.status, 201);
      // Confirms truthful boundary: observations recorded but unverified by machine
      assert.equal(drDrillRes.data.audit.status, "recorded_unverified");
      assert.equal(drDrillRes.data.audit.recordsIntegrityVerified, false);
      assert.equal(drDrillRes.data.audit.reportedIntegrityVerified, true);

      // 4.9 Truthful Enterprise Acceptance Report via Admin HTTP
      const reportRes = await request("/api/enterprise/acceptance/report", {
        token: adminToken,
      });
      assert.equal(reportRes.status, 200);
      assert.equal(reportRes.data.report.operatingAcceptance.status, "not_accepted");
      assert.equal(reportRes.data.report.operatingAcceptance.outpatientPilotPreserved, false);
      assert.ok(reportRes.data.report.operatingAcceptance.disclaimer);

      // 4.10 Tenant Isolation: Foreign hospital staff cannot see Medanta contracts or studies
      const foreignContractsRes = await request("/api/integrations/contracts", {
        token: foreignAdminToken,
      });
      assert.equal(foreignContractsRes.status, 200);
      assert.equal(foreignContractsRes.data.contracts.length, 0); // Isolated!
    } finally {
      server.close();
    }
  });
});


test("AG22 review: concurrent LIS receipts preserve content and tenant identity", async (t) => {
  if (!db) {
    t.skip("Local MongoDB replica set unavailable; skipping live integration tests");
    return;
  }
  const input = { hospitalId, messageControlId: "CONCURRENT-RECEIPT", messageType: "HL7_ORU_R01", accessionNumber: "SYNTHETIC-ACC", payload: { b: 2, a: 1 } };
  const results = await Promise.all(Array.from({ length: 12 }, () => processInboundLisMessage(input)));
  assert.equal(results.filter(result => !result.idempotentReplay).length, 1);
  assert.equal(await LisMessageLog.countDocuments({ hospitalId, messageControlId: input.messageControlId }), 1);
  assert.ok(results.every(result => result.status === "received" && result.log.processedAt === null));
  assert.equal((await processInboundLisMessage({ ...input, payload: { a: 1, b: 2 } })).idempotentReplay, true);
  for (const change of [{ payload: { a: 9 } }, { accessionNumber: "OTHER" }, { messageType: "ASTM_E1394" }]) await assert.rejects(processInboundLisMessage({ ...input, ...change }), error => error.status === 409);
  const foreign = await processInboundLisMessage({ ...input, hospitalId: foreignHospitalId });
  assert.equal(foreign.idempotentReplay, false);
  await assert.rejects(replayFailedLisMessage(input), error => error.status === 503);
  const stored = await LisMessageLog.findOne({ hospitalId, messageControlId: input.messageControlId });
  assert.equal(stored.replayCount, 0); assert.equal(stored.status, "received");
});

test("AG22 review: stored viewer links reject script and credential URLs; search is literal", async (t) => {
  if (!db) {
    t.skip("Local MongoDB replica set unavailable; skipping live integration tests");
    return;
  }
  for (const wadoRsUri of ["javascript:alert(1)", "https://user:secret@example.invalid/study"]) await assert.rejects(registerDicomStudy({ hospitalId, studyInstanceUid: "synthetic", accessionNumber: "synthetic", patientId, modality: "CT", wadoRsUri }), error => error.status === 400);
  assert.equal((await getDicomStudyReferences({ hospitalId, search: "[invalid(regex" })).total, 0);
});
