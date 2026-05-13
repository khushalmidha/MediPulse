import User from "../model/user.js";
import Doctor from "../model/doctor.js";
import { createSecret } from "../util/createSecret.js";
import bcrypt from "bcryptjs";
import { configDotenv } from "dotenv";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
configDotenv()

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const getCookieOptions = (rememberMe = false) => {
	const isProduction = process.env.NODE_ENV === "production";
	const options = {
		httpOnly: false,
		path: "/",
		secure: isProduction,
		sameSite: isProduction ? "none" : "lax",
	};

	if (rememberMe) {
		options.maxAge = 1000 * 60 * 60 * 24 * 30;
	}

	return options;
};

const setAuthCookies = (res, accountId, role, rememberMe = false) => {
	const tokenExpiry = rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 3;
	const token = createSecret(accountId, role, tokenExpiry);
	const options = getCookieOptions(rememberMe);
	res.cookie("token", token, options);
	res.cookie("id", accountId, options);
};
const userSignup = async (req, res, next) => {
	const {
		firstName,
		lastName,
		email,
		password,
		gender,
		bio,
		phone,
		primaryCondition,
		emergencyContact,
		emergencyRelation,
		emergencyPhone,
	} = req.body;
	console.log(req.body);
	if (!firstName || !email || !password || !gender) {
		return res.json({
			message: "FirstName, Email, Password and Gender are required",
			firstName,
			email,
			password,
			gender
		});
	}

	if (password.len < 8) {
		return res.json({ message: "Password must be atleast 8 long" });
	}

	const existingUser = await User.findOne({ email });
	if (existingUser) {
		return res.json({ message: "User already exists" });
	}

	const result = await User.create({
		firstName: firstName,
		lastName: lastName,
		password: password,
		email: email,
		phone: phone,
		bio: bio,
		medical: {
			primaryCondition: primaryCondition,
		},
		emergencyContact: {
			name: emergencyContact,
			relation: emergencyRelation,
			phone: emergencyPhone,
		},
		gender: gender,
	});

	setAuthCookies(res, result._id, "user", req.body.rememberMe);
	res
		.status(201)
		.json({ message: "User signed in successfully", success: true, result });
	next();
};

const userLogin = async (req, res) => {
	const { email, password, rememberMe } = req.body;
	if (!email || !password) {
		return res.json({ message: "Email and password are required" });
	}

	const user = await User.findOne({ email });
	if (!user) {
		return res.json({ message: "User does not exist" });
	}
	const auth = await bcrypt.compare(password, user.password);
	if (!auth) {
		return res.json({ message: "Incorrect password" });
	}
	setAuthCookies(res, user._id, "user", rememberMe);
	res.status(201).json({ message: "User logged in successfully", success: true, result: user });
};

const doctorSignup = async (req, res, next) => {
	const {
		firstName,
		lastName,
		email,
		password,
		gender,
		bio,
		years,
		expertise,
		clinicName,
		clinicPhone,
		clinicLocation,
		phone,
	} = req.body;
	if (!firstName || !email || !password || !gender || !expertise || !years) {
		return res.json({
			message:
				"FirstName, Email, Password, Gender, Expertise and Years are required",
		});
	}

	if (password.len < 8) {
		return res.json({ message: "Password must be atleast 8 long" });
	}

	const existingUser = await Doctor.findOne({ email });
	if (existingUser) {
		return res.json({ message: "Doctor already exists" });
	}

	const result = await Doctor.create({
		firstName: firstName,
		lastName: lastName,
		password: password,
		email: email,
		phone: phone,
		bio: bio,
		gender: gender,
		experience: {
			years: years,
			expertise: expertise,
		},
		clinic: {
			location: clinicLocation,
			phone: clinicPhone,
			name: clinicName,
		},
	});

	setAuthCookies(res, result._id, "doctor", req.body.rememberMe);
	res
		.status(201)
		.json({ message: "Doctor signed in successfully", success: true, result });
	next();
};

const doctorLogin = async (req, res) => {
	const { email, password, rememberMe } = req.body;
	if (!email || !password) {
		return res.json({ message: "Email and password are required" });
	}

	const doctor = await Doctor.findOne({ email });
	if (!doctor) {
		return res.json({ message: "Doctor does not exist" });
	}
	const auth = await bcrypt.compare(password, doctor.password);
	if (!auth) {
		return res.json({ message: "Incorrect password" });
	}
	setAuthCookies(res, doctor._id, "doctor", rememberMe);
	res.status(201).json({ message: "Doctor logged in successfully", success: true, result: doctor });
};

const verifyGoogleCredential = async (credential) => {
	if (!process.env.GOOGLE_CLIENT_ID) {
		throw new Error("Google client id is not configured");
	}

	const ticket = await googleClient.verifyIdToken({
		idToken: credential,
		audience: process.env.GOOGLE_CLIENT_ID,
	});
	const payload = ticket.getPayload();

	if (!payload?.email || !payload?.email_verified) {
		throw new Error("Google account email could not be verified");
	}

	return payload;
};

const googleAuth = async (req, res) => {
	const { credential, role = "user", profile = {}, rememberMe } = req.body;

	if (!credential) {
		return res.status(400).json({ message: "Google credential is required" });
	}

	if (!["user", "doctor"].includes(role)) {
		return res.status(400).json({ message: "Invalid profile type" });
	}

	try {
		const payload = await verifyGoogleCredential(credential);
		const email = payload.email.toLowerCase();
		const Model = role === "doctor" ? Doctor : User;
		let account = await Model.findOne({ email });

		if (!account) {
			const [googleFirstName = "Google", ...restName] = (payload.given_name || payload.name || "Google User").trim().split(" ");
			const baseAccount = {
				firstName: profile.firstName || googleFirstName,
				lastName: profile.lastName || payload.family_name || restName.join(" "),
				email,
				password: crypto.randomBytes(32).toString("hex"),
				gender: profile.gender || "other",
				bio: profile.bio,
				phone: profile.phone,
			};

			if (role === "doctor") {
				if (!profile.years || !profile.expertise) {
					return res.status(400).json({
						message: "Years of experience and expertise are required for doctor Google signup",
					});
				}

				account = await Doctor.create({
					...baseAccount,
					experience: {
						years: profile.years,
						expertise: profile.expertise,
					},
					clinic: {
						location: profile.clinicLocation,
						phone: profile.clinicPhone,
						name: profile.clinicName,
					},
				});
			} else {
				account = await User.create({
					...baseAccount,
					medical: {
						primaryCondition: profile.primaryCondition,
					},
					emergencyContact: {
						name: profile.emergencyContact,
						relation: profile.emergencyRelation,
						phone: profile.emergencyPhone,
					},
				});
			}
		}

		setAuthCookies(res, account._id, role, rememberMe);
		res.status(201).json({
			message: "Google authentication successful",
			success: true,
			result: account,
			role,
		});
	} catch (err) {
		console.error(err);
		res.status(401).json({ message: err.message || "Google authentication failed" });
	}
};

const Verifier = async (req,res) => {
	const token = req.cookies.token;
	if(!token){
		return res.status(401).json({message:"No Token"});
	}
	jwt.verify(token,process.env.TOKEN_KEY, async(err,data) => {
		if(err){
			return res.status(401).json({message:"Expired or Invalid Token"});
		}
		const user = await (data.role === "user" ? User : Doctor).findById(data.id);
		if(!user){
			return res.status(401).json({message:"Unauthorized"});
		}
		res.status(200).json({message:"Authorized",data:user,role:data.role});
	})
}

export { userLogin, userSignup, doctorLogin, doctorSignup, googleAuth, Verifier };
