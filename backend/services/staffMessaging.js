import Department from "../model/department.js";
import HospitalStaff from "../model/hospitalStaff.js";
import OpdToken from "../model/opdToken.js";
import { accessError, activeStaff, canAccessVisit, departmentMember, idOf, requireRecordId, staffId, staffRoom, validVisitReferences } from "./hospitalAccess.js";

const visitMessageAccess = (staff, token, type) => canAccessVisit(staff, token, { clinical: true })
  || (staff.role === "LAB_TECH" && type === "lab_alert" && idOf(staff.hospitalId) === idOf(token.hospitalId) && departmentMember(staff, token.departmentId));

export const loadMessageVisit = async (staff, tokenId, messageType = "text") => {
  requireRecordId(tokenId, "token");
  const token = await OpdToken.findOne({ _id: tokenId, hospitalId: staff.hospitalId });
  if (!token) throw accessError(404, "Visit not found");
  if (!(await validVisitReferences(token))) throw accessError(403, "Visit references do not belong to this hospital department");
  if (!visitMessageAccess(staff, token, messageType)) throw accessError(403, "You cannot access this visit conversation");
  return token;
};

export const prepareStaffMessage = async (staff, payload) => {
  if (idOf(payload.hospitalId) !== idOf(staff.hospitalId)) throw accessError(403, "Invalid hospital");
  const { conversationType, messageType = "text" } = payload;
  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  if (!["direct", "patient_context", "department", "announcement"].includes(conversationType) || !content || content.length > 2000) {
    throw accessError(400, "Valid conversation and content of at most 2000 characters are required");
  }
  if (!["text", "lab_alert", "vitals_ready"].includes(messageType)) throw accessError(400, "Invalid message type");
  if ((conversationType === "patient_context" || messageType !== "text" || payload.patientId) && !payload.tokenId) {
    throw accessError(400, "A visit token is required for patient or clinical messages");
  }
  let token;
  if (payload.tokenId) {
    token = await loadMessageVisit(staff, payload.tokenId, messageType);
    if (payload.patientId && idOf(payload.patientId) !== idOf(token.patientId)) throw accessError(403, "Patient does not match the visit");
    if (payload.departmentId && idOf(payload.departmentId) !== idOf(token.departmentId)) throw accessError(403, "Department does not match the visit");
  }
  let departmentId = payload.departmentId ? requireRecordId(payload.departmentId, "department") : token?.departmentId;
  if (conversationType === "department" && !departmentId) throw accessError(400, "Department is required");
  if (departmentId) {
    if (!(await Department.exists({ _id: departmentId, hospitalId: staff.hospitalId, status: "active" }))) throw accessError(404, "Department not found");
    if (conversationType === "department" && staff.role !== "HOSPITAL_ADMIN" && !departmentMember(staff, departmentId)) throw accessError(403, "You cannot post in this department");
  }
  let recipientStaffId;
  if (conversationType === "direct" || payload.recipientStaffId) {
    recipientStaffId = requireRecordId(payload.recipientStaffId, "recipient staff");
    const recipient = await HospitalStaff.findOne({ _id: recipientStaffId, hospitalId: staff.hospitalId, isActive: true, inviteStatus: "accepted" });
    if (!recipient) throw accessError(404, "Recipient not found");
    if (token && !visitMessageAccess(recipient, token, messageType)) throw accessError(403, "Recipient cannot access this visit");
  }
  if (conversationType === "announcement" && (staff.role !== "HOSPITAL_ADMIN" || token)) {
    throw accessError(403, "Only hospital administrators can post nonclinical announcements");
  }
  return { hospitalId: staff.hospitalId, conversationType, content, messageType,
    tokenId: token?._id, patientId: token?.patientId, departmentId, recipientStaffId,
    sender: staffId(staff), senderName: staff.name || staff.firstName, senderRole: staff.role,
    readBy: [{ staffId: staffId(staff), readAt: new Date() }] };
};

export const canReadStaffMessage = async (staff, message) => {
  if (idOf(message.hospitalId) !== idOf(staff.hospitalId)) return false;
  if (message.conversationType === "direct" && ![idOf(message.sender), idOf(message.recipientStaffId)].includes(staffId(staff))) return false;
  if (message.conversationType === "direct" && !(await HospitalStaff.exists({ _id: message.recipientStaffId, hospitalId: staff.hospitalId }))) return false;
  if (!(await HospitalStaff.exists({ _id: message.sender, hospitalId: staff.hospitalId }))) return false;
  if (message.departmentId && !(await Department.exists({ _id: message.departmentId, hospitalId: staff.hospitalId }))) return false;
  if (message.conversationType === "department") {
    if (!message.departmentId || (staff.role !== "HOSPITAL_ADMIN" && !departmentMember(staff, message.departmentId))) return false;
  }
  if (message.tokenId) {
    const token = await OpdToken.findOne({ _id: message.tokenId, hospitalId: staff.hospitalId });
    if (!token || !visitMessageAccess(staff, token, message.messageType) || !(await validVisitReferences(token))) return false;
    if (message.patientId && idOf(token.patientId) !== idOf(message.patientId)) return false;
    if (message.departmentId && idOf(token.departmentId) !== idOf(message.departmentId)) return false;
  } else if (message.patientId || message.conversationType === "patient_context" || message.messageType === "lab_alert" || message.messageType === "vitals_ready") {
    return false; // Historical unscoped clinical announcements are not a valid visit authorization.
  }
  return ["direct", "department", "patient_context", "announcement"].includes(message.conversationType);
};

export const staffMessageFilter = async (staff) => {
  let visitFilter;
  if (staff.role === "DOCTOR") visitFilter = { doctorId: staffId(staff) };
  if (["NURSE", "DEPARTMENT_HEAD", "LAB_TECH"].includes(staff.role)) visitFilter = { departmentId: { $in: staff.departmentIds || [] } };
  const tokens = visitFilter ? await OpdToken.find({ hospitalId: staff.hospitalId, ...visitFilter }).select("_id").lean() : [];
  const branches = [
    { conversationType: "direct", $or: [{ sender: staffId(staff) }, { recipientStaffId: staffId(staff) }] },
    { conversationType: "announcement", tokenId: null, patientId: null, messageType: "text" },
    { conversationType: "department", ...(staff.role === "HOSPITAL_ADMIN" ? {} : { departmentId: { $in: staff.departmentIds || [] } }) },
  ];
  if (tokens.length) branches.push({ conversationType: "patient_context", tokenId: { $in: tokens.map((t) => t._id) },
    ...(staff.role === "LAB_TECH" ? { messageType: "lab_alert" } : {}) });
  return { hospitalId: staff.hospitalId, $or: branches };
};

export const messageForStaff = (message) => Object.fromEntries([
  "_id", "hospitalId", "conversationType", "content", "messageType", "tokenId", "patientId", "departmentId",
  "recipientStaffId", "sender", "senderName", "senderRole", "createdAt", "readBy",
].filter((key) => message[key] !== undefined).map((key) => [key, message[key]]));

export const emitStaffMessage = async (io, message) => {
  const recipients = await activeStaff(message.hospitalId).lean();
  for (const staff of recipients) {
    if (!(await canReadStaffMessage(staff, message))) continue;
    const target = io.to(staffRoom(message.hospitalId, staff._id));
    target.emit("staff:newMessage", messageForStaff(message));
    if (message.messageType === "lab_alert") target.emit("lab:order-received", messageForStaff(message));
  }
};
