import Community from "../model/community.js";
import Message from "../model/message.js";
import User from "../model/user.js";
import Doctor from "../model/doctor.js";
import jwt from "jsonwebtoken";
import { configDotenv } from "dotenv";

configDotenv();

const getAllMessages = async (req, res) => {
	const community = await Community.findById(req.params.id);
	if (!community) {
		return res.json({ message: "Community does not exist" });
	}
	const messages = await Message.find({ community: community._id });
	return res.json(messages);
};

const getAllCommunities = async (_, res) => {
	const communities = await Community.find({});
	return res.json(communities);
};

const getAllUserCommunities = async (req, res) => {
	const token = req.cookies.token;
	if (!token) {
		return res.status(401).json({ message: "Unauthorized" });
	}
	jwt.verify(token, process.env.TOKEN_KEY, async (err, data) => {
		if (err) {
			return res.status(401).json({ message: "Unauthorized" });
		}

		const user = await (data.role === "user"? User : Doctor).findById(data.id);
		if (!user) {
			return res.status(401).json({ message: "Unauthorized" });
		}

		const communities = await Community.find({
			_id: { $in: user.communities },
		});
		return res.json(communities);
	});
};

const getAllDoctorCommunities = async(req,res) => {
	try{
		const {id} = req.body;
		const doctor = await Doctor.findById(id);
		if(!doctor){
			return res.status(400).json({message:"Doctor does not exist"});
		}
		const communities = await Community.find({author:id});
		return res.status(200).json(communities);
	}
	catch(err){
		return res.status(500).json({message:err.message});
	}
}

const joinCommunity = async (req, res) => {
	const token = req.cookies.token;
	if (!token) {
		return res.status(401).json({ message: "Unauthorized" });
	}
	jwt.verify(token, process.env.TOKEN_KEY, async (err, data) => {
		if (err) {
			return res.status(401).json({ message: "Unauthorized" });
		}

		const user = await (data.role === "user" ? User : Doctor).findById(data.id);
		if (!user) {
			return res.status(401).json({ message: "Unauthorized" });
		}

		const { id } = req.body;
		if (!id) {
			return res.json({ message: "Community Name is required" });
		}

		const community = await Community.findById(id);
		if (!community) {
			return res.json({ message: "Community does not exist" });
		}

		await community.updateOne({
			$push: { members: user._id },
		})

		await user.updateOne({
			$push: { communities: id },
		});
		const result = await (data.role === "user" ? User : Doctor).findById(data.id);
		return res.json(result);
	});
};

const createCommunity = async (req, res) => {
	const token = req.cookies.token;
	if (!token) {
		return res.status(401).json({ message: "Unauthorized" });
	}
	jwt.verify(token, process.env.TOKEN_KEY, async (err, data) => {
		if (err) {
			return res.status(401).json({ message: "Unauthorized" });
		}

		const user = await Doctor.findById(data.id);
		if (!user) {
			return res.status(401).json({ message: "Unauthorized" });
		}

		const { bio, title, category } = req.body;
		if (!bio || !title) {
			return res.json({ message: "Bio and title are required" });
		}
		const community = await Community.create({
			title: title,
			author: user._id,
			bio: bio,
			category: category,
			members: [user._id]
		});
		await user.updateOne({
			$push: { communities: community._id },
		})
		return res.status(201).json({
			message: "Community Created",
			community,
		});
	});
};
const leaveCommunity = async (req,res) => {
	const userId = req.cookies.id;
	if(!userId){
		return res.status(401).json({message:"Unauthorized"});
	}
	try{
		const user = await User.findById(userId);
		if(!user){
			return res.status(401).json({message:"Unauthorized"});
		}
		const {id} = req.body;
		if(!id){
			return res.status(400).json({message:"Community Id is required"});
		}
		const community = await Community.findById(id);
		if(!community){
			return res.status(400).json({message:"Community does not exist"});
		}
		await community.updateOne({
			$pull: {members:userId}
		});
		await user.updateOne({
			$pull: {communities:id}
		});
		const updatedUser = await User.findById(userId);
		const updatedCommunity = await Community.findById(id);
		return res.status(200).json({message: "Successfully left community",user:updatedUser,community:updatedCommunity});
	}
	catch(err){
		return res.status(500).json({message:err.message});
	}
}


export {
	getAllMessages,
	getAllCommunities,
	createCommunity,
	getAllUserCommunities,
	joinCommunity,
	leaveCommunity
};
