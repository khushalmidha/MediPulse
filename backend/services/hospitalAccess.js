import Department from "../model/department.js";
import HospitalStaff from "../model/hospitalStaff.js";
import OpdToken from "../model/opdToken.js";
import User from "../model/user.js";

export const idOf = (value) => String(value?._id ?? value ?? "");
export const isRecordId = (value) => /^[a-f\d]{24}$/i.test(idOf(value));
export const accessError = (status, message) => Object.assign(new Error(message), { status });
export const requireRecordId = (value, label = "record") => {
  if (!isRecordId(value)) throw accessError(400, `Invalid ${label} id`);
  return idOf(value);
};

export const staffId = (staff) => idOf(staff?.id ?? staff?._id);
export const staffRoom = (hospitalId, actorId) => `staff:${idOf(hospitalId)}:${idOf(actorId)}`;
export const departmentMember = (staff, departmentId) =>
  (staff?.departmentIds || []).some((item) => idOf(item) === idOf(departmentId));

// Administrative portal access does not confer clinical access.
export const canAccessVisit = (staff, token, { clinical = false } = {}) => {
  if (!staff || idOf(staff.hospitalId) !== idOf(token?.hospitalId)) return false;
  if (staff.role === "DOCTOR") return staffId(staff) === idOf(token.doctorId);
  if (["NURSE", "DEPARTMENT_HEAD"].includes(staff.role)) return departmentMember(staff, token.departmentId);
  return !clinical && ["HOSPITAL_ADMIN", "RECEPTIONIST"].includes(staff.role);
};

export const assertVisitAccess = (staff, token, options) => {
  if (!canAccessVisit(staff, token, options)) throw accessError(403, "You cannot access this visit");
};

export const visitForStaff = (token, staff) => {
  assertVisitAccess(staff, token);
  const fields = ["_id", "hospitalId", "departmentId", "doctorId", "patientId", "familyMemberId",
    "tokenNumber", "displayToken", "date", "patientInfo", "visitType", "status", "arrivedAt",
    "vitalsCompletedAt", "consultationStartedAt", "consultationEndedAt", "estimatedWaitMinutes",
    "paymentStatus", "paymentAmount", "paymentMode", "appointmentId", "createdAt", "updatedAt", "queueKey", "practiceKey", "serviceDate", "sessionId", "timezone", "revision", "visitMode"];
  if (canAccessVisit(staff, token, { clinical: true })) {
    fields.push("chiefComplaint", "vitals", "aiTriage", "consultationNotes", "diagnosis", "followUpDate");
  }
  const view = Object.fromEntries(fields.filter((key) => token[key] !== undefined).map((key) => [key, token[key]]));
  if (token.patientInfo) view.patientInfo = Object.fromEntries(["name", "phone", "age", "gender", "isWalkIn"]
    .filter((key) => token.patientInfo[key] !== undefined).map((key) => [key, token.patientInfo[key]]));
  return view;
};

export const resolveBookingIdentity = async (req, patientId, familyMemberId) => {
  if (!req.staff && req.auth?.role !== "user") throw accessError(403, "Patient account required");
  const ownerId = req.staff ? (patientId ? requireRecordId(patientId, "patient") : undefined) : requireRecordId(req.auth.id, "patient");
  if (!req.staff && patientId && idOf(patientId) !== ownerId) throw accessError(403, "You can only book for your own account");
  if (familyMemberId && !ownerId) throw accessError(400, "A family member requires a patient account");
  if (ownerId && (req.staff || familyMemberId)) {
    const filter = { _id: ownerId };
    if (familyMemberId) filter["familyMembers._id"] = requireRecordId(familyMemberId, "family member");
    if (!(await User.exists(filter))) throw accessError(403, "Patient or family member is not available to this booking");
  }
  return { patientId: ownerId, familyMemberId: familyMemberId ? idOf(familyMemberId) : undefined };
};

export const validateDepartmentIds = async (hospitalId, ids) => {
  if (!Array.isArray(ids)) throw accessError(400, "Department ids must be an array");
  const normalized = [...new Set(ids.map((id) => requireRecordId(id, "department")))];
  if (normalized.length && await Department.countDocuments({ _id: { $in: normalized }, hospitalId }) !== normalized.length) {
    throw accessError(403, "Departments must belong to this hospital");
  }
  return normalized;
};

export const validateDepartmentReferences = async (hospitalId, update, departmentId) => {
  const ids = new Set();
  if (update.headDoctorId) ids.add(requireRecordId(update.headDoctorId, "head doctor"));
  if (update.opd?.timings !== undefined) {
    if (!Array.isArray(update.opd.timings)) throw accessError(400, "OPD timings must be an array");
    for (const timing of update.opd.timings) {
      if (!Array.isArray(timing.doctorIds || [])) throw accessError(400, "Timing doctor ids must be an array");
      for (const id of timing.doctorIds || []) ids.add(requireRecordId(id, "doctor"));
    }
  }
  if (!ids.size) return;
  const filter = { _id: { $in: [...ids] }, hospitalId, role: "DOCTOR", isActive: true, inviteStatus: "accepted" };
  if (departmentId) filter.departmentIds = departmentId;
  if (await HospitalStaff.countDocuments(filter) !== ids.size) throw accessError(403, "Doctors must be assigned to this hospital department");
};

export const loadVisit = async (staff, tokenId, options) => {
  requireRecordId(tokenId, "token");
  const token = await OpdToken.findOne({ _id: tokenId, hospitalId: staff.hospitalId });
  if (!token) throw accessError(404, "Visit not found");
  assertVisitAccess(staff, token, options);
  if (!(await validVisitReferences(token))) throw accessError(403, "Visit references do not belong to this hospital department");
  return token;
};

export const validVisitReferences = async (token) => Boolean(
  await Department.exists({ _id: token.departmentId, hospitalId: token.hospitalId })
  && await HospitalStaff.exists({ _id: token.doctorId, hospitalId: token.hospitalId, departmentIds: token.departmentId, role: "DOCTOR" }),
);

export const activeStaff = (hospitalId) => HospitalStaff.find({ hospitalId, isActive: true, inviteStatus: "accepted" });

// Event payloads are refresh signals. Clinical records are retrieved through authorized HTTP APIs.
export const emitOpdEvent = async (io, event, token) => {
  if (!io) return;
  const recipients = await activeStaff(token.hospitalId).lean();
  const clinical = event === "opd:vitals-ready" || event === "opd:brief-ready";
  const summary = Object.fromEntries(["_id", "hospitalId", "departmentId", "doctorId", "displayToken", "status", "queueKey", "revision"]
    .filter((key) => token[key] !== undefined).map((key) => [key, token[key]]));
  for (const staff of recipients) {
    if (canAccessVisit(staff, token, { clinical })) {
      io.to(staffRoom(token.hospitalId, staff._id)).emit(event, { tokenId: token._id, displayToken: token.displayToken, token: summary });
    }
  }
};
