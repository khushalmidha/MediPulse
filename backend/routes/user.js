import { Router } from "express";
import {
	googleAuth,
	resetPasswordWithOtp,
	sendPasswordResetOtp,
	userLogin,
	userSignup,
} from "../controller/auth.js";
import userValidation from "../middleware/validateUser.js";
import {
	deleteUserById,
	getUserById,
    updateUserData,
} from "../controller/user.js";

const userRouter = Router();

userRouter.post("/login", userLogin);
userRouter.post("/signup", userSignup);
userRouter.post("/google-auth", googleAuth);
userRouter.post("/forgot-password/send-otp", sendPasswordResetOtp);
userRouter.post("/forgot-password/reset", resetPasswordWithOtp);
userRouter.delete("/:id", userValidation, deleteUserById);
userRouter.get("/", userValidation, getUserById);
userRouter.put("/", userValidation, updateUserData);

export default userRouter;
