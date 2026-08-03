import express from "express";
import validateStaff from "../middleware/validateStaff.js";
import { getStaffDirectory, listStaffMessages, markStaffMessagesRead } from "../controller/staffMessage.js";

const router = express.Router();

router.get("/", validateStaff, listStaffMessages);
router.get("/directory", validateStaff, getStaffDirectory);
router.patch("/read", validateStaff, markStaffMessagesRead);

export default router;
