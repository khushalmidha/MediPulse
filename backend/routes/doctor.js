import asyncHandler from "../middleware/asyncHandler.js";
import { Router } from "express";
import {
  logout,
  doctorSignup,
  doctorLogin,
  googleAuth,
  resetPasswordWithOtp,
  sendPasswordResetOtp,
} from "../controller/auth.js";
import { getDoctorById, getAllDoctors, deleteDoctorById, getDoctorHospitals, updateDoctorData } from "../controller/doctor.js";
import userValidation from "../middleware/validateUser.js";

const doctorRouter = Router();

doctorRouter.post("/logout", asyncHandler(logout));
doctorRouter.post("/signup", asyncHandler(doctorSignup));
doctorRouter.post("/login", asyncHandler(doctorLogin));
doctorRouter.post("/google-auth", asyncHandler(googleAuth));
doctorRouter.post("/forgot-password/send-otp", asyncHandler(sendPasswordResetOtp));
doctorRouter.post("/forgot-password/reset", asyncHandler(resetPasswordWithOtp));

doctorRouter.get("/:id/hospitals", asyncHandler(getDoctorHospitals));
doctorRouter.get("/:id", asyncHandler(getDoctorById));
doctorRouter.delete("/:id", userValidation, asyncHandler(deleteDoctorById));
doctorRouter.get("/", asyncHandler(getAllDoctors));
doctorRouter.put("/", userValidation, asyncHandler(updateDoctorData));

export default doctorRouter;
