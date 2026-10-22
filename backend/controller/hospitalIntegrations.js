import asyncHandler from "../middleware/asyncHandler.js";
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
} from "../services/hospitalIntegrationsService.js";

const getHospitalId = (req) => {
  return req.staff?.hospitalId || req.hospitalContext?.hospitalId;
};

const getActor = (req) => {
  return {
    staffId: req.staff?.id,
    role: req.staff?.role,
    name: req.staff?.name,
    email: req.staff?.email,
  };
};

// 1. External Interface Contracts
export const registerExternalInterfaceContractHandler = asyncHandler(async (req, res) => {
  const result = await registerExternalInterfaceContract({
    hospitalId: getHospitalId(req),
    interfaceType: req.body.interfaceType,
    contractVersion: req.body.contractVersion,
    endpointUrl: req.body.endpointUrl,
    downtimeOwnership: req.body.downtimeOwnership,
    authConfig: req.body.authConfig,
    actor: getActor(req),
  });
  res.status(201).json(result);
});

export const getExternalInterfaceContractsHandler = asyncHandler(async (req, res) => {
  const result = await getExternalInterfaceContracts({
    hospitalId: getHospitalId(req),
  });
  res.json(result);
});

// 2. LIS Message Exchange
export const processInboundLisMessageHandler = asyncHandler(async (req, res) => {
  const result = await processInboundLisMessage({
    hospitalId: getHospitalId(req),
    messageControlId: req.body.messageControlId,
    messageType: req.body.messageType,
    accessionNumber: req.body.accessionNumber,
    payload: req.body.payload,
    actor: getActor(req),
  });
  res.status(result.idempotentReplay ? 200 : 201).json(result);
});

export const getLisMessageLogsHandler = asyncHandler(async (req, res) => {
  const result = await getLisMessageLogs({
    hospitalId: getHospitalId(req),
    messageType: req.query.messageType || null,
    status: req.query.status || null,
    limit: req.query.limit,
    page: req.query.page,
  });
  res.json(result);
});

export const replayFailedLisMessageHandler = asyncHandler(async (req, res) => {
  const result = await replayFailedLisMessage({
    hospitalId: getHospitalId(req),
    messageControlId: req.params.messageControlId,
    actor: getActor(req),
  });
  res.json(result);
});

// 3. PACS / DICOM Study Metadata
export const registerDicomStudyHandler = asyncHandler(async (req, res) => {
  const result = await registerDicomStudy({
    hospitalId: getHospitalId(req),
    studyInstanceUid: req.body.studyInstanceUid,
    accessionNumber: req.body.accessionNumber,
    patientId: req.body.patientId,
    modality: req.body.modality,
    studyDescription: req.body.studyDescription,
    seriesCount: req.body.seriesCount,
    instanceCount: req.body.instanceCount,
    wadoRsUri: req.body.wadoRsUri,
    reportSummary: req.body.reportSummary,
    actor: getActor(req),
  });
  res.status(201).json(result);
});

export const getDicomStudyReferencesHandler = asyncHandler(async (req, res) => {
  const result = await getDicomStudyReferences({
    hospitalId: getHospitalId(req),
    patientId: req.query.patientId || null,
    modality: req.query.modality || null,
    search: req.query.search || "",
    limit: req.query.limit,
    page: req.query.page,
  });
  res.json(result);
});

export const getDicomStudyByIdHandler = asyncHandler(async (req, res) => {
  const result = await getDicomStudyById({
    hospitalId: getHospitalId(req),
    studyId: req.params.id,
  });
  res.json(result);
});

// 4. Enterprise SSO Configuration
export const configureEnterpriseSsoHandler = asyncHandler(async (req, res) => {
  const result = await configureEnterpriseSso({
    hospitalId: getHospitalId(req),
    idpType: req.body.idpType,
    entityId: req.body.entityId,
    metadataUrl: req.body.metadataUrl,
    scimEnabled: req.body.scimEnabled,
    autoProvisionRoles: req.body.autoProvisionRoles,
    actor: getActor(req),
  });
  res.json(result);
});

export const getEnterpriseSsoProfileHandler = asyncHandler(async (req, res) => {
  const result = await getEnterpriseSsoProfile({
    hospitalId: getHospitalId(req),
  });
  res.json(result);
});

// 5. Disaster Recovery Drills & Acceptance
export const executeDisasterRecoveryDrillHandler = asyncHandler(async (req, res) => {
  const result = await executeDisasterRecoveryDrill({
    hospitalId: getHospitalId(req),
    drillType: req.body.drillType,
    measuredRpoMinutes: req.body.measuredRpoMinutes,
    measuredRtoMinutes: req.body.measuredRtoMinutes,
    recordsIntegrityVerified: req.body.recordsIntegrityVerified,
    conductedBy: req.body.conductedBy,
    auditNotes: req.body.auditNotes,
    actor: getActor(req),
  });
  res.status(201).json(result);
});

export const getDisasterRecoveryAuditsHandler = asyncHandler(async (req, res) => {
  const result = await getDisasterRecoveryAudits({
    hospitalId: getHospitalId(req),
    limit: req.query.limit,
  });
  res.json(result);
});

export const generateEnterpriseAcceptanceReportHandler = asyncHandler(async (req, res) => {
  const result = await generateEnterpriseAcceptanceReport({
    hospitalId: getHospitalId(req),
  });
  res.json({ success: true, report: result });
});

export default {
  registerExternalInterfaceContractHandler,
  getExternalInterfaceContractsHandler,
  processInboundLisMessageHandler,
  getLisMessageLogsHandler,
  replayFailedLisMessageHandler,
  registerDicomStudyHandler,
  getDicomStudyReferencesHandler,
  getDicomStudyByIdHandler,
  configureEnterpriseSsoHandler,
  getEnterpriseSsoProfileHandler,
  executeDisasterRecoveryDrillHandler,
  getDisasterRecoveryAuditsHandler,
  generateEnterpriseAcceptanceReportHandler,
};
