import express from "express";
import { getBedForecast, getBloodForecast, generateBedForecast, generateBloodForecast } from "../controller/forecast.js";
import validateStaff from "../middleware/validateStaff.js";

const forecastRouter = express.Router();

forecastRouter.get("/beds/:hospitalId", validateStaff, getBedForecast);
forecastRouter.get("/blood/:hospitalId", validateStaff, getBloodForecast);
forecastRouter.post("/beds/:hospitalId/generate", validateStaff, generateBedForecast);
forecastRouter.post("/blood/:hospitalId/generate", validateStaff, generateBloodForecast);

export default forecastRouter;
