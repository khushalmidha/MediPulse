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
  leaveCommunity,
  postAnnouncement,
  getAnnouncements,
  reportMessage,
  moderateMessage,
  updatePreferences,
} from "../controller/community.js";

const communityRouter = Router();
communityRouter.use(nosqlGuard);

communityRouter.get("/", userValidation, asyncHandler(getAllCommunities));
communityRouter.post("/create", userValidation, asyncHandler(createCommunity));
communityRouter.get("/user", userValidation, asyncHandler(getAllUserCommunities));
communityRouter.post("/join", userValidation, asyncHandler(joinCommunity));
communityRouter.post("/leave", userValidation, asyncHandler(leaveCommunity));

communityRouter.post("/:id/announcements", userValidation, asyncHandler(postAnnouncement));
communityRouter.get("/:id/announcements", userValidation, asyncHandler(getAnnouncements));
communityRouter.post("/:id/messages/:messageId/report", userValidation, asyncHandler(reportMessage));
communityRouter.delete("/:id/messages/:messageId", userValidation, asyncHandler(moderateMessage));
communityRouter.put("/:id/preferences", userValidation, asyncHandler(updatePreferences));
communityRouter.get("/:id", userValidation, asyncHandler(getAllMessages));

export default communityRouter;
