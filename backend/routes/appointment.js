import { Router } from "express";
import {
  bookAppointment,
  endAppointment,
  getAppointmentById,
  getDoctorPendingStatus,
  getDoctorQueue,
  startAppointment,
} from "../controller/appointment.js";
import userValidation from "../middleware/validateUser.js";

const appointmentRouter = Router();

appointmentRouter.post("/book/:doctorId", userValidation, bookAppointment);
appointmentRouter.get("/doctor/queue", userValidation, getDoctorQueue);
appointmentRouter.get(
  "/doctor/:doctorId/pending",
  userValidation,
  getDoctorPendingStatus,
);
appointmentRouter.get("/:appointmentId", userValidation, getAppointmentById);
appointmentRouter.post("/:appointmentId/start", userValidation, startAppointment);
appointmentRouter.post("/:appointmentId/end", userValidation, endAppointment);

export default appointmentRouter;
