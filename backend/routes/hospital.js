import { Router } from "express";
import {
  acceptStaffInvite,
  addDepartment,
  getAllHospitals,
  getAnalytics,
  getHospitalDoctors,
  getHospitalProfile,
  getHospitalQueueStatus,
  getHospitals,
  getPlatformStats,
  getStaff,
  inviteStaff,
  registerHospital,
  requirePlatformAdmin,
  updateDepartment,
  updateHospitalProfile,
  verifyHospital,
} from "../controller/hospital.js";
import {
  addCustomDomain,
  removeCustomDomain,
  verifyCustomDomain,
} from "../controller/hospitalWebsite.js";
import validateStaff from "../middleware/validateStaff.js";
import userValidation from "../middleware/validateUser.js";

const hospitalRouter = Router();

hospitalRouter.get("/", getHospitals);
hospitalRouter.get("/:slug", getHospitalProfile);
hospitalRouter.get("/:slug/doctors", getHospitalDoctors);
hospitalRouter.get("/:slug/queue-status", getHospitalQueueStatus);

hospitalRouter.post("/register", registerHospital);
hospitalRouter.patch("/:id/profile", validateStaff, updateHospitalProfile);
hospitalRouter.post("/:id/departments", validateStaff, addDepartment);
hospitalRouter.patch("/:id/departments/:deptId", validateStaff, updateDepartment);
hospitalRouter.post("/:id/staff/invite", validateStaff, inviteStaff);
hospitalRouter.get("/:id/staff/invite/accept", acceptStaffInvite);
hospitalRouter.get("/:id/staff", validateStaff, getStaff);
hospitalRouter.get("/:id/analytics", validateStaff, getAnalytics);
hospitalRouter.post("/:id/website/custom-domain", validateStaff, addCustomDomain);
hospitalRouter.post("/:id/website/verify-domain", validateStaff, verifyCustomDomain);
hospitalRouter.delete("/:id/website/custom-domain", validateStaff, removeCustomDomain);

hospitalRouter.get("/admin/all", userValidation, requirePlatformAdmin, getAllHospitals);
hospitalRouter.patch("/admin/:id/verify", userValidation, requirePlatformAdmin, verifyHospital);
hospitalRouter.get("/admin/platform-stats", userValidation, requirePlatformAdmin, getPlatformStats);

export default hospitalRouter;
