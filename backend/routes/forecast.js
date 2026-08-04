import express from "express";
import { getBedForecast, getBloodForecast, generateBedForecast, generateBloodForecast } from "../controller/forecast.js";
import { StaffVerifier } from "../controller/auth.js";

const forecastRouter = express.Router();

forecastRouter.get("/beds/:hospitalId", StaffVerifier, getBedForecast);
forecastRouter.get("/blood/:hospitalId", StaffVerifier, getBloodForecast);
forecastRouter.post("/beds/:hospitalId/generate", StaffVerifier, generateBedForecast);
forecastRouter.post("/blood/:hospitalId/generate", StaffVerifier, generateBloodForecast);

export default forecastRouter;
