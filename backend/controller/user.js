import User from "../model/user.js";
import jwt from "jsonwebtoken";
import { configDotenv } from "dotenv";

configDotenv();

const getUserById = async (req, res) => {
	const token = req.cookies.token;
	console.log(token);
	if (!token) {
		return res.status(401).json({ message: "Unauthorized" });
	}
	jwt.verify(token, process.env.TOKEN_KEY, async (err, data) => {
		if (err) {
			return res.status(401).json({ message: "Unauthorized" });
		}

		const user = await User.findById(data.id);
		if (!user) {
			return res.status(401).json({ message: "Unauthorized" });
		}
		return res.status(200).json(user);
	});
};

const updateUserData = async (req, res) => {
	const token = req.cookies.token;
	if (!token) {
		return res.status(401).json({ message: "Unauthorized" });
	}
	jwt.verify(token, process.env.TOKEN_KEY, async (err, data) => {
		if (err) {
			return res.status(401).json({ message: "Unauthorized" });
		}

		const user = await User.updateOne({ _id: data.id }, req.body);
		if (!user) {
			return res.status(401).json({ message: "Unauthorized" });
		}
		return res.json(user);
	});
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
