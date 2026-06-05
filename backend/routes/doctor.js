import { Router } from "express";
import {
  doctorSignup,
  doctorLogin,
  googleAuth,
  resetPasswordWithOtp,
  sendPasswordResetOtp,
} from "../controller/auth.js";
import { getDoctorById, getAllDoctors, deleteDoctorById } from "../controller/doctor.js";
import userValidation from "../middleware/validateUser.js";

const doctorRouter = Router();

doctorRouter.post("/signup", doctorSignup);
doctorRouter.post("/login", doctorLogin);
doctorRouter.post("/google-auth", googleAuth);
doctorRouter.post("/forgot-password/send-otp", sendPasswordResetOtp);
doctorRouter.post("/forgot-password/reset", resetPasswordWithOtp);

doctorRouter.get("/:id", getDoctorById);
doctorRouter.delete("/:id", userValidation, deleteDoctorById);
doctorRouter.get("/", getAllDoctors);


export default doctorRouter;
