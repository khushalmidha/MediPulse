import asyncHandler from "../middleware/asyncHandler.js";
import { Router } from "express";
import userValidation from "../middleware/validateUser.js";
import { createEvent, getEvents } from "../controller/event.js";

const eventRouter = Router();

eventRouter.get("/", userValidation, asyncHandler(getEvents));
eventRouter.post("/", userValidation, asyncHandler(createEvent));

export default eventRouter;
