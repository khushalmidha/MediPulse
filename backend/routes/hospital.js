import { resolveHospitalHost } from "../services/productHosts.js";
import asyncRoute from "../middleware/asyncHandler.js";
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
  resendStaffInvite,
  requestStaffRemovalOtp,
  confirmStaffRemoval,
  grantStaffAdminAccess,
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
import {
  getLocations,
  createLocation,
  updateLocation,
} from "../controller/encounterJourney.js";
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
hospitalRouter.post("/:id/staff/:staffId/invite/resend", validateStaff, resendStaffInvite);
hospitalRouter.post("/:id/staff/:staffId/remove/request-otp", validateStaff, requestStaffRemovalOtp);
hospitalRouter.patch("/:id/staff/:staffId/admin-access", validateStaff, grantStaffAdminAccess);
hospitalRouter.delete("/:id/staff/:staffId", validateStaff, confirmStaffRemoval);
hospitalRouter.get("/:id/staff/invite/accept", acceptStaffInvite);
hospitalRouter.get("/:id/staff", validateStaff, getStaff);
hospitalRouter.get("/:id/analytics", validateStaff, getAnalytics);
hospitalRouter.get("/:id/admin-profile", validateStaff, getHospitalAdminProfile);
hospitalRouter.post("/:id/website/custom-domain", validateStaff, addCustomDomain);
hospitalRouter.post("/:id/website/verify-domain", validateStaff, verifyCustomDomain);
hospitalRouter.delete("/:id/website/custom-domain", validateStaff, removeCustomDomain);

hospitalRouter.get("/:id/locations", validateStaff, getLocations);
hospitalRouter.post("/:id/locations", validateStaff, createLocation);
hospitalRouter.patch("/:id/locations/:locationId", validateStaff, updateLocation);

hospitalRouter.get("/resolve-host", asyncRoute(resolveHospitalHost));
hospitalRouter.get("/:slug", getHospitalProfile);
hospitalRouter.get("/:slug/doctors", getHospitalDoctors);
hospitalRouter.get("/:slug/queue-status", getHospitalQueueStatus);
hospitalRouter.get("/:id/kiosk-display", asyncRoute(async (req, res) => {
  const { getHospitalKioskStatus } = await import("../services/queueTrackingService.js");
  const kiosk = await getHospitalKioskStatus(req.params.id);
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.json({ kiosk });
}));

hospitalRouter.get("/staff/setup/verify/:token", asyncRoute(async (req, res) => {
  const { verifyAdminSetupLink } = await import("../services/saasOperationsService.js");
  const verification = await verifyAdminSetupLink(req.params.token);
  return res.json({ message: "Setup link is valid", hospital: verification.hospital });
}));
hospitalRouter.post("/staff/setup/consume", asyncRoute(async (req, res) => {
  const { postConsumeSetupLink } = await import("../controller/saasOperations.js");
  return postConsumeSetupLink(req, res);
}));

export default hospitalRouter;
