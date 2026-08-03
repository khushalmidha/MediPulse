import { Router } from "express";
import {
  generateBedForecast,
  generateBloodForecast,
  getBedForecast,
  getBloodForecast,
} from "../controller/forecast.js";
import validateStaff, { requireRole } from "../middleware/validateStaff.js";

const forecastRouter = Router();

forecastRouter.get("/beds/:hospitalId", validateStaff, requireRole("HOSPITAL_ADMIN", "DEPARTMENT_HEAD"), getBedForecast);
forecastRouter.post("/beds/:hospitalId/generate", validateStaff, requireRole("HOSPITAL_ADMIN", "DEPARTMENT_HEAD"), generateBedForecast);
forecastRouter.get("/blood/:hospitalId", validateStaff, requireRole("HOSPITAL_ADMIN", "DEPARTMENT_HEAD"), getBloodForecast);
forecastRouter.post("/blood/:hospitalId/generate", validateStaff, requireRole("HOSPITAL_ADMIN", "DEPARTMENT_HEAD"), generateBloodForecast);

export default forecastRouter;
