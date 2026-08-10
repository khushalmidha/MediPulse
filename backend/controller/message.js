import Message from "../model/message.js";
import User from "../model/user.js";
import Community from "../model/community.js";

const createMessage = async (req, res) => {
	if (!req.auth) return res.status(401).json({ message: "Unauthorized" });

	const user = await User.findById(req.auth.id);
	if (!user) {
		return res.status(401).json({ message: "Unauthorized" });
	}

	const { content, id } = req.body;
	if (!content || !id) {
		return res.json({ message: "Content and community name are required" });
	}

	const community = await Community.findById(id);
	if (!community) {
		return res.json({ message: "Community does not exist" });
	}

	const msg = await Message.create({
		author: user._id,
		author_name: user.firstName,
		content: content,
		community: id,
	});

	return res.status(201).json({
		message: "Message Created",
		msg,
	});
};

export { createMessage };
