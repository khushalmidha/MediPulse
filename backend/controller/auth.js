import { normalizeSpecialty } from '../util/normalizeSpecialty.js';
import User from "../model/user.js";
import Doctor from "../model/doctor.js";
import mongoose from "mongoose";
import AuthChallenge from "../model/authChallenge.js";
import { issueSession, safeAccount, authenticateRequest, revokePrincipal, revokeToken, clearAuthCookies } from "../services/authSessions.js";
import bcrypt from "bcryptjs";
import { loadRuntimeEnv } from "../util/runtimeEnv.js";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import HospitalStaff from "../model/hospitalStaff.js";
import Hospital from "../model/hospital.js";
import { getRedis } from "../services/redis.js";
import { enqueueJob, mailConfigured } from "../services/outbox.js";
import { moneyTransaction } from "../services/moneyTransaction.js";
import { ensureWallet } from "../services/virtualLedger.js";
loadRuntimeEnv()

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

const rateLimit = async (req, action, limit, windowSeconds) => {
	const ip = req.ip || req.connection.remoteAddress;
	const redis = getRedis();
	if (!redis) return;
	const key = `rl:${action}:${ip}`;
	const current = await redis.incr(key);
	if (current === 1) await redis.expire(key, windowSeconds);
	if (current > limit) throw Object.assign(new Error("Too many requests, please try again later."), { status: 429 });
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

	const existingUser = await User.findOne({ email: email.toLowerCase() }).select("+password");
	if (existingUser) {
		return res.status(409).json({ message: "User already exists" });
	}

	const result = await User.create({
		firstName: cleanString(firstName),
		lastName: cleanString(lastName),
		password: password,
		email: email.toLowerCase(),
		phoneNumber: phone,
		bio: bio,
		medicalHistory: {
			primaryCondition: primaryCondition,
		},
		emergencyContact: {
			name: emergencyContact,
			relation: emergencyRelation,
			phoneNumber: emergencyPhone,
		},
		gender: gender,
	});

	const csrfToken = await issueSession(req, res, result, "user", req.body.rememberMe);
	await ensureWallet({ userId: result._id, userRole: "user" });
	res
		.status(201)
		.json({ message: "User signed up successfully", success: true, csrfToken, result: safeAccount(result) });

};

const userLogin = async (req, res) => {
	try { await rateLimit(req, "login", 5, 60 * 15); } catch (e) { return res.status(e.status || 503).json({ message: e.status === 429 ? e.message : "Authentication service is temporarily unavailable" }); }
	const { email, password, rememberMe } = req.body;
	if (!email || !password) {
		return res.status(400).json({ message: "Email and password are required" });
	}

	const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
	if (!user) {
		return res.status(404).json({ message: "User does not exist" });
	}
	const auth = await bcrypt.compare(password, user.password);
	if (!auth) {
		return res.status(401).json({ message: "Incorrect password" });
	}
	await ensureWallet({ userId: user._id, userRole: "user" });
	const csrfToken = await issueSession(req, res, user, "user", rememberMe);
	res.status(201).json({ message: "User logged in successfully", success: true, csrfToken, result: safeAccount(user) });
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

	const existingUser = await Doctor.findOne({ email: email.toLowerCase() }).select("+password");
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
			expertise: normalizeSpecialty(expertise),
		},
		clinic: {
			location: clinicLocation,
			phone: clinicPhone,
			name: clinicName,
		},
	});

	const csrfToken = await issueSession(req, res, result, "doctor", req.body.rememberMe);
	res
		.status(201)
		.json({ message: "Doctor signed up successfully", success: true, csrfToken, result: safeAccount(result) });

};

const doctorLogin = async (req, res) => {
	try { await rateLimit(req, "login", 5, 60 * 15); } catch (e) { return res.status(e.status || 503).json({ message: e.status === 429 ? e.message : "Authentication service is temporarily unavailable" }); }
	const { email, password, rememberMe } = req.body;
	if (!email || !password) {
		return res.status(400).json({ message: "Email and password are required" });
	}

	const doctor = await Doctor.findOne({ email: email.toLowerCase() }).select("+password");
	if (!doctor) {
		return res.status(404).json({ message: "Doctor does not exist" });
	}
	const auth = await bcrypt.compare(password, doctor.password);
	if (!auth) {
		return res.status(401).json({ message: "Incorrect password" });
	}
	const csrfToken = await issueSession(req, res, doctor, "doctor", rememberMe);
	res.status(201).json({ message: "Doctor logged in successfully", success: true, csrfToken, result: safeAccount(doctor) });
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
				phoneNumber: profile.phone,
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
						expertise: normalizeSpecialty(profile.expertise),
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
					medicalHistory: {
						primaryCondition: profile.primaryCondition,
					},
					emergencyContact: {
						name: profile.emergencyContact,
						relation: profile.emergencyRelation,
						phoneNumber: profile.emergencyPhone,
					},
				});
				await ensureWallet({ userId: account._id, userRole: "user" });
			}
		}

		const csrfToken = await issueSession(req, res, account, role, rememberMe);
		if (role === "user") {
			await ensureWallet({ userId: account._id, userRole: "user" });
		}
		res.status(201).json({
			message: "Google authentication successful",
			success: true,
			result: safeAccount(account),
			csrfToken,
			role,
		});
	} catch (err) {
		res.status(401).json({ message: "Google authentication failed" });
	}
};

const sendPasswordResetOtp = async (req, res) => {
	try { await rateLimit(req, "otp", 3, 60 * 60); } catch (e) { return res.status(e.status || 503).json({ message: e.status === 429 ? e.message : "Authentication service is temporarily unavailable" }); }
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
		if (!mailConfigured()) throw new Error("Mail unavailable");
		const expiresAt = new Date(Date.now() + PASSWORD_RESET_OTP_EXPIRY_MS), challengeId = resetChallengeId(role, email);
		await moneyTransaction(async session => {
			await AuthChallenge.findOneAndUpdate({ _id: challengeId }, { $set: { principalId: account._id, kind: role,
				otpHash: resetOtpHash(otp), attempts: 0, expiresAt, consumedAt: null } }, { upsert: true, session });
			await enqueueJob({ id: `reset:${crypto.randomUUID()}`, kind: "reset.otp", payload: { challengeId },
				secret: { to: email, accountName: buildName(account), otp, otpHash: resetOtpHash(otp) }, expiresAt }, session);
		});
	} catch {
		return res.status(503).json({ message: "OTP email could not be queued. Please try again later." });
	}
	return res.status(200).json({ message: "Password reset OTP email queued", deliveryStatus: "queued", expiresInSeconds: 600 });
};

export const resetChallengeId = (role, email) => `${role}:${hashValue(email)}`;
export const resetOtpHash = (otp) => crypto.createHmac("sha256", process.env.TOKEN_KEY).update(otp).digest("hex");
const resetPasswordWithOtp = async (req, res) => {
	const role = getRequestRole(req), Model = getAuthModel(role);
	const email = cleanString(req.body.email).toLowerCase(), otp = cleanString(req.body.otp);
	const newPassword = String(req.body.newPassword || "");
	if (!email || !/^\d{6}$/.test(otp) || newPassword.length < 8 || newPassword.length > 128)
		return res.status(400).json({ message: "Email, 6 digit OTP and password of 8 to 128 characters are required" });
	const challengeId = resetChallengeId(role, email), now = new Date();
	const challenge = await AuthChallenge.findById(challengeId).select("+otpHash");
	if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) return res.status(410).json({ message: "OTP expired or already used" });
	if (challenge.attempts >= 5) return res.status(429).json({ message: "Too many wrong OTP attempts" });
	if (challenge.otpHash !== resetOtpHash(otp)) {
		await AuthChallenge.updateOne({ _id: challengeId, otpHash: challenge.otpHash, attempts: { $lt: 5 }, consumedAt: null, expiresAt: { $gt: now } }, { $inc: { attempts: 1 } });
		return res.status(401).json({ message: "Incorrect OTP" });
	}
	const session = await mongoose.startSession();
	let afterCommit;
	try {
		await session.withTransaction(async () => {
			const claimed = await AuthChallenge.findOneAndUpdate({ _id: challengeId, otpHash: resetOtpHash(otp), consumedAt: null, attempts: { $lt: 5 }, expiresAt: { $gt: now } }, { $set: { consumedAt: now } }, { new: true, session });
			if (!claimed) throw Object.assign(new Error("OTP expired or already used"), { status: 410 });
			const account = await Model.findOne({ _id: claimed.principalId, email }).select("+password").session(session);
			if (!account) throw Object.assign(new Error("Account not found"), { status: 404 });
			account.password = newPassword;
			await account.save({ session });
			afterCommit = await revokePrincipal(account._id, role, session);
		});
	} finally { await session.endSession(); }
	afterCommit?.();
	clearAuthCookies(res);
	return res.status(200).json({ message: "Password reset successfully. Sign in again." });
};

const staffLogin = async (req, res) => {
	try { await rateLimit(req, "login", 5, 60 * 15); } catch (e) { return res.status(e.status || 503).json({ message: e.status === 429 ? e.message : "Authentication service is temporarily unavailable" }); }
	const { email, password, hospitalId, rememberMe } = req.body;

	if (!email || !password || !hospitalId) {
		return res.status(400).json({ message: "Email, password and hospital id are required" });
	}

	const staff = await HospitalStaff.findOne({
		email: cleanString(email).toLowerCase(),
		hospitalId,
		isActive: true,
	}).select("+password +inviteToken");

	if (!staff || !staff.password || staff.inviteStatus !== "accepted") {
		return res.status(401).json({ message: "Invalid staff credentials" });
	}

	const validPassword = await bcrypt.compare(password, staff.password);
	if (!validPassword) {
		return res.status(401).json({ message: "Invalid staff credentials" });
	}

	const hospital = await Hospital.findById(staff.hospitalId).select("name slug status address stats");
	const csrfToken = await issueSession(req, res, staff, "staff", rememberMe);
	return res.status(200).json({
		message: "Staff logged in successfully",
		success: true,
		csrfToken,
		result: {
			_id: staff._id,
			name: staff.name,
			email: staff.email,
			role: staff.role,
			adminAccess: Boolean(staff.adminAccess),
			hospitalId: staff.hospitalId,
			departmentIds: staff.departmentIds,
		},
		hospital,
	});
};

const staffSetPassword = async (req, res) => {
	const { hospitalId, token, password, name, profilePhoto, doctorProfile = {} } = req.body;

	if (!hospitalId || !token || !password) {
		return res.status(400).json({ message: "Hospital id, invite token and password are required" });
	}

	if (String(password).length < 8) {
		return res.status(400).json({ message: "Password must be at least 8 characters long" });
	}

	const tokenHash = hashValue(token);
	let staff = await HospitalStaff.findOne({
		hospitalId,
		inviteToken: tokenHash,
		inviteStatus: "pending",
		isActive: true,
	}).select("+password +inviteToken");

	if (!staff || !staff.inviteExpiresAt || staff.inviteExpiresAt <= new Date()) {
		return res.status(410).json({ message: "Invite is invalid or expired" });
	}

	// FIXED: Staff invite acceptance only set a password, leaving placeholder profile data from the admin invite.
	staff.name = cleanString(name) || staff.name;
	staff.profilePhoto = cleanString(profilePhoto) || staff.profilePhoto;
	if (staff.role === "DOCTOR") {
		staff.doctorProfile = {
			...(staff.doctorProfile || {}),
			specialization: cleanString(doctorProfile.specialization) || staff.doctorProfile?.specialization,
			qualification: cleanString(doctorProfile.qualification) || staff.doctorProfile?.qualification,
			experience: Number(doctorProfile.experience || staff.doctorProfile?.experience || 0),
		};
	}
	staff = await HospitalStaff.findOneAndUpdate({ _id: staff._id, hospitalId, inviteToken: tokenHash,
		inviteStatus: "pending", isActive: true, inviteExpiresAt: { $gt: new Date() } }, {
		$set: { name: staff.name, profilePhoto: staff.profilePhoto, doctorProfile: staff.doctorProfile,
			password: await bcrypt.hash(String(password), 12), inviteStatus: "accepted", joinedAt: new Date() },
		$unset: { inviteToken: 1, inviteExpiresAt: 1 }, $inc: { authVersion: 1 },
	}, { new: true, runValidators: true });
	if (!staff) return res.status(410).json({ message: "Invite is invalid or already used" });

	// Sync Doctor record with updated profile info when a DOCTOR accepts their invite
	if (staff.role === "DOCTOR" && staff.doctorId) {
		try {
			const [firstNamePart, ...rest] = cleanString(name || staff.name).split(" ");
			const updateFields = {
				firstName: firstNamePart || cleanString(name || staff.name),
				lastName: rest.join(" "),
			};
			if (profilePhoto) updateFields.profilePhoto = profilePhoto;
			if (staff.doctorProfile?.specialization) {
				updateFields["experience.expertise"] = staff.doctorProfile.specialization;
			}
			if (staff.doctorProfile?.qualification) {
				updateFields["experience.qualification"] = staff.doctorProfile.qualification;
			}
			if (staff.doctorProfile?.experience) {
				updateFields["experience.years"] = Number(staff.doctorProfile.experience);
			}
			await Doctor.findByIdAndUpdate(staff.doctorId, { $set: updateFields });
		} catch (syncErr) {
			console.error("Doctor profile sync on invite accept failed (non-fatal):", syncErr.message);
		}
	}

	const csrfToken = await issueSession(req, res, staff, "staff");
	const hospital = await Hospital.findById(staff.hospitalId).select("name slug status address branding stats");
	return res.status(200).json({
		message: "Staff password set successfully",
		success: true,
		csrfToken,
		result: {
			_id: staff._id,
			name: staff.name,
			email: staff.email,
			role: staff.role,
			adminAccess: Boolean(staff.adminAccess),
			hospitalId: staff.hospitalId,
			departmentIds: staff.departmentIds,
		},
		hospital,
	});
};

const staffChangePassword = async (req, res) => {
	const { currentPassword, newPassword } = req.body;
	if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 72)
		return res.status(400).json({ message: "Current password and a new password of 8 to 72 bytes are required" });
	const session = await mongoose.startSession();
	let afterCommit;
	try {
		await session.withTransaction(async () => {
			const staff = await HospitalStaff.findOne({ _id: req.staff.id, hospitalId: req.staff.hospitalId, isActive: true, inviteStatus: "accepted" }).select("+password").session(session);
			if (!staff || !staff.password || staff.authVersion !== req.authSession.authVersion || !(await bcrypt.compare(currentPassword, staff.password)))
				throw Object.assign(new Error("Current password or session is no longer valid"), { status: 401 });
			staff.password = newPassword;
			await staff.save({ session });
			afterCommit = await revokePrincipal(staff._id, "staff", session);
		});
	} finally { await session.endSession(); }
	afterCommit?.();
	clearAuthCookies(res);
	return res.status(200).json({ message: "Password changed successfully. Sign in again." });
};

const Verifier = async (req, res) => {
	const { principal, kind, session } = await authenticateRequest(req, "account");
	return res.json({ message: "Authorized", data: safeAccount(principal), role: kind, csrfToken: session.csrfToken });
};
const StaffVerifier = async (req, res) => {
	const { principal: staff, session } = await authenticateRequest(req, "staff");
	const hospital = await Hospital.findById(staff.hospitalId).select("name slug status address branding stats");
	return res.json({ message: "Authorized", data: safeAccount(staff), role: staff.role,
		adminAccess: Boolean(staff.adminAccess), hospitalId: staff.hospitalId, hospital, csrfToken: session.csrfToken });
};
export const logout = async (req, res) => {
	const scope = req.path.includes("staff") ? "staff" : "account";
	const { session } = await authenticateRequest(req, scope);
	await revokeToken(req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.cookies?.[scope === "staff" ? "staffToken" : "token"]);
	clearAuthCookies(res);
	return res.json({ message: "Signed out", sessionEnded: Boolean(session) });
};

export {
	doctorLogin,
	doctorSignup,
	googleAuth,
	resetPasswordWithOtp,
	sendPasswordResetOtp,
	staffChangePassword,
	staffLogin,
	staffSetPassword,
	userLogin,
	userSignup,
	Verifier,
	StaffVerifier,
};

