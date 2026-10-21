import mongoose from "mongoose";
import { requireCommunityAccess, isCommunityOrganizer, communitySummary } from "../services/communityAccess.js";
import { isRecordId } from "../services/hospitalAccess.js";
import { enqueueJob } from "../services/outbox.js";
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
		delete doc.reportsDismissed;
		delete doc.dismissedBy;
		delete doc.dismissedAt;
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

const getCommunityMembers = async (req, res) => {
	const community = await requireCommunityAccess(req.params.id, req.auth);
	const page = Math.max(1, Number(req.query.page) || 1);
	const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
	const memberIds = community.members || [];
	const totalMembers = memberIds.length;
	const totalPages = Math.ceil(totalMembers / limit) || 1;
	const slice = memberIds.slice((page - 1) * limit, page * limit);

	const [users, doctors] = await Promise.all([
		User.find({ _id: { $in: slice } }).select("firstName lastName role").lean(),
		Doctor.find({ _id: { $in: slice } }).select("firstName lastName role").lean(),
	]);

	const map = new Map();
	for (const u of users) {
		map.set(String(u._id), {
			_id: u._id,
			name: [u.firstName, u.lastName].filter(Boolean).join(" ") || "Member",
			role: "user",
		});
	}
	for (const d of doctors) {
		const name = [d.firstName, d.lastName].filter(Boolean).join(" ");
		map.set(String(d._id), {
			_id: d._id,
			name: name ? `Dr. ${name}` : "Doctor",
			role: "doctor",
		});
	}

	// Sanitize output - never leak private member preferences or reports
	const members = slice.map(id => map.get(String(id)) || { _id: id, name: "Member", role: "user" });

	return res.json({
		members,
		pagination: {
			page,
			limit,
			totalMembers,
			totalPages,
		}
	});
};

const getCommunityReports = async (req, res) => {
	const community = await requireCommunityAccess(req.params.id, req.auth);
	if (!isCommunityOrganizer(community, req.auth)) {
		return res.status(403).json({ message: "Only the doctor organizer can view moderation reports" });
	}

	const reports = await Message.find({
		community: community._id,
		"reports.0": { $exists: true },
	}).sort({ "reports.reportedAt": -1, createdAt: -1 });

	return res.json({ reports });
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
};

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
				_id: new mongoose.Types.ObjectId(),
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

			// Enqueue durable announcement outbox jobs for each member
			const members = community.members || [];
			for (const memberId of members) {
				const pref = (community.memberPreferences || []).find(p => String(p.memberId) === String(memberId));
				const emailPref = pref ? pref.emailNotifications : true;
				const inAppPref = pref ? pref.inAppNotifications : true;
				if (emailPref || inAppPref) {
					await enqueueJob({
						id: `announcement:${community._id}:${announcementDoc._id}:${memberId}`,
						kind: "community.announcement",
						payload: {
							communityId: String(community._id),
							communityTitle: community.title,
							announcementId: String(announcementDoc._id),
							announcementTitle: title.trim(),
							content: content.trim(),
							memberId: String(memberId),
							authorName: req.auth.name || "Doctor Organizer",
						}
					}, session);
				}
			}
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
	if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 500) {
		return res.status(400).json({ message: "A valid reporting reason is required (1-500 characters)" });
	}
	const message = await Message.findOne({ _id: messageId, community: community._id });
	if (!message) return res.status(404).json({ message: "Message not found" });

	const alreadyReported = message.reports?.some((r) => String(r.reportedBy) === String(req.auth.id));
	if (alreadyReported) {
		return res.status(409).json({ message: "Message has already been reported by you" });
	}

	await Message.updateOne(
		{ _id: messageId },
		{
			$push: { reports: { reportedBy: req.auth.id, reason: reason.trim(), reportedAt: new Date() } },
			$set: { reportsDismissed: false },
		}
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
				originalContent: message.originalContent || message.content,
				moderatedBy: req.auth.id,
				moderatedAt: new Date(),
				content: "[This message was removed by the doctor moderator]"
			}
		}
	);
	return res.json({ message: "Message removed by moderator", messageId });
};

const dismissReports = async (req, res) => {
	const community = await requireCommunityAccess(req.params.id, req.auth);
	if (!isCommunityOrganizer(community, req.auth)) {
		return res.status(403).json({ message: "Only the doctor organizer can dismiss reports" });
	}
	const { messageId } = req.params;
	const message = await Message.findOne({ _id: messageId, community: community._id });
	if (!message) return res.status(404).json({ message: "Message not found" });

	await Message.updateOne(
		{ _id: messageId },
		{
			$set: {
				reportsDismissed: true,
				dismissedBy: req.auth.id,
				dismissedAt: new Date(),
			}
		}
	);
	return res.json({ message: "Reports dismissed for this message", messageId });
};

const getPreferences = async (req, res) => {
	const community = await requireCommunityAccess(req.params.id, req.auth);
	const pref = (community.memberPreferences || []).find(
		(p) => String(p.memberId) === String(req.auth.id)
	);
	return res.json({
		emailNotifications: pref ? pref.emailNotifications : true,
		inAppNotifications: pref ? pref.inAppNotifications : true,
	});
};

const updatePreferences = async (req, res) => {
	const community = await requireCommunityAccess(req.params.id, req.auth);
	const { emailNotifications, inAppNotifications } = req.body || {};

	if (emailNotifications !== undefined && typeof emailNotifications !== "boolean") {
		return res.status(400).json({ message: "emailNotifications must be a boolean" });
	}
	if (inAppNotifications !== undefined && typeof inAppNotifications !== "boolean") {
		return res.status(400).json({ message: "inAppNotifications must be a boolean" });
	}

	const session = await mongoose.startSession();
	let savedPref;
	try {
		await session.withTransaction(async () => {
			const comm = await Community.findById(community._id).session(session);
			const memberId = req.auth.id;
			const existing = (comm.memberPreferences || []).find(
				(p) => String(p.memberId) === String(memberId)
			);
			const emailVal = typeof emailNotifications === "boolean" ? emailNotifications : (existing ? existing.emailNotifications : true);
			const inAppVal = typeof inAppNotifications === "boolean" ? inAppNotifications : (existing ? existing.inAppNotifications : true);
			savedPref = { emailNotifications: emailVal, inAppNotifications: inAppVal };

			if (existing) {
				await Community.updateOne(
					{ _id: community._id, "memberPreferences.memberId": memberId },
					{
						$set: {
							"memberPreferences.$.emailNotifications": emailVal,
							"memberPreferences.$.inAppNotifications": inAppVal,
						},
					},
					{ session }
				);
			} else {
				await Community.updateOne(
					{ _id: community._id },
					{
						$push: {
							memberPreferences: {
								memberId,
								emailNotifications: emailVal,
								inAppNotifications: inAppVal,
							},
						},
					},
					{ session }
				);
			}
		});
	} finally {
		await session.endSession();
	}

	return res.json({ message: "Notification preferences updated", preferences: savedPref });
};

export {
	getAllMessages,
	getCommunityMembers,
	getCommunityReports,
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
	dismissReports,
	getPreferences,
	updatePreferences,
};
