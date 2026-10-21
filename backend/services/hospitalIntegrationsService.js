import mongoose from "mongoose";
import crypto from "crypto";
import {
  ExternalInterfaceContract,
  LisMessageLog,
  DicomStudyReference,
  EnterpriseSsoProfile,
  DisasterRecoveryAudit,
} from "../model/hospitalIntegrations.js";
import Hospital from "../model/hospital.js";
import { accessError } from "./hospitalAccess.js";
import { assertTenantNotSuspended, checkFeatureEntitlement } from "./saasOperationsService.js";
import { ENTERPRISE_MILESTONES } from "../config/enterprisePlan.js";

let testDouble = null;
export const setIntegrationsTestDouble = (double) => {
  if (process.env.NODE_ENV !== "test") throw new Error("Enterprise test adapters are only available in tests");
  testDouble = double;
};

const assertDbConnected = () => {
  if (!testDouble && mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }
};

/**
 * 1. External Interface Contract Management
 */
export const registerExternalInterfaceContract = async ({
  hospitalId,
  interfaceType,
  contractVersion,
  endpointUrl,
  downtimeOwnership = {},
  authConfig = {},
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.registerExternalInterfaceContract) {
    return testDouble.registerExternalInterfaceContract({
      hospitalId,
      interfaceType,
      contractVersion,
      endpointUrl,
      downtimeOwnership,
      authConfig,
      actor,
    });
  }

  const validTypes = ["LIS_HL7", "LIS_ASTM", "PACS_DICOM", "SSO_SAML", "SSO_OIDC", "ABDM_BRIDGE"];
  if (!validTypes.includes(interfaceType)) {
    throw accessError(400, `Invalid interface type: '${interfaceType}'. Allowed: [${validTypes.join(", ")}]`);
  }
  if (!contractVersion || !String(contractVersion).trim()) {
    throw accessError(400, "Contract version is required");
  }
  if (!endpointUrl || !String(endpointUrl).trim()) {
    throw accessError(400, "Interface endpoint URL is required");
  }
  if (!downtimeOwnership?.primaryContact || !String(downtimeOwnership.primaryContact).trim()) {
    throw accessError(400, "Downtime primary contact is required");
  }

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");
  assertTenantNotSuspended(hospital);
  checkFeatureEntitlement(hospital, "enterprise_interfaces");

  let contract = await ExternalInterfaceContract.findOne({ hospitalId, interfaceType });
  if (contract) {
    contract.contractVersion = String(contractVersion).trim();
    contract.endpointUrl = String(endpointUrl).trim();
    contract.downtimeOwnership = {
      primaryContact: String(downtimeOwnership.primaryContact).trim(),
      escalationMinutes: downtimeOwnership.escalationMinutes || 30,
      offlineQueuePolicy: downtimeOwnership.offlineQueuePolicy || "store_and_forward",
    };
    contract.authConfig = authConfig;
    contract.status = "configured";
    await contract.save();
  } else {
    contract = await ExternalInterfaceContract.create({
      hospitalId,
      interfaceType,
      contractVersion: String(contractVersion).trim(),
      endpointUrl: String(endpointUrl).trim(),
      downtimeOwnership: {
        primaryContact: String(downtimeOwnership.primaryContact).trim(),
        escalationMinutes: downtimeOwnership.escalationMinutes || 30,
        offlineQueuePolicy: downtimeOwnership.offlineQueuePolicy || "store_and_forward",
      },
      authConfig,
      status: "configured",
    });
  }

  return { success: true, contract };
};

/**
 * 2. LIS / Analyzer Message Processing & Replay Safety
 */
export const processInboundLisMessage = async ({
  hospitalId,
  messageControlId,
  messageType,
  accessionNumber,
  payload,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.processInboundLisMessage) {
    return testDouble.processInboundLisMessage({
      hospitalId,
      messageControlId,
      messageType,
      accessionNumber,
      payload,
      actor,
    });
  }

  if (!messageControlId || !String(messageControlId).trim()) {
    throw accessError(400, "LIS messageControlId is required");
  }
  if (!accessionNumber || !String(accessionNumber).trim()) {
    throw accessError(400, "Lab accessionNumber is required");
  }
  if (!payload) throw accessError(400, "LIS message payload is required");

  const validTypes = ["HL7_ORU_R01", "HL7_OML_O21", "ASTM_E1394"];
  if (!validTypes.includes(messageType)) {
    throw accessError(400, `Invalid LIS message type: '${messageType}'. Allowed: [${validTypes.join(", ")}]`);
  }

  const payloadString = typeof payload === "string" ? payload : JSON.stringify(payload);
  const payloadHash = crypto.createHash("sha256").update(payloadString).digest("hex");

  // Idempotency: Duplicate check on messageControlId
  const existing = await LisMessageLog.findOne({ hospitalId, messageControlId });
  if (existing) {
    return {
      success: true,
      idempotentReplay: true,
      log: existing,
      status: existing.status,
    };
  }

  const log = await LisMessageLog.create({
    hospitalId,
    messageControlId: String(messageControlId).trim(),
    messageType,
    accessionNumber: String(accessionNumber).trim(),
    direction: "inbound",
    payloadHash,
    status: "processed",
    processedAt: new Date(),
  });

  return {
    success: true,
    idempotentReplay: false,
    log,
    status: log.status,
  };
};

export const replayFailedLisMessage = async ({ hospitalId, messageControlId, actor }) => {
  assertDbConnected();
  if (testDouble?.replayFailedLisMessage) {
    return testDouble.replayFailedLisMessage({ hospitalId, messageControlId, actor });
  }

  const log = await LisMessageLog.findOne({ hospitalId, messageControlId });
  if (!log) throw accessError(404, "LIS message log not found");

  log.replayCount = (log.replayCount || 0) + 1;
  log.status = "processed";
  log.processedAt = new Date();
  log.errorMessage = "";
  await log.save();

  return {
    success: true,
    log,
    replayCount: log.replayCount,
  };
};

/**
 * 3. PACS / DICOM Study Metadata Registration (Zero Raw Pixel Bloat)
 */
export const registerDicomStudy = async ({
  hospitalId,
  studyInstanceUid,
  accessionNumber,
  patientId,
  modality,
  studyDescription,
  seriesCount = 1,
  instanceCount = 1,
  wadoRsUri,
  reportSummary = "",
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.registerDicomStudy) {
    return testDouble.registerDicomStudy({
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
      actor,
    });
  }

  if (!studyInstanceUid || !String(studyInstanceUid).trim()) throw accessError(400, "studyInstanceUid is required");
  if (!accessionNumber || !String(accessionNumber).trim()) throw accessError(400, "accessionNumber is required");
  if (!patientId) throw accessError(400, "patientId is required");
  if (!modality) throw accessError(400, "modality is required");
  if (!wadoRsUri || !String(wadoRsUri).trim()) throw accessError(400, "wadoRsUri is required");

  const existing = await DicomStudyReference.findOne({ hospitalId, studyInstanceUid });
  if (existing) {
    throw accessError(409, `DICOM study with UID '${studyInstanceUid}' already registered`);
  }

  const study = await DicomStudyReference.create({
    hospitalId,
    studyInstanceUid: String(studyInstanceUid).trim(),
    accessionNumber: String(accessionNumber).trim(),
    patientId,
    modality: String(modality).trim().toUpperCase(),
    studyDescription: String(studyDescription || "Diagnostic Imaging Study").trim(),
    seriesCount: Math.max(1, Number(seriesCount) || 1),
    instanceCount: Math.max(1, Number(instanceCount) || 1),
    wadoRsUri: String(wadoRsUri).trim(),
    reportSummary: String(reportSummary || "").trim(),
  });

  return { success: true, study };
};

/**
 * 4. Enterprise SSO Configuration
 */
export const configureEnterpriseSso = async ({
  hospitalId,
  idpType,
  entityId,
  metadataUrl = "",
  scimEnabled = false,
  autoProvisionRoles = [],
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.configureEnterpriseSso) {
    return testDouble.configureEnterpriseSso({
      hospitalId,
      idpType,
      entityId,
      metadataUrl,
      scimEnabled,
      autoProvisionRoles,
      actor,
    });
  }

  const validIdps = ["azure_ad", "okta", "generic_saml", "generic_oidc"];
  if (!validIdps.includes(idpType)) {
    throw accessError(400, `Invalid IDP type: '${idpType}'. Allowed: [${validIdps.join(", ")}]`);
  }
  if (!entityId || !String(entityId).trim()) throw accessError(400, "SSO Entity ID is required");

  let profile = await EnterpriseSsoProfile.findOne({ hospitalId });
  if (profile) {
    profile.idpType = idpType;
    profile.entityId = String(entityId).trim();
    profile.metadataUrl = String(metadataUrl).trim();
    profile.scimEnabled = Boolean(scimEnabled);
    profile.autoProvisionRoles = autoProvisionRoles;
    profile.isActive = true;
    await profile.save();
  } else {
    profile = await EnterpriseSsoProfile.create({
      hospitalId,
      idpType,
      entityId: String(entityId).trim(),
      metadataUrl: String(metadataUrl).trim(),
      scimEnabled: Boolean(scimEnabled),
      autoProvisionRoles,
      isActive: true,
    });
  }

  return { success: true, profile };
};

/**
 * 5. Record unverified recovery-drill observations (no restore is executed)
 */
export const executeDisasterRecoveryDrill = async ({
  hospitalId,
  drillType,
  measuredRpoMinutes,
  measuredRtoMinutes,
  recordsIntegrityVerified,
  conductedBy,
  auditNotes = "",
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.executeDisasterRecoveryDrill) {
    return testDouble.executeDisasterRecoveryDrill({
      hospitalId,
      drillType,
      measuredRpoMinutes,
      measuredRtoMinutes,
      recordsIntegrityVerified,
      conductedBy,
      auditNotes,
      actor,
    });
  }

  const validTypes = ["cold_standby_restore", "oplog_replay_check", "failover_simulation"];
  if (!validTypes.includes(drillType)) {
    throw accessError(400, `Invalid DR drill type: '${drillType}'. Allowed: [${validTypes.join(", ")}]`);
  }

  const rpo = Number(measuredRpoMinutes);
  const rto = Number(measuredRtoMinutes);
  if (typeof measuredRpoMinutes !== "number" || typeof measuredRtoMinutes !== "number" || !Number.isFinite(rpo) || rpo < 0 || !Number.isFinite(rto) || rto < 0) {
    throw accessError(400, "Valid non-negative RPO and RTO in minutes are required");
  }
  if (!conductedBy || !String(conductedBy).trim()) {
    throw accessError(400, "DR drill conductor name/role is required");
  }

  if (typeof recordsIntegrityVerified !== "boolean") throw accessError(400,"Integrity declaration must be a boolean");
  // This method records caller-supplied observations. It does not execute a
  // restore or cryptographically validate it, and cannot certify any target.
  const rpoTargetMet = false, rtoTargetMet = false;

  const drillId =
    "DR-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const audit = await DisasterRecoveryAudit.create({
    hospitalId,
    drillId,
    drillDate: new Date(),
    drillType,
    measuredRpoMinutes: rpo,
    measuredRtoMinutes: rto,
    rpoTargetMet,
    rtoTargetMet,
    recordsIntegrityVerified: false,
    reportedIntegrityVerified: recordsIntegrityVerified,
    evidenceStatus: "self_reported",
    conductedBy: String(conductedBy).trim(),
    status: "recorded_unverified",
    auditNotes: String(auditNotes).trim(),
  });

  return {
    success: true,
    audit,
    metrics: {
      measuredRpoMinutes: rpo,
      rpoTargetMet,
      measuredRtoMinutes: rto,
      rtoTargetMet,
      recordsIntegrityVerified: false,
      reportedIntegrityVerified: recordsIntegrityVerified,
      evidenceStatus: "self_reported",
      overallStatus: audit.status,
    },
  };
};

/**
 * 6. Enterprise Acceptance Report Generation
 */
export const generateEnterpriseAcceptanceReport = async ({ hospitalId }) => {
  assertDbConnected();
  if (testDouble?.generateEnterpriseAcceptanceReport) {
    return testDouble.generateEnterpriseAcceptanceReport({ hospitalId });
  }

  const contracts = await ExternalInterfaceContract.find({ hospitalId }).lean();
  const drAudits = await DisasterRecoveryAudit.find({ hospitalId, status: "passed" }).sort({ createdAt: -1 }).limit(1).lean();
  const ssoProfile = await EnterpriseSsoProfile.findOne({ hospitalId, isActive: true }).lean();

  return {
    hospitalId,
    generatedAt: new Date().toISOString(),
    milestones: {
      M1_INPATIENT_ADT: { verified: false, status: "prototype_only", taskId: "AG18" },
      M2_NURSING_EMAR: { verified: false, status: "prototype_only", taskId: "AG19" },
      M3_EMERGENCY_OT: { verified: false, status: "prototype_only", taskId: "AG20" },
      M4_REVENUE_PROCUREMENT: { verified: false, status: "prototype_only", taskId: "AG21" },
      M5_INTERFACES_DR: {
        verified: false,
        status: "prototype_only",
        taskId: "AG22",
        contractsRecorded: contracts.length,
        ssoConfigured: Boolean(ssoProfile),
        legacyDrillRecord: drAudits[0] || null,
      },
    },
    operatingAcceptance: {
      outpatientPilotPreserved: false,
      enterpriseBoundariesEnforced: false,
      unsupportedClaimsAbsent: false,
      status: "not_accepted",
      missingEvidence: ["Authenticated enterprise routes and UI", "Real workflow integration tests", "Observed restore and integrity verification", "Hospital acceptance"],
      disclaimer:
        "Truthful enterprise capability baseline. Real third-party analyzers, external PACS servers, corporate identity providers, and government ABDM gateway connectors require their own site-specific production network deployments and director sign-offs.",
    },
  };
};

export default {
  registerExternalInterfaceContract,
  processInboundLisMessage,
  replayFailedLisMessage,
  registerDicomStudy,
  configureEnterpriseSso,
  executeDisasterRecoveryDrill,
  generateEnterpriseAcceptanceReport,
};
