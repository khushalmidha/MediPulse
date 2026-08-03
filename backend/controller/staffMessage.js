import mongoose from "mongoose";
import Department from "../model/department.js";
import HospitalStaff from "../model/hospitalStaff.js";
import StaffMessage from "../model/staffMessage.js";

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const canAccessDepartment = (staff, departmentId) =>
  ["HOSPITAL_ADMIN", "DEPARTMENT_HEAD"].includes(staff.role) ||
  staff.departmentIds.includes(departmentId);

export const listStaffMessages = async (req, res) => {
  try {
    const { conversationType, tokenId, departmentId, recipientStaffId, messageType, limit = 80 } = req.query;
    const filter = { hospitalId: req.staff.hospitalId };

    if (conversationType) filter.conversationType = conversationType;
    if (messageType) filter.messageType = messageType;

    if (tokenId) {
      if (!isObjectId(tokenId)) return res.status(400).json({ message: "Invalid token id" });
      filter.tokenId = tokenId;
    }

    if (departmentId) {
      if (!isObjectId(departmentId)) return res.status(400).json({ message: "Invalid department id" });
      if (!canAccessDepartment(req.staff, departmentId)) {
        return res.status(403).json({ message: "You cannot access this department channel" });
      }
      filter.departmentId = departmentId;
    }

    if (recipientStaffId) {
      if (!isObjectId(recipientStaffId)) return res.status(400).json({ message: "Invalid staff id" });
      filter.$or = [{ sender: req.staff.id, recipientStaffId }, { sender: recipientStaffId, recipientStaffId: req.staff.id }];
    }

    const numericLimit = Math.min(Math.max(Number(limit) || 80, 1), 200);
    const messages = await StaffMessage.find(filter).sort({ createdAt: -1 }).limit(numericLimit).lean();

    res.status(200).json({ items: messages.reverse() });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load staff messages" });
  }
};

export const markStaffMessagesRead = async (req, res) => {
  try {
    const { messageIds = [] } = req.body;
    const ids = messageIds.filter(isObjectId);
    if (!ids.length) return res.status(200).json({ updated: 0 });

    const result = await StaffMessage.updateMany(
      { _id: { $in: ids }, hospitalId: req.staff.hospitalId, "readBy.staffId": { $ne: req.staff.id } },
      { $push: { readBy: { staffId: req.staff.id, readAt: new Date() } } },
    );

    res.status(200).json({ updated: result.modifiedCount || 0 });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to mark messages read" });
  }
};

export const getStaffDirectory = async (req, res) => {
  try {
    const hospitalId = req.staff.hospitalId;
    const [departments, staff] = await Promise.all([
      Department.find({ hospitalId, status: "active" }).select("name code opd").sort({ name: 1 }).lean(),
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
