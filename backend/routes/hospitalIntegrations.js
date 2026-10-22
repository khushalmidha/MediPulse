import { Router } from "express";
import validateStaff, { requireRole } from "../middleware/validateStaff.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";
import {
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
} from "../controller/hospitalIntegrations.js";

const hospitalIntegrationsRouter = Router();
hospitalIntegrationsRouter.use(nosqlGuard);

// 1. External Interface Contracts
hospitalIntegrationsRouter.post(
  "/contracts",
  validateStaff,
  requireRole("HOSPITAL_ADMIN"),
  registerExternalInterfaceContractHandler
);
hospitalIntegrationsRouter.get(
  "/contracts",
  validateStaff,
  requireRole("HOSPITAL_ADMIN"),
  getExternalInterfaceContractsHandler
);

// 2. LIS Message Exchange & Replay
hospitalIntegrationsRouter.post(
  "/lis/inbound",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "LAB_TECH", "DOCTOR"),
  processInboundLisMessageHandler
);
hospitalIntegrationsRouter.get(
  "/lis/logs",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "LAB_TECH", "DOCTOR"),
  getLisMessageLogsHandler
);
hospitalIntegrationsRouter.post(
  "/lis/logs/:messageControlId/replay",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "LAB_TECH"),
  replayFailedLisMessageHandler
);

// 3. PACS / DICOM Study Metadata
hospitalIntegrationsRouter.post(
  "/pacs/studies",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "DOCTOR", "LAB_TECH"),
  registerDicomStudyHandler
);
hospitalIntegrationsRouter.get(
  "/pacs/studies",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "DOCTOR", "LAB_TECH", "NURSE"),
  getDicomStudyReferencesHandler
);
hospitalIntegrationsRouter.get(
  "/pacs/studies/:id",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "DOCTOR", "LAB_TECH", "NURSE"),
  getDicomStudyByIdHandler
);

// 4. Enterprise SSO Configuration
hospitalIntegrationsRouter.post(
  "/sso/configure",
  validateStaff,
  requireRole("HOSPITAL_ADMIN"),
  configureEnterpriseSsoHandler
);
hospitalIntegrationsRouter.get(
  "/sso/profile",
  validateStaff,
  requireRole("HOSPITAL_ADMIN"),
  getEnterpriseSsoProfileHandler
);

// 5. Disaster Recovery Drills & Acceptance Report
hospitalIntegrationsRouter.post(
  "/dr/drills",
  validateStaff,
  requireRole("HOSPITAL_ADMIN"),
  executeDisasterRecoveryDrillHandler
);
hospitalIntegrationsRouter.get(
  "/dr/audits",
  validateStaff,
  requireRole("HOSPITAL_ADMIN"),
  getDisasterRecoveryAuditsHandler
);
hospitalIntegrationsRouter.get(
  "/acceptance/report",
  validateStaff,
  requireRole("HOSPITAL_ADMIN"),
  generateEnterpriseAcceptanceReportHandler
);

export default hospitalIntegrationsRouter;
