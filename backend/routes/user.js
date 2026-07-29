import { Router } from "express";
import {
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

const userRouter = Router();

userRouter.post("/login", userLogin);
userRouter.post("/signup", userSignup);
userRouter.post("/google-auth", googleAuth);
userRouter.post("/forgot-password/send-otp", sendPasswordResetOtp);
userRouter.post("/forgot-password/reset", resetPasswordWithOtp);
userRouter.post("/staff/login", staffLogin);
userRouter.post("/staff/set-password", staffSetPassword);
userRouter.patch("/staff/password", validateStaff, staffChangePassword);

// userRouter.get("/:id", userValidation, getUserById);
userRouter.delete("/:id", userValidation, deleteUserById);
// userRouter.get("/", userValidation, getAllUsers);
userRouter.get("/", userValidation, getUserById);
userRouter.put("/", userValidation, updateUserData);

export default userRouter;
