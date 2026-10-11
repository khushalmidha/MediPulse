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
} from "../controller/lab.js";
import validateStaff, { requireRole } from "../middleware/validateStaff.js";
import userValidation from "../middleware/validateUser.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";

const labRouter = Router();
labRouter.use(nosqlGuard);

// Catalog
labRouter.get("/catalog", validateStaff, getLabCatalog);
labRouter.post("/catalog", validateStaff, requireRole("LAB_SUPERVISOR", "HOSPITAL_ADMIN", "PATHOLOGIST"), createLabCatalogItem);

// Patient access to their released results
labRouter.get("/patient-results", userValidation, getPatientLabResults);

// Orders workflow
labRouter.get("/orders", validateStaff, listLabOrders);
labRouter.post("/orders", validateStaff, requireRole("DOCTOR"), postCreateLabOrder);
labRouter.get("/orders/:id", validateStaff, getLabOrderById);
labRouter.patch("/orders/:id/billing", validateStaff, requireRole("RECEPTIONIST", "HOSPITAL_ADMIN", "BILLING"), patchClearBilling);
labRouter.patch("/orders/:id/collect", validateStaff, requireRole("NURSE", "LAB_TECHNICIAN", "LAB_SUPERVISOR"), patchCollectSample);
labRouter.patch("/orders/:id/reject", validateStaff, requireRole("LAB_TECHNICIAN", "LAB_SUPERVISOR", "PATHOLOGIST"), patchRejectSample);
labRouter.post("/orders/:id/results", validateStaff, requireRole("LAB_TECHNICIAN", "LAB_SUPERVISOR", "PATHOLOGIST"), postEnterLabResults);
labRouter.patch("/orders/:id/verify", validateStaff, requireRole("LAB_SUPERVISOR", "PATHOLOGIST"), patchVerifyLabResults);
labRouter.patch("/orders/:id/release", validateStaff, requireRole("LAB_SUPERVISOR", "PATHOLOGIST"), patchReleaseLabResults);
labRouter.post("/orders/:id/correct", validateStaff, requireRole("LAB_SUPERVISOR", "PATHOLOGIST"), postCorrectLabReport);
labRouter.post("/orders/:id/acknowledge-critical", validateStaff, requireRole("DOCTOR"), postAcknowledgeCritical);

export default labRouter;
