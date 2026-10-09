import asyncHandler from "../middleware/asyncHandler.js";
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

communityRouter.get("/", userValidation, asyncHandler(getAllCommunities));
communityRouter.post("/create", userValidation, asyncHandler(createCommunity));
communityRouter.get("/user", userValidation, asyncHandler(getAllUserCommunities));
communityRouter.post("/join", userValidation, asyncHandler(joinCommunity));
communityRouter.post("/leave", userValidation, asyncHandler(leaveCommunity));
communityRouter.get("/:id", userValidation, asyncHandler(getAllMessages));

export default communityRouter;
