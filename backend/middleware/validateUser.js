import User from "../model/user.js";
import jwt from "jsonwebtoken";
import { configDotenv } from "dotenv";
import Doctor from "../model/doctor.js";

configDotenv();

const userValidation = async (req, res, next) => {
	const token = req.cookies.token;
	const userId = req.cookies.id
	console.log(token);
	if (!token) {
		return res.status(401).json({ message: "No Token" });
	}
	jwt.verify(token, process.env.TOKEN_KEY, async (err, data) => {
		if (err) {
			return res.status(401).json({ message: err.message || "Expired or Invalid Token" });
		}
		if(data.id !== userId){
			return res.status(401).json({message:"Unauthorized"});
		}
		const user = await (data.role === "user" ? User : Doctor).findById(data.id);
		if(!user){
			return res.status(401).json({message:"Unauthorized"});
		}
		req.auth = { id: data.id, role: data.role };
    next();
	});
};

export default userValidation;
