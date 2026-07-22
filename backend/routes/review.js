import express from "express";
import { flagReview, getHospitalReviews, respondToReview, submitReview } from "../controller/review.js";
import validateStaff, { requireRole } from "../middleware/validateStaff.js";
import userValidation from "../middleware/validateUser.js";

const reviewRouter = express.Router();

reviewRouter.post("/", userValidation, submitReview);
reviewRouter.get("/hospital/:hospitalId", getHospitalReviews);
reviewRouter.post("/:id/respond", validateStaff, requireRole("HOSPITAL_ADMIN"), respondToReview);
reviewRouter.post("/:id/flag", userValidation, flagReview);

export default reviewRouter;
