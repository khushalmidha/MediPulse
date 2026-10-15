import { Router } from "express";
import {
  getLabCatalog,
  createLabCatalogItem,
  postCreateLabOrder,
  listLabOrders,
  getLabOrderById,
  patchClearBilling,
  patchCollectSample,
  patchRejectSample,
  postEnterLabResults,
  patchVerifyLabResults,
  patchReleaseLabResults,
  postCorrectLabReport,
  postAcknowledgeCritical,
  getPatientLabResults,
  getLabCapabilities,
  postLabReviewerApproval,
  getLabReviewers,
} from "../controller/lab.js";
import validateStaff, { requireRole } from "../middleware/validateStaff.js";
import userValidation from "../middleware/validateUser.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";

const labRouter = Router();
labRouter.use(nosqlGuard);

// Catalog
labRouter.get("/capabilities", validateStaff, getLabCapabilities);
labRouter.get("/reviewers", validateStaff, requireRole("HOSPITAL_ADMIN"), getLabReviewers);
labRouter.post("/reviewers/:staffId/approval", validateStaff, requireRole("HOSPITAL_ADMIN"), postLabReviewerApproval);
labRouter.get("/catalog", validateStaff, getLabCatalog);
labRouter.post("/catalog", validateStaff, requireRole("LAB_TECH", "HOSPITAL_ADMIN"), createLabCatalogItem);

// Patient access to their released results
labRouter.get("/patient-results", userValidation, getPatientLabResults);

// Orders workflow
labRouter.get("/orders", validateStaff, listLabOrders);
labRouter.post("/orders", validateStaff, requireRole("DOCTOR"), postCreateLabOrder);
labRouter.get("/orders/:id", validateStaff, getLabOrderById);
labRouter.patch("/orders/:id/billing", validateStaff, requireRole("RECEPTIONIST", "HOSPITAL_ADMIN"), patchClearBilling);
labRouter.patch("/orders/:id/collect", validateStaff, requireRole("NURSE", "LAB_TECH"), patchCollectSample);
labRouter.patch("/orders/:id/reject", validateStaff, requireRole("LAB_TECH"), patchRejectSample);
labRouter.post("/orders/:id/results", validateStaff, requireRole("LAB_TECH"), postEnterLabResults);
labRouter.patch("/orders/:id/verify", validateStaff, requireRole("DOCTOR", "LAB_TECH"), patchVerifyLabResults);
labRouter.patch("/orders/:id/release", validateStaff, requireRole("DOCTOR", "LAB_TECH"), patchReleaseLabResults);
labRouter.post("/orders/:id/correct", validateStaff, requireRole("DOCTOR", "LAB_TECH"), postCorrectLabReport);
labRouter.post("/orders/:id/acknowledge-critical", validateStaff, requireRole("DOCTOR"), postAcknowledgeCritical);

export default labRouter;
