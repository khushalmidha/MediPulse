import asyncHandler from "../middleware/asyncHandler.js";
import { Router } from "express";
import userValidation from "../middleware/validateUser.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";
import {
	createCommunity,
	getAllCommunities,
	getAllMessages,
	getCommunityMembers,
	getCommunityReports,
	getAllUserCommunities,
	joinCommunity,
	leaveCommunity,
	postAnnouncement,
	getAnnouncements,
	reportMessage,
	moderateMessage,
	dismissReports,
	getPreferences,
	updatePreferences,
} from "../controller/community.js";

const communityRouter = Router();
communityRouter.use(nosqlGuard);

communityRouter.get("/", userValidation, asyncHandler(getAllCommunities));
communityRouter.post("/create", userValidation, asyncHandler(createCommunity));
communityRouter.get("/user", userValidation, asyncHandler(getAllUserCommunities));
communityRouter.post("/join", userValidation, asyncHandler(joinCommunity));
communityRouter.post("/leave", userValidation, asyncHandler(leaveCommunity));

communityRouter.get("/:id/members", userValidation, asyncHandler(getCommunityMembers));
communityRouter.get("/:id/reports", userValidation, asyncHandler(getCommunityReports));
communityRouter.post("/:id/messages/:messageId/dismiss", userValidation, asyncHandler(dismissReports));
communityRouter.get("/:id/preferences", userValidation, asyncHandler(getPreferences));
communityRouter.put("/:id/preferences", userValidation, asyncHandler(updatePreferences));

communityRouter.post("/:id/announcements", userValidation, asyncHandler(postAnnouncement));
communityRouter.get("/:id/announcements", userValidation, asyncHandler(getAnnouncements));
communityRouter.post("/:id/messages/:messageId/report", userValidation, asyncHandler(reportMessage));
communityRouter.delete("/:id/messages/:messageId", userValidation, asyncHandler(moderateMessage));
communityRouter.get("/:id", userValidation, asyncHandler(getAllMessages));

export default communityRouter;
