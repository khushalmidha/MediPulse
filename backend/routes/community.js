import { Router } from "express";
import userValidation from "../middleware/validateUser.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";
import {
	createCommunity,
	getAllCommunities,
	getAllMessages,
  getAllUserCommunities,
  joinCommunity,
  leaveCommunity
} from "../controller/community.js";

const communityRouter = Router();
communityRouter.use(nosqlGuard);

communityRouter.get("/", userValidation, getAllCommunities);
communityRouter.post("/create", userValidation, createCommunity);
communityRouter.get("/user", userValidation, getAllUserCommunities);
communityRouter.post("/join", userValidation, joinCommunity);
communityRouter.post("/leave", userValidation, leaveCommunity);
communityRouter.get("/:id", userValidation, getAllMessages);

export default communityRouter;
