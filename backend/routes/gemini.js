import { Router } from "express";
import { geminiChat } from "../controller/gemini.js";

const geminiRouter = Router();

geminiRouter.post("/chat", geminiChat);

export default geminiRouter;
