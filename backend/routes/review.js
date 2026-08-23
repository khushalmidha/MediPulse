import express from "express";
import { flagReview, getHospitalReviews, respondToReview, submitReview, getGlobalReviews, getPendingReview, submitPlatformFeedback, getHomepageFeedbacks } from "../controller/review.js";
import validateStaff, { requireRole } from "../middleware/validateStaff.js";
import userValidation from "../middleware/validateUser.js";

const reviewRouter = express.Router();

reviewRouter.post("/", userValidation, submitReview);
reviewRouter.get("/hospital/:hospitalId", getHospitalReviews);
reviewRouter.post("/:id/respond", validateStaff, requireRole("HOSPITAL_ADMIN"), respondToReview);
reviewRouter.post("/:id/flag", userValidation, flagReview);

reviewRouter.get('/global', getGlobalReviews);
reviewRouter.get('/pending', userValidation, getPendingReview);

// Platform Feedback Routes
reviewRouter.post('/platform', userValidation, submitPlatformFeedback);
reviewRouter.get('/platform/homepage', getHomepageFeedbacks);
export default reviewRouter;

