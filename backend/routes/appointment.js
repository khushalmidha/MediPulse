import { getCallCredentials } from "../services/turnCredentials.js";
import { Router } from "express";
import {
  bookAppointment,
  endAppointment,
  getAppointmentById,
  getDoctorPendingStatus,
  getDoctorQueue,
  getUserAppointmentHistory,
  generateAppointmentReceipt,
  refundAppointmentPayment,
  sendAppointmentOtp,
  startAppointment,
  updateDoctorNotes,
  askDoctorAppointmentCopilot,
  verifyAppointmentOtp,


} from "../controller/appointment.js";
import userValidation from "../middleware/validateUser.js";

const appointmentRouter = Router();
const asyncRoute = (handler) => async (req, res) => {
  try { await handler(req, res); }
  catch (error) { if (!res.headersSent) res.status(error.status || 500).json({ message: error.status ? error.message : "Appointment service failed", ...(error.compensationStatus ? { compensationStatus: error.compensationStatus } : {}) }); }
};

appointmentRouter.post("/otp/send/:doctorId", userValidation, asyncRoute(sendAppointmentOtp));
appointmentRouter.post("/otp/verify/:doctorId", userValidation, asyncRoute(verifyAppointmentOtp));
appointmentRouter.post("/book/:doctorId", userValidation, asyncRoute(bookAppointment));
appointmentRouter.get("/doctor/queue", userValidation, asyncRoute(getDoctorQueue));
appointmentRouter.get("/history", userValidation, asyncRoute(getUserAppointmentHistory));




appointmentRouter.get(
  "/doctor/:doctorId/pending",
  userValidation,
  asyncRoute(getDoctorPendingStatus),
);
appointmentRouter.get("/:appointmentId/call-credentials", userValidation, asyncRoute(getCallCredentials));
appointmentRouter.get("/:appointmentId", userValidation, asyncRoute(getAppointmentById));
appointmentRouter.patch("/:appointmentId/notes", userValidation, asyncRoute(updateDoctorNotes));
appointmentRouter.post("/:appointmentId/receipt", userValidation, asyncRoute(generateAppointmentReceipt));
appointmentRouter.post("/:appointmentId/refund", userValidation, asyncRoute(refundAppointmentPayment));
appointmentRouter.post("/:appointmentId/start", userValidation, asyncRoute(startAppointment));
appointmentRouter.post("/:appointmentId/end", userValidation, asyncRoute(endAppointment));

appointmentRouter.post("/:appointmentId/copilot", userValidation, asyncRoute(askDoctorAppointmentCopilot));
export default appointmentRouter;

