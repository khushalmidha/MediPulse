import mongoose from "mongoose";
import { requireCommunityAccess, isCommunityOrganizer, communitySummary } from "../services/communityAccess.js";
import { isRecordId } from "../services/hospitalAccess.js";
import Community from "../model/community.js";
import Message from "../model/message.js";
import User from "../model/user.js";
import Doctor from "../model/doctor.js";

const sanitizeMessage = (msg, isOrganizer) => {
	const doc = msg.toObject ? msg.toObject() : { ...msg };
	if (!isOrganizer) {
		delete doc.reports;
		delete doc.originalContent;
		delete doc.moderatedBy;
		delete doc.moderatedAt;
	}
	return doc;
};

const getAllMessages = async (req, res) => {
	const community = await requireCommunityAccess(req.params.id, req.auth);
	const isOrganizer = isCommunityOrganizer(community, req.auth);
	const query = { community: community._id };
	if (!isOrganizer) {
		query.isRemoved = { $ne: true };
	}
	const page = req.query.page ? Math.max(1, Number(req.query.page) || 1) : null;
	const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

	if (page) {
		const [totalMessages, messages] = await Promise.all([
			Message.countDocuments(query),
			Message.find(query)
				.sort({ createdAt: 1 })
				.skip((page - 1) * limit)
				.limit(limit)
		]);
		return res.json({
			messages: messages.map((m) => sanitizeMessage(m, isOrganizer)),
			pagination: {
				page,
				limit,
				totalMessages,
				totalPages: Math.ceil(totalMessages / limit) || 1,
			}
		});
	}

	const defaultLimit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
	const messages = await Message.find(query).sort({ createdAt: 1 }).limit(defaultLimit);
	return res.json(messages.map((m) => sanitizeMessage(m, isOrganizer)));
};

const getAllCommunities = async (_, res) => {
	const communities = await Community.find({});
	return res.json(communities.map(communitySummary));
};

const getAllUserCommunities = async (req, res) => {
	if (!req.auth) return res.status(401).json({ message: "Unauthorized" });

	const communities = await Community.find({ $or: [
		{ members: req.auth.id }, ...(req.auth.role === "doctor" ? [{ author: req.auth.id }] : []),
	] });
	return res.json(communities.map(communitySummary));
};

const getAllDoctorCommunities = async (req, res) => {
	try {
		const { id } = req.body;
		const doctor = await Doctor.findById(id);
		if (!doctor) {
			return res.status(400).json({ message: "Doctor does not exist" });
		}
		const communities = await Community.find({ author: id });
		return res.status(200).json(communities.map(communitySummary));
	} catch (err) {
		return res.status(500).json({ message: err.message });
	}
}

const joinCommunity = async (req, res) => {
	const { id } = req.body;
	if (!isRecordId(id)) return res.status(400).json({ message: "Valid community id is required" });
	const Model = req.auth.role === "doctor" ? Doctor : User;
	const session = await mongoose.startSession();
	try {
		await session.withTransaction(async () => {
			const community = await Community.findById(id).session(session);
			if (!community) throw Object.assign(new Error("Community not found"), { status: 404 });
			await Community.updateOne({ _id: id }, { $addToSet: { members: req.auth.id } }, { session });
			await Model.updateOne({ _id: req.auth.id }, { $addToSet: { communities: id } }, { session });
		});
	} finally { await session.endSession(); }
	return res.json(await Model.findById(req.auth.id));
};

const createCommunity = async (req, res) => {
	if (req.auth?.role !== "doctor") return res.status(403).json({ message: "Doctor organizer required" });
	const { bio, title, category } = req.body;
	if (typeof title !== "string" || !title.trim() || title.length > 120 || typeof bio !== "string" || !bio.trim() || bio.length > 2000)
		return res.status(400).json({ message: "Community title and bio are required (maximum 120/2000 characters)" });
	const session = await mongoose.startSession();
	let community;
	try {
		await session.withTransaction(async () => {
			[community] = await Community.create([{ title: title.trim(), author: req.auth.id, bio: bio.trim(), category, members: [req.auth.id] }], { session });
			await Doctor.updateOne({ _id: req.auth.id }, { $addToSet: { communities: community._id } }, { session });
		});
	} finally { await session.endSession(); }
	return res.status(201).json({ message: "Community Created", community: communitySummary(community) });
};

const leaveCommunity = async (req, res) => {
	const { id } = req.body;
	if (!isRecordId(id)) return res.status(400).json({ message: "Valid community id is required" });
	const Model = req.auth.role === "doctor" ? Doctor : User;
	const session = await mongoose.startSession();
	try {
		await session.withTransaction(async () => {
			const community = await Community.findById(id).session(session);
			if (!community) throw Object.assign(new Error("Community not found"), { status: 404 });
			if (isCommunityOrganizer(community, req.auth)) throw Object.assign(new Error("Organizer cannot leave their community"), { status: 409 });
			await Community.updateOne({ _id: id }, { $pull: { members: req.auth.id } }, { session });
			await Model.updateOne({ _id: req.auth.id }, { $pull: { communities: id } }, { session });
		});
	} finally { await session.endSession(); }
	return res.json({ message: "Successfully left community", user: await Model.findById(req.auth.id), community: communitySummary(await Community.findById(id)) });
};

const postAnnouncement = async (req, res) => {
	const community = await requireCommunityAccess(req.params.id, req.auth);
	if (!isCommunityOrganizer(community, req.auth)) {
		return res.status(403).json({ message: "Only the doctor organizer can post announcements" });
	}
	const { title, content } = req.body;
	if (typeof title !== "string" || !title.trim() || typeof content !== "string" || !content.trim()) {
		return res.status(400).json({ message: "Announcement title and content are required" });
	}
	const session = await mongoose.startSession();
	let announcementDoc;
	try {
		await session.withTransaction(async () => {
			announcementDoc = {
				title: title.trim(),
				content: content.trim(),
				author: req.auth.id,
				createdAt: new Date(),
			};
			await Community.updateOne(
				{ _id: community._id },
				{ $push: { announcements: announcementDoc }, $inc: { activityRevision: 1 } },
				{ session }
			);
			await Message.create([{
				community: community._id,
				author: req.auth.id,
				author_name: `Dr. Announcement: ${title.trim()}`,
				content: content.trim(),
				isAnnouncement: true,
			}], { session });
		});
	} finally {
		await session.endSession();
	}
	return res.status(201).json({ message: "Announcement published", announcement: announcementDoc });
};

const getAnnouncements = async (req, res) => {
	const community = await requireCommunityAccess(req.params.id, req.auth);
	return res.json(community.announcements || []);
};

const reportMessage = async (req, res) => {
	const community = await requireCommunityAccess(req.params.id, req.auth);
	const { messageId } = req.params;
	const { reason } = req.body;
	if (typeof reason !== "string" || !reason.trim()) {
		return res.status(400).json({ message: "A valid reporting reason is required" });
	}
	const message = await Message.findOne({ _id: messageId, community: community._id });
	if (!message) return res.status(404).json({ message: "Message not found" });

	const alreadyReported = message.reports?.some((r) => String(r.reportedBy) === String(req.auth.id));
	if (alreadyReported) {
		return res.json({ message: "Message already reported for doctor review" });
	}

	await Message.updateOne(
		{ _id: messageId },
		{ $push: { reports: { reportedBy: req.auth.id, reason: reason.trim(), reportedAt: new Date() } } }
	);
	return res.json({ message: "Message reported for doctor review" });
};

const moderateMessage = async (req, res) => {
	const community = await requireCommunityAccess(req.params.id, req.auth);
	if (!isCommunityOrganizer(community, req.auth)) {
		return res.status(403).json({ message: "Only the doctor organizer can moderate messages" });
	}
	const { messageId } = req.params;
	const message = await Message.findOne({ _id: messageId, community: community._id });
	if (!message) return res.status(404).json({ message: "Message not found" });

	await Message.updateOne(
		{ _id: messageId },
		{
			$set: {
				isRemoved: true,
				originalContent: message.content,
				moderatedBy: req.auth.id,
				moderatedAt: new Date(),
				content: "[This message was removed by the doctor moderator]"
			}
		}
	);
	return res.json({ message: "Message removed by moderator" });
};

const updatePreferences = async (req, res) => {
	const community = await requireCommunityAccess(req.params.id, req.auth);
	const { emailNotifications, inAppNotifications } = req.body;
	const memberId = req.auth.id;

	const hasPref = (community.memberPreferences || []).some(
		(p) => String(p.memberId) === String(memberId)
	);

	if (hasPref) {
		await Community.updateOne(
			{ _id: community._id, "memberPreferences.memberId": memberId },
			{
				$set: {
					"memberPreferences.$.emailNotifications": Boolean(emailNotifications),
					"memberPreferences.$.inAppNotifications": Boolean(inAppNotifications),
				},
			}
		);
	} else {
		await Community.updateOne(
			{ _id: community._id },
			{
				$push: {
					memberPreferences: {
						memberId,
						emailNotifications: Boolean(emailNotifications),
						inAppNotifications: Boolean(inAppNotifications),
					},
				},
			}
		);
	}

	return res.json({ message: "Notification preferences updated" });
};

export {
	getAllMessages,
	getAllCommunities,
	createCommunity,
	getAllUserCommunities,
	joinCommunity,
	leaveCommunity,
	getAllDoctorCommunities,
	postAnnouncement,
	getAnnouncements,
	reportMessage,
	moderateMessage,
	updatePreferences,
};
