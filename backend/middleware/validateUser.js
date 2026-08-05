import User from "../model/user.js";
import jwt from "jsonwebtoken";
import Doctor from "../model/doctor.js";

const userValidation = async (req, res, next) => {
	const token = req.cookies.token || req.headers.authorization?.replace(/^Bearer\s+/i, "");
	const userId = req.cookies.id
	if (!token) {
		return res.status(401).json({ message: "No Token" });
	}
	jwt.verify(token, process.env.TOKEN_KEY, async (err, data) => {
		if (err) {
			return res.status(401).json({ message: err.message || "Expired or Invalid Token" });
		}
		// FIXED: Cross-site browser cookie issues could drop the readable id cookie while the JWT bearer token was still valid.
		if(userId && data.id !== userId){
			return res.status(401).json({message:"Unauthorized"});
		}
		const user = await (data.role === "user" ? User : Doctor).findById(data.id);
		if(!user){
			return res.status(401).json({message:"Unauthorized"});
		}
		req.auth = { id: data.id, role: data.role, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() };
    next();
	});
};

export default userValidation;
