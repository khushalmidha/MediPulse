import mongoose from "mongoose";
import Department from "../model/department.js";
import HospitalStaff from "../model/hospitalStaff.js";
import StaffMessage from "../model/staffMessage.js";
import { accessError, departmentMember, requireRecordId } from "../services/hospitalAccess.js";
import { canReadStaffMessage, loadMessageVisit, messageForStaff, staffMessageFilter } from "../services/staffMessaging.js";

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const canAccessDepartment = (staff, departmentId) =>
  staff.role === "HOSPITAL_ADMIN" || departmentMember(staff, departmentId);

export const listStaffMessages = async (req, res) => {
  try {
    const { conversationType, tokenId, departmentId, recipientStaffId, messageType, limit = 80 } = req.query;
    const filter = {};

    if (conversationType) filter.conversationType = conversationType;
    if (messageType) filter.messageType = messageType;

    if (tokenId) {
      if (!isObjectId(tokenId)) return res.status(400).json({ message: "Invalid token id" });
      await loadMessageVisit(req.staff, tokenId, messageType || "text");
      filter.tokenId = tokenId;
    }

    if (departmentId) {
      if (!isObjectId(departmentId)) return res.status(400).json({ message: "Invalid department id" });
      if (!canAccessDepartment(req.staff, departmentId)) {
        return res.status(403).json({ message: "You cannot access this department channel" });
      }
      if (!(await Department.exists({ _id: departmentId, hospitalId: req.staff.hospitalId }))) throw accessError(404, "Department not found");
      filter.departmentId = departmentId;
    }

    if (recipientStaffId) {
      if (!isObjectId(recipientStaffId)) return res.status(400).json({ message: "Invalid staff id" });
      if (!(await HospitalStaff.exists({ _id: recipientStaffId, hospitalId: req.staff.hospitalId, isActive: true, inviteStatus: "accepted" }))) throw accessError(404, "Recipient not found");
      filter.$or = [{ sender: req.staff.id, recipientStaffId }, { sender: recipientStaffId, recipientStaffId: req.staff.id }];
    }

    const numericLimit = Math.min(Math.max(Number(limit) || 80, 1), 200);
    const messages = await StaffMessage.find({ $and: [await staffMessageFilter(req.staff), filter] }).sort({ createdAt: -1 }).limit(numericLimit).lean();
    const visible = [];
    for (const message of messages) {
      if (await canReadStaffMessage(req.staff, message)) visible.push(messageForStaff(message));
    }

    res.status(200).json({ items: visible.reverse() });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to load staff messages" });
  }
};

export const markStaffMessagesRead = async (req, res) => {
  try {
    const { messageIds = [] } = req.body;
    if (!Array.isArray(messageIds) || messageIds.length > 200) throw accessError(400, "At most 200 message ids are allowed");
    const ids = messageIds.map((id) => requireRecordId(id, "message"));
    if (!ids.length) return res.status(200).json({ updated: 0 });

    const candidates = await StaffMessage.find({ $and: [await staffMessageFilter(req.staff), { _id: { $in: ids } }] }).lean();
    const visible = [];
    for (const message of candidates) { if (await canReadStaffMessage(req.staff, message)) visible.push(message._id); }

    const result = await StaffMessage.updateMany(
      { _id: { $in: visible }, hospitalId: req.staff.hospitalId, "readBy.staffId": { $ne: req.staff.id } },
      { $push: { readBy: { staffId: req.staff.id, readAt: new Date() } } },
    );

    res.status(200).json({ updated: result.modifiedCount || 0 });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to mark messages read" });
  }
};

export const getStaffDirectory = async (req, res) => {
  try {
    const hospitalId = req.staff.hospitalId;
    const [departments, staff] = await Promise.all([
      Department.find({ hospitalId, status: "active", ...(["HOSPITAL_ADMIN", "RECEPTIONIST"].includes(req.staff.role) ? {} : { _id: { $in: req.staff.departmentIds } }) }).select("name code opd").sort({ name: 1 }).lean(),
      HospitalStaff.find({ hospitalId, isActive: true, inviteStatus: "accepted" })
        .select("name email role profilePhoto departmentIds doctorProfile")
        .sort({ role: 1, name: 1 })
        .lean(),
    ]);

    // FIXED: Nursing/chat pages required raw department/doctor IDs instead of offering the logged-in staff directory.
    res.status(200).json({ departments, staff });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load staff directory" });
  }
};
