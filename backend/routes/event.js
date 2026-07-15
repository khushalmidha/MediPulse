import { Router } from "express";
import userValidation from "../middleware/validateUser.js";
import { createEvent, getEvents } from "../controller/event.js";

const eventRouter = Router();

eventRouter.get("/", userValidation, getEvents);
eventRouter.post("/", userValidation, createEvent);

export default eventRouter;
