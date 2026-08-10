import User from "../model/user.js";

const getUserById = async (req, res) => {
	if (!req.auth) return res.status(401).json({ message: "Unauthorized" });

	const user = await User.findById(req.auth.id);
	if (!user) {
		return res.status(401).json({ message: "Unauthorized" });
	}
	return res.status(200).json(user);
};

const updateUserData = async (req, res) => {
	if (!req.auth) return res.status(401).json({ message: "Unauthorized" });

	const allowedFields = ["firstName", "lastName", "bio", "gender", "phoneNumber", "medicalHistory", "emergencyContact", "familyMembers"];
	const updateData = {};
	for (const key of allowedFields) {
		if (req.body[key] !== undefined) {
			updateData[key] = req.body[key];
		}
	}

	const user = await User.findByIdAndUpdate(req.auth.id, updateData, { new: true });
	if (!user) {
		return res.status(401).json({ message: "Unauthorized" });
	}
	return res.json(user);
};

const getAllUsers = async (req, res) => {
	const users = await User.find({});
	return res.json(users);
};

const deleteUserById = async (req, res) => {
	const result = await User.findByIdAndDelete(req.params.id);
	return res.json(result);
};

export { getUserById, getAllUsers, deleteUserById, updateUserData };
