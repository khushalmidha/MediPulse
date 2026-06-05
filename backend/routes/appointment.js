import { Router } from "express";
import {
  bookAppointment,
  createPaymentOrder,
  endAppointment,
  getAppointmentById,
  getDoctorPendingStatus,
  getDoctorQueue,
  getUserAppointmentHistory,
  generateAppointmentReceipt,
  handleEmailAppointmentAction,
  refundAppointmentPayment,
  sendAppointmentOtp,
  startAppointment,
  updateDoctorNotes,
  verifyAppointmentOtp,
  verifyPaymentAndBook,
} from "../controller/appointment.js";
import userValidation from "../middleware/validateUser.js";

const appointmentRouter = Router();

appointmentRouter.post("/otp/send/:doctorId", userValidation, sendAppointmentOtp);
appointmentRouter.post("/otp/verify/:doctorId", userValidation, verifyAppointmentOtp);
appointmentRouter.get("/email-action/:token", handleEmailAppointmentAction);
appointmentRouter.post("/payment/order/:doctorId", userValidation, createPaymentOrder);
appointmentRouter.post("/payment/verify/:doctorId", userValidation, verifyPaymentAndBook);
appointmentRouter.post("/book/:doctorId", userValidation, bookAppointment);
appointmentRouter.get("/doctor/queue", userValidation, getDoctorQueue);
appointmentRouter.get("/history", userValidation, getUserAppointmentHistory);
appointmentRouter.get(
  "/doctor/:doctorId/pending",
  userValidation,
  getDoctorPendingStatus,
);
appointmentRouter.get("/:appointmentId", userValidation, getAppointmentById);
appointmentRouter.patch("/:appointmentId/notes", userValidation, updateDoctorNotes);
appointmentRouter.post("/:appointmentId/receipt", userValidation, generateAppointmentReceipt);
appointmentRouter.post("/:appointmentId/refund", userValidation, refundAppointmentPayment);
appointmentRouter.post("/:appointmentId/start", userValidation, startAppointment);
appointmentRouter.post("/:appointmentId/end", userValidation, endAppointment);

export default appointmentRouter;
