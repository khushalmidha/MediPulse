import { Router } from "express";
import userValidation from "../middleware/validateUser.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";
import { createMessage } from "../controller/message.js";

const messageRouter = Router();

messageRouter.use(nosqlGuard);
messageRouter.post("/", userValidation, createMessage);

export default messageRouter;
