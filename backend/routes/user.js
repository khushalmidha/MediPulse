import asyncHandler from "../middleware/asyncHandler.js";
import { Router } from "express";
import {
  logout,
	googleAuth,
	resetPasswordWithOtp,
	sendPasswordResetOtp,
	staffChangePassword,
	staffLogin,
	staffSetPassword,
	userLogin,
	userSignup,
} from "../controller/auth.js";
import userValidation from "../middleware/validateUser.js";
import validateStaff from "../middleware/validateStaff.js";
import {
	deleteUserById,
	getAllUsers,
	getUserById,
    updateUserData,
} from "../controller/user.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";

const userRouter = Router();
userRouter.use(nosqlGuard);

userRouter.post("/logout", asyncHandler(logout));
userRouter.post("/staff/logout", asyncHandler(logout));
userRouter.post("/login", asyncHandler(userLogin));
userRouter.post("/signup", asyncHandler(userSignup));
userRouter.post("/google-auth", asyncHandler(googleAuth));
userRouter.post("/forgot-password/send-otp", asyncHandler(sendPasswordResetOtp));
userRouter.post("/forgot-password/reset", asyncHandler(resetPasswordWithOtp));
userRouter.post("/staff/login", asyncHandler(staffLogin));
userRouter.post("/staff/set-password", asyncHandler(staffSetPassword));
userRouter.patch("/staff/password", validateStaff, asyncHandler(staffChangePassword));
userRouter.get("/staff/setup/verify/:token", asyncHandler(async (req, res) => {
  const { verifyAdminSetupLink } = await import("../services/saasOperationsService.js");
  const verification = await verifyAdminSetupLink(req.params.token);
  return res.json({ message: "Setup link is valid", hospital: verification.hospital });
}));
userRouter.post("/staff/setup/consume", asyncHandler(async (req, res) => {
  const { postConsumeSetupLink } = await import("../controller/saasOperations.js");
  return postConsumeSetupLink(req, res);
}));
userRouter.post("/staff/setup", asyncHandler(async (req, res) => {
  const { postConsumeSetupLink } = await import("../controller/saasOperations.js");
  return postConsumeSetupLink(req, res);
}));

// userRouter.get("/:id", userValidation, asyncHandler(getUserById));
userRouter.delete("/:id", userValidation, asyncHandler(deleteUserById));
// userRouter.get("/", userValidation, asyncHandler(getAllUsers));
userRouter.get("/", userValidation, asyncHandler(getUserById));
userRouter.put("/", userValidation, asyncHandler(updateUserData));

export default userRouter;
