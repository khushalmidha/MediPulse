import { Router } from "express";
import {
  acceptStaffInvite,
  addDepartment,
  getAllHospitals,
  getAnalytics,
  getHospitalAdminProfile,
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
  verifyHospitalFromEmail,
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
hospitalRouter.get("/admin/all", userValidation, requirePlatformAdmin, getAllHospitals);
hospitalRouter.get("/admin/:id/action", verifyHospitalFromEmail);
hospitalRouter.patch("/admin/:id/verify", userValidation, requirePlatformAdmin, verifyHospital);
hospitalRouter.get("/admin/platform-stats", userValidation, requirePlatformAdmin, getPlatformStats);

hospitalRouter.post("/register", registerHospital);
hospitalRouter.patch("/:id/profile", validateStaff, updateHospitalProfile);
hospitalRouter.post("/:id/departments", validateStaff, addDepartment);
hospitalRouter.patch("/:id/departments/:deptId", validateStaff, updateDepartment);
hospitalRouter.post("/:id/staff/invite", validateStaff, inviteStaff);
hospitalRouter.get("/:id/staff/invite/accept", acceptStaffInvite);
hospitalRouter.get("/:id/staff", validateStaff, getStaff);
hospitalRouter.get("/:id/analytics", validateStaff, getAnalytics);
hospitalRouter.get("/:id/admin-profile", validateStaff, getHospitalAdminProfile);
hospitalRouter.post("/:id/website/custom-domain", validateStaff, addCustomDomain);
hospitalRouter.post("/:id/website/verify-domain", validateStaff, verifyCustomDomain);
hospitalRouter.delete("/:id/website/custom-domain", validateStaff, removeCustomDomain);

hospitalRouter.get("/:slug", getHospitalProfile);
hospitalRouter.get("/:slug/doctors", getHospitalDoctors);
hospitalRouter.get("/:slug/queue-status", getHospitalQueueStatus);

export default hospitalRouter;
