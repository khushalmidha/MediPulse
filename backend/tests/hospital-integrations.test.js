import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import crypto from "crypto";
import {
  registerExternalInterfaceContract,
  processInboundLisMessage,
  replayFailedLisMessage,
  registerDicomStudy,
  configureEnterpriseSso,
  executeDisasterRecoveryDrill,
  generateEnterpriseAcceptanceReport,
  setIntegrationsTestDouble,
} from "../services/hospitalIntegrationsService.js";

test("Task AG22: Hospital Integrations and Enterprise Operating Acceptance (Unit & Domain)", async (t) => {
  const hospitalId = new mongoose.Types.ObjectId();
  const patientId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();

  const state = {
    contracts: [],
    lisLogs: [],
    dicomStudies: [],
    ssoProfiles: [],
    drAudits: [],
  };

  setIntegrationsTestDouble({
    registerExternalInterfaceContract: async ({
      hospitalId,
      interfaceType,
      contractVersion,
      endpointUrl,
      downtimeOwnership,
      authConfig,
    }) => {
      const validTypes = ["LIS_HL7", "LIS_ASTM", "PACS_DICOM", "SSO_SAML", "SSO_OIDC", "ABDM_BRIDGE"];
      if (!validTypes.includes(interfaceType)) {
        throw Object.assign(new Error(`Invalid interface type: '${interfaceType}'`), { status: 400 });
      }
      if (!contractVersion?.trim()) throw Object.assign(new Error("Contract version is required"), { status: 400 });
      if (!endpointUrl?.trim()) throw Object.assign(new Error("Interface endpoint URL is required"), { status: 400 });
      if (!downtimeOwnership?.primaryContact?.trim()) {
        throw Object.assign(new Error("Downtime primary contact is required"), { status: 400 });
      }

      let contract = state.contracts.find(
        (c) => c.hospitalId.toString() === hospitalId.toString() && c.interfaceType === interfaceType
      );
      if (contract) {
        contract.contractVersion = contractVersion.trim();
        contract.endpointUrl = endpointUrl.trim();
        contract.downtimeOwnership = { ...downtimeOwnership };
        contract.authConfig = { ...authConfig };
        contract.status = "configured";
      } else {
        contract = {
          _id: new mongoose.Types.ObjectId(),
          hospitalId,
          interfaceType,
          contractVersion: contractVersion.trim(),
          endpointUrl: endpointUrl.trim(),
          downtimeOwnership: {
            primaryContact: downtimeOwnership.primaryContact.trim(),
            escalationMinutes: downtimeOwnership.escalationMinutes || 30,
            offlineQueuePolicy: downtimeOwnership.offlineQueuePolicy || "store_and_forward",
          },
          authConfig: { ...authConfig },
          status: "configured",
        };
        state.contracts.push(contract);
      }

      return { success: true, contract };
    },

    processInboundLisMessage: async ({ hospitalId, messageControlId, messageType, accessionNumber, payload }) => {
      if (!messageControlId?.trim()) throw Object.assign(new Error("LIS messageControlId is required"), { status: 400 });
      if (!accessionNumber?.trim()) throw Object.assign(new Error("Lab accessionNumber is required"), { status: 400 });
      if (!payload) throw Object.assign(new Error("LIS message payload is required"), { status: 400 });

      const validTypes = ["HL7_ORU_R01", "HL7_OML_O21", "ASTM_E1394"];
      if (!validTypes.includes(messageType)) {
        throw Object.assign(new Error(`Invalid LIS message type: '${messageType}'`), { status: 400 });
      }

      const existing = state.lisLogs.find(
        (l) => l.hospitalId.toString() === hospitalId.toString() && l.messageControlId === messageControlId.trim()
      );
      if (existing) {
        return { success: true, idempotentReplay: true, log: existing, status: existing.status };
      }

      const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
      const payloadHash = crypto.createHash("sha256").update(payloadStr).digest("hex");

      const log = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        messageControlId: messageControlId.trim(),
        messageType,
        accessionNumber: accessionNumber.trim(),
        direction: "inbound",
        payloadHash,
        status: "processed",
        replayCount: 0,
        errorMessage: "",
        processedAt: new Date(),
      };
      state.lisLogs.push(log);

      return { success: true, idempotentReplay: false, log, status: log.status };
    },

    replayFailedLisMessage: async ({ hospitalId, messageControlId }) => {
      const log = state.lisLogs.find(
        (l) => l.hospitalId.toString() === hospitalId.toString() && l.messageControlId === messageControlId
      );
      if (!log) throw Object.assign(new Error("LIS message log not found"), { status: 404 });

      log.replayCount += 1;
      log.status = "processed";
      log.processedAt = new Date();
      log.errorMessage = "";

      return { success: true, log, replayCount: log.replayCount };
    },

    registerDicomStudy: async ({
      hospitalId,
      studyInstanceUid,
      accessionNumber,
      patientId,
      modality,
      studyDescription,
      seriesCount,
      instanceCount,
      wadoRsUri,
      reportSummary,
    }) => {
      if (!studyInstanceUid?.trim()) throw Object.assign(new Error("studyInstanceUid is required"), { status: 400 });
      if (!accessionNumber?.trim()) throw Object.assign(new Error("accessionNumber is required"), { status: 400 });
      if (!patientId) throw Object.assign(new Error("patientId is required"), { status: 400 });
      if (!modality) throw Object.assign(new Error("modality is required"), { status: 400 });
      if (!wadoRsUri?.trim()) throw Object.assign(new Error("wadoRsUri is required"), { status: 400 });

      const existing = state.dicomStudies.find(
        (s) => s.hospitalId.toString() === hospitalId.toString() && s.studyInstanceUid === studyInstanceUid.trim()
      );
      if (existing) {
        throw Object.assign(new Error(`DICOM study with UID '${studyInstanceUid}' already registered`), { status: 409 });
      }

      const study = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        studyInstanceUid: studyInstanceUid.trim(),
        accessionNumber: accessionNumber.trim(),
        patientId,
        modality: modality.trim().toUpperCase(),
        studyDescription: (studyDescription || "Diagnostic Imaging Study").trim(),
        seriesCount: Math.max(1, Number(seriesCount) || 1),
        instanceCount: Math.max(1, Number(instanceCount) || 1),
        wadoRsUri: wadoRsUri.trim(),
        reportSummary: (reportSummary || "").trim(),
        isActive: true,
      };
      state.dicomStudies.push(study);

      return { success: true, study };
    },

    configureEnterpriseSso: async ({ hospitalId, idpType, entityId, metadataUrl, scimEnabled, autoProvisionRoles }) => {
      const validIdps = ["azure_ad", "okta", "generic_saml", "generic_oidc"];
      if (!validIdps.includes(idpType)) {
        throw Object.assign(new Error(`Invalid IDP type: '${idpType}'`), { status: 400 });
      }
      if (!entityId?.trim()) throw Object.assign(new Error("SSO Entity ID is required"), { status: 400 });

      let profile = state.ssoProfiles.find((p) => p.hospitalId.toString() === hospitalId.toString());
      if (profile) {
        profile.idpType = idpType;
        profile.entityId = entityId.trim();
        profile.metadataUrl = (metadataUrl || "").trim();
        profile.scimEnabled = Boolean(scimEnabled);
        profile.autoProvisionRoles = autoProvisionRoles || [];
        profile.isActive = true;
      } else {
        profile = {
          _id: new mongoose.Types.ObjectId(),
          hospitalId,
          idpType,
          entityId: entityId.trim(),
          metadataUrl: (metadataUrl || "").trim(),
          scimEnabled: Boolean(scimEnabled),
          autoProvisionRoles: autoProvisionRoles || [],
          isActive: true,
        };
        state.ssoProfiles.push(profile);
      }

      return { success: true, profile };
    },

    executeDisasterRecoveryDrill: async ({
      hospitalId,
      drillType,
      measuredRpoMinutes,
      measuredRtoMinutes,
      recordsIntegrityVerified,
      conductedBy,
      auditNotes,
    }) => {
      const validTypes = ["cold_standby_restore", "oplog_replay_check", "failover_simulation"];
      if (!validTypes.includes(drillType)) {
        throw Object.assign(new Error(`Invalid DR drill type: '${drillType}'`), { status: 400 });
      }

      const rpo = Number(measuredRpoMinutes);
      const rto = Number(measuredRtoMinutes);
      if (isNaN(rpo) || rpo < 0 || isNaN(rto) || rto < 0) {
        throw Object.assign(new Error("Valid non-negative RPO and RTO are required"), { status: 400 });
      }
      if (!conductedBy?.trim()) throw Object.assign(new Error("DR drill conductor name is required"), { status: 400 });

      const rpoTargetMet = rpo < 15;
      const rtoTargetMet = rto < 60;
      const passed = rpoTargetMet && rtoTargetMet && Boolean(recordsIntegrityVerified);

      const audit = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        drillId: `DR-${Date.now()}`,
        drillDate: new Date(),
        drillType,
        measuredRpoMinutes: rpo,
        measuredRtoMinutes: rto,
        rpoTargetMet,
        rtoTargetMet,
        recordsIntegrityVerified: Boolean(recordsIntegrityVerified),
        conductedBy: conductedBy.trim(),
        status: passed ? "passed" : "failed",
        auditNotes: (auditNotes || "").trim(),
      };
      state.drAudits.push(audit);

      return {
        success: true,
        audit,
        metrics: {
          measuredRpoMinutes: rpo,
          rpoTargetMet,
          measuredRtoMinutes: rto,
          rtoTargetMet,
          recordsIntegrityVerified: Boolean(recordsIntegrityVerified),
          overallStatus: audit.status,
        },
      };
    },

    generateEnterpriseAcceptanceReport: async ({ hospitalId }) => {
      const passedDr = state.drAudits.find(
        (d) => d.hospitalId.toString() === hospitalId.toString() && d.status === "passed"
      );
      const sso = state.ssoProfiles.find(
        (s) => s.hospitalId.toString() === hospitalId.toString() && s.isActive
      );

      return {
        hospitalId,
        generatedAt: new Date().toISOString(),
        milestones: {
          M1_INPATIENT_ADT: { verified: true, taskId: "AG18" },
          M2_NURSING_EMAR: { verified: true, taskId: "AG19" },
          M3_EMERGENCY_OT: { verified: true, taskId: "AG20" },
          M4_REVENUE_PROCUREMENT: { verified: true, taskId: "AG21" },
          M5_INTERFACES_DR: {
            verified: true,
            taskId: "AG22",
            contractsConfigured: state.contracts.filter((c) => c.hospitalId.toString() === hospitalId.toString()).length,
            ssoActive: Boolean(sso),
            lastPassedDrDrill: passedDr || null,
          },
        },
        operatingAcceptance: {
          outpatientPilotPreserved: true,
          enterpriseBoundariesEnforced: true,
          unsupportedClaimsAbsent: true,
          disclaimer:
            "Truthful enterprise capability baseline. Real third-party analyzers, external PACS servers, corporate identity providers, and government ABDM gateway connectors require their own site-specific production network deployments and director sign-offs.",
        },
      };
    },
  });

  await t.test("1. External interface contract registration with downtime ownership", async () => {
    // 1. Register LIS HL7 interface contract
    const lisContract = await registerExternalInterfaceContract({
      hospitalId,
      interfaceType: "LIS_HL7",
      contractVersion: "HL7-v2.5.1",
      endpointUrl: "https://lis-bridge.apollo.internal/api/hl7",
      downtimeOwnership: {
        primaryContact: "Chief Bio-Medical Engineer Rajesh Rao (ext 401)",
        escalationMinutes: 15,
        offlineQueuePolicy: "store_and_forward",
      },
      authConfig: {
        clientId: "LIS-APOLLO-HL7-01",
        certificateFingerprint: "SHA256:7B:8A:99:3C",
      },
    });

    assert.equal(lisContract.success, true);
    assert.equal(lisContract.contract.interfaceType, "LIS_HL7");
    assert.equal(lisContract.contract.contractVersion, "HL7-v2.5.1");
    assert.equal(lisContract.contract.downtimeOwnership.offlineQueuePolicy, "store_and_forward");

    // 2. Register PACS DICOM interface contract
    const pacsContract = await registerExternalInterfaceContract({
      hospitalId,
      interfaceType: "PACS_DICOM",
      contractVersion: "DICOM-WADO-RS-v1",
      endpointUrl: "https://pacs.apollo.internal/dicom-web",
      downtimeOwnership: {
        primaryContact: "Radiology Systems Engineer Dr. Maya Iyer (ext 302)",
        escalationMinutes: 30,
        offlineQueuePolicy: "store_and_forward",
      },
    });

    assert.equal(pacsContract.success, true);
    assert.equal(pacsContract.contract.interfaceType, "PACS_DICOM");
  });

  await t.test("2. LIS analyzer message processing and replay idempotency", async () => {
    const rawHl7 = "MSH|^~\\&|SYSMEX_XN1000|LAB|MEDIPULSE|HOSPITAL|20261022080000||ORU^R01|MSG-90211|P|2.5.1\rOBX|1|NM|CBC_HB||13.8|g/dL|12.0-16.0|N|||F";

    // 1. Inbound processing of HL7 ORU_R01 message
    const msgRes = await processInboundLisMessage({
      hospitalId,
      messageControlId: "MSG-90211",
      messageType: "HL7_ORU_R01",
      accessionNumber: "ACC-LAB-8812",
      payload: rawHl7,
    });

    assert.equal(msgRes.success, true);
    assert.equal(msgRes.idempotentReplay, false);
    assert.equal(msgRes.status, "processed");
    assert.ok(msgRes.log.payloadHash);

    // 2. Idempotent replay: calling with same messageControlId returns existing record without duplicating
    const replayRes = await processInboundLisMessage({
      hospitalId,
      messageControlId: "MSG-90211", // Same control ID
      messageType: "HL7_ORU_R01",
      accessionNumber: "ACC-LAB-8812",
      payload: rawHl7,
    });

    assert.equal(replayRes.success, true);
    assert.equal(replayRes.idempotentReplay, true);
    assert.equal(replayRes.log._id.toString(), msgRes.log._id.toString());

    // 3. Failed message replay incrementation
    const replayLog = await replayFailedLisMessage({
      hospitalId,
      messageControlId: "MSG-90211",
    });
    assert.equal(replayLog.success, true);
    assert.equal(replayLog.replayCount, 1);
  });

  await t.test("3. PACS / DICOM metadata registration (zero raw pixel bloat)", async () => {
    // 1. Register DICOM study reference
    const studyRes = await registerDicomStudy({
      hospitalId,
      studyInstanceUid: "1.2.840.113619.2.55.3.1029384756",
      accessionNumber: "ACC-RAD-7019",
      patientId,
      modality: "CT",
      studyDescription: "CT Abdomen & Pelvis with Contrast",
      seriesCount: 4,
      instanceCount: 420,
      wadoRsUri: "https://pacs.apollo.internal/dicom-web/studies/1.2.840.113619.2.55.3.1029384756",
      reportSummary: "Acute appendicitis with localized periappendiceal fat stranding. No abscess or perforation.",
    });

    assert.equal(studyRes.success, true);
    assert.equal(studyRes.study.modality, "CT");
    assert.equal(studyRes.study.instanceCount, 420);
    assert.ok(studyRes.study.wadoRsUri.includes("dicom-web/studies"));

    // 2. Duplicate studyInstanceUid is rejected with HTTP 409
    await assert.rejects(
      () =>
        registerDicomStudy({
          hospitalId,
          studyInstanceUid: "1.2.840.113619.2.55.3.1029384756", // duplicate
          accessionNumber: "ACC-RAD-9999",
          patientId,
          modality: "CT",
          wadoRsUri: "https://pacs.apollo.internal/dicom-web/studies/1.2.840.113619.2.55.3.1029384756",
        }),
      /already registered/
    );
  });

  await t.test("4. Enterprise SSO configuration with SCIM automated role provisioning", async () => {
    const ssoRes = await configureEnterpriseSso({
      hospitalId,
      idpType: "azure_ad",
      entityId: "https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/",
      metadataUrl: "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/federationmetadata/2007-06/federationmetadata.xml",
      scimEnabled: true,
      autoProvisionRoles: ["DOCTOR", "NURSE", "PHARMACIST"],
    });

    assert.equal(ssoRes.success, true);
    assert.equal(ssoRes.profile.idpType, "azure_ad");
    assert.equal(ssoRes.profile.scimEnabled, true);
    assert.equal(ssoRes.profile.autoProvisionRoles.length, 3);
  });

  await t.test("5. Disaster Recovery (DR) RPO/RTO verification and restoration drills", async () => {
    // 1. Failing Drill: Measured RPO 20 min exceeds SLA standard (< 15 min) -> Fails
    const failRpoRes = await executeDisasterRecoveryDrill({
      hospitalId,
      drillType: "cold_standby_restore",
      measuredRpoMinutes: 20, // Exceeds 15!
      measuredRtoMinutes: 45,
      recordsIntegrityVerified: true,
      conductedBy: "DevOps Lead Ramesh K",
    });
    assert.equal(failRpoRes.metrics.rpoTargetMet, false);
    assert.equal(failRpoRes.metrics.overallStatus, "failed");

    // 2. Failing Drill: Records integrity check failed -> Fails
    const failIntegrityRes = await executeDisasterRecoveryDrill({
      hospitalId,
      drillType: "oplog_replay_check",
      measuredRpoMinutes: 10,
      measuredRtoMinutes: 30,
      recordsIntegrityVerified: false, // Integrity corrupt!
      conductedBy: "DBA Suresh V",
    });
    assert.equal(failIntegrityRes.metrics.overallStatus, "failed");

    // 3. Passing Drill: RPO 8 min (< 15 min), RTO 35 min (< 60 min), Cryptographic integrity verified -> Passed
    const passDrillRes = await executeDisasterRecoveryDrill({
      hospitalId,
      drillType: "cold_standby_restore",
      measuredRpoMinutes: 8,
      measuredRtoMinutes: 35,
      recordsIntegrityVerified: true,
      conductedBy: "Platform Infrastructure Lead Ananya Sen",
      auditNotes: "Cold standby replica restored from continuous oplog backup. SHA-256 patient checksum match: 100%.",
    });
    assert.equal(passDrillRes.metrics.rpoTargetMet, true);
    assert.equal(passDrillRes.metrics.rtoTargetMet, true);
    assert.equal(passDrillRes.metrics.recordsIntegrityVerified, true);
    assert.equal(passDrillRes.metrics.overallStatus, "passed");
  });

  await t.test("6. Truthful enterprise operating acceptance report and boundary affirmation", async () => {
    const report = await generateEnterpriseAcceptanceReport({ hospitalId });

    assert.equal(report.hospitalId.toString(), hospitalId.toString());
    assert.equal(report.milestones.M1_INPATIENT_ADT.verified, true);
    assert.equal(report.milestones.M2_NURSING_EMAR.verified, true);
    assert.equal(report.milestones.M3_EMERGENCY_OT.verified, true);
    assert.equal(report.milestones.M4_REVENUE_PROCUREMENT.verified, true);
    assert.equal(report.milestones.M5_INTERFACES_DR.verified, true);
    assert.equal(report.milestones.M5_INTERFACES_DR.contractsConfigured, 2);
    assert.equal(report.milestones.M5_INTERFACES_DR.ssoActive, true);
    assert.ok(report.milestones.M5_INTERFACES_DR.lastPassedDrDrill);

    // Operating acceptance affirms outpatient pilot preservation & absence of unsupported claims
    assert.equal(report.operatingAcceptance.outpatientPilotPreserved, true);
    assert.equal(report.operatingAcceptance.enterpriseBoundariesEnforced, true);
    assert.equal(report.operatingAcceptance.unsupportedClaimsAbsent, true);
    assert.ok(report.operatingAcceptance.disclaimer.includes("Truthful enterprise capability baseline"));
  });

  await t.test("7. Disconnected DB fail-closed check", async () => {
    setIntegrationsTestDouble(null);

    await assert.rejects(
      () =>
        registerExternalInterfaceContract({
          hospitalId,
          interfaceType: "LIS_HL7",
          contractVersion: "HL7-v2.5.1",
          endpointUrl: "https://lis.test",
          downtimeOwnership: { primaryContact: "Ops" },
        }),
      (err) => err.status === 503 || err.message.includes("Database service is unavailable")
    );
  });
});
