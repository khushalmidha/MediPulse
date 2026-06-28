import User from "../model/user.js";
import Doctor from "../model/doctor.js";
import { createSecret } from "../util/createSecret.js";
import bcrypt from "bcryptjs";
import { configDotenv } from "dotenv";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { getRedis, passwordResetOtpKey } from "../services/redis.js";
import { sendPasswordResetOtpMail } from "../util/mailer.js";
import { ensureWallet } from "../services/virtualLedger.js";
configDotenv()

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const PASSWORD_RESET_OTP_EXPIRY_MS = 10 * 60 * 1000;

const hashValue = (value) =>
	crypto.createHash("sha256").update(value).digest("hex");

const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

const cleanString = (value) => String(value || "").trim();
const buildName = (account) =>
	[account?.firstName, account?.lastName].filter(Boolean).join(" ").trim();
const getAuthModel = (role) => (role === "doctor" ? Doctor : User);
const getRequestRole = (req) => (req.baseUrl?.includes("doctor") ? "doctor" : "user");

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
	if (!cleanString(firstName) || !email || !password || !gender) {
		return res.status(400).json({
			message: "First name, email, password and gender are required",
		});
	}

	if (password.length < 8) {
		return res.status(400).json({ message: "Password must be at least 8 characters long" });
	}

	const existingUser = await User.findOne({ email: email.toLowerCase() });
	if (existingUser) {
		return res.status(409).json({ message: "User already exists" });
	}

	const result = await User.create({
		firstName: cleanString(firstName),
		lastName: cleanString(lastName),
		password: password,
		email: email.toLowerCase(),
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
	await ensureWallet({ userId: result._id, userRole: "user" });
	res
		.status(201)
		.json({ message: "User signed up successfully", success: true, result });
	if (next) next();
};

const userLogin = async (req, res) => {
	const { email, password, rememberMe } = req.body;
	if (!email || !password) {
		return res.status(400).json({ message: "Email and password are required" });
	}

	const user = await User.findOne({ email: email.toLowerCase() });
	if (!user) {
		return res.status(404).json({ message: "User does not exist" });
	}
	const auth = await bcrypt.compare(password, user.password);
	if (!auth) {
		return res.status(401).json({ message: "Incorrect password" });
	}
	await ensureWallet({ userId: user._id, userRole: "user" });
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
	if (!cleanString(firstName) || !email || !password || !gender || !expertise || !years) {
		return res.status(400).json({
			message:
				"First name, email, password, gender, expertise and years are required",
		});
	}

	if (password.length < 8) {
		return res.status(400).json({ message: "Password must be at least 8 characters long" });
	}

	const existingUser = await Doctor.findOne({ email: email.toLowerCase() });
	if (existingUser) {
		return res.status(409).json({ message: "Doctor already exists" });
	}

	const result = await Doctor.create({
		firstName: cleanString(firstName),
		lastName: cleanString(lastName),
		password: password,
		email: email.toLowerCase(),
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
		.json({ message: "Doctor signed up successfully", success: true, result });
	if (next) next();
};

const doctorLogin = async (req, res) => {
	const { email, password, rememberMe } = req.body;
	if (!email || !password) {
		return res.status(400).json({ message: "Email and password are required" });
	}

	const doctor = await Doctor.findOne({ email: email.toLowerCase() });
	if (!doctor) {
		return res.status(404).json({ message: "Doctor does not exist" });
	}
	const auth = await bcrypt.compare(password, doctor.password);
	if (!auth) {
		return res.status(401).json({ message: "Incorrect password" });
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
			if (!cleanString(profile.firstName)) {
				return res.status(400).json({
					message: "Please enter your first name before using Google signup",
				});
			}

			const baseAccount = {
				firstName: cleanString(profile.firstName),
				lastName: cleanString(profile.lastName),
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
				await ensureWallet({ userId: account._id, userRole: "user" });
			}
		}

		setAuthCookies(res, account._id, role, rememberMe);
		if (role === "user") {
			await ensureWallet({ userId: account._id, userRole: "user" });
		}
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

const sendPasswordResetOtp = async (req, res) => {
	const role = getRequestRole(req);
	const Model = getAuthModel(role);
	const email = cleanString(req.body.email).toLowerCase();

	if (!email) {
		return res.status(400).json({ message: "Email is required" });
	}

	const account = await Model.findOne({ email });
	if (!account) {
		return res.status(404).json({
			message: role === "doctor" ? "Doctor does not exist" : "User does not exist",
		});
	}

	const otp = generateOtp();
	try {
		await getRedis().set(
			passwordResetOtpKey(role, email),
			JSON.stringify({
				otpHash: hashValue(otp),
				attempts: 0,
				verified: false,
			}),
			"PX",
			PASSWORD_RESET_OTP_EXPIRY_MS,
		);

		await sendPasswordResetOtpMail({
			to: email,
			accountName: buildName(account),
			otp,
		});
	} catch (error) {
		console.error("Password reset OTP send failed:", error.message);
		const isProduction = process.env.NODE_ENV === "production";
		return res.status(503).json({
			message: isProduction
				? "OTP could not be sent right now. Check Redis and SMTP configuration, then try again."
				: error.message ||
					"OTP could not be sent right now. Check Redis and SMTP configuration, then try again.",
		});
	}

	return res.status(200).json({
		message: "Password reset OTP sent to your email",
		expiresInSeconds: PASSWORD_RESET_OTP_EXPIRY_MS / 1000,
	});
};

const resetPasswordWithOtp = async (req, res) => {
	const role = getRequestRole(req);
	const Model = getAuthModel(role);
	const email = cleanString(req.body.email).toLowerCase();
	const otp = cleanString(req.body.otp);
	const newPassword = String(req.body.newPassword || "");

	if (!email || !otp || !newPassword) {
		return res.status(400).json({ message: "Email, OTP and new password are required" });
	}

	if (!/^\d{6}$/.test(otp)) {
		return res.status(400).json({ message: "Valid 6 digit OTP is required" });
	}

	if (newPassword.length < 8) {
		return res.status(400).json({ message: "Password must be at least 8 characters long" });
	}

	const key = passwordResetOtpKey(role, email);
	const redis = getRedis();
	const stored = await redis.get(key);
	if (!stored) {
		return res.status(410).json({ message: "OTP expired. Please request a new OTP" });
	}

	const otpState = JSON.parse(stored);
	if (otpState.attempts >= 5) {
		await redis.del(key);
		return res.status(429).json({ message: "Too many wrong OTP attempts" });
	}

	if (otpState.otpHash !== hashValue(otp)) {
		otpState.attempts += 1;
		await redis.set(key, JSON.stringify(otpState), "PX", PASSWORD_RESET_OTP_EXPIRY_MS);
		return res.status(401).json({ message: "Incorrect OTP" });
	}

	const account = await Model.findOne({ email });
	if (!account) {
		return res.status(404).json({
			message: role === "doctor" ? "Doctor does not exist" : "User does not exist",
		});
	}

	account.password = newPassword;
	await account.save();
	await redis.del(key);

	return res.status(200).json({ message: "Password reset successfully" });
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

export {
	doctorLogin,
	doctorSignup,
	googleAuth,
	resetPasswordWithOtp,
	sendPasswordResetOtp,
	userLogin,
	userSignup,
	Verifier,
};
