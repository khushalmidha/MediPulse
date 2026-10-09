import mongoose from "mongoose";
import { requireCommunityAccess, isCommunityOrganizer, communitySummary } from "../services/communityAccess.js";
import { isRecordId } from "../services/hospitalAccess.js";
import Community from "../model/community.js";
import Message from "../model/message.js";
import User from "../model/user.js";
import Doctor from "../model/doctor.js";

const getAllMessages = async (req, res) => {
	const community = await requireCommunityAccess(req.params.id, req.auth);
	const messages = await Message.find({ community: community._id });
	return res.json(messages);
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

export {
	getAllMessages,
	getAllCommunities,
	createCommunity,
	getAllUserCommunities,
	joinCommunity,
	leaveCommunity,
	getAllDoctorCommunities
};
