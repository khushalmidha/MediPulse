import { Router } from "express";
import userValidation from "../middleware/validateUser.js";
import { rejectUnsafeBodyKeys } from "../middleware/rejectUnsafeKeys.js";
import { createEvent, getEvents } from "../controller/event.js";

const eventRouter = Router();

eventRouter.use(rejectUnsafeBodyKeys);

eventRouter.get("/", userValidation, getEvents);
eventRouter.post("/", userValidation, createEvent);

export default eventRouter;
