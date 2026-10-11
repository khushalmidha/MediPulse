import User from "../model/user.js";
import Appointment from "../model/appointment.js";
import OpdToken from "../model/opdToken.js";
import { CareReservation } from "../model/scheduling.js";
import { moneyTransaction } from "./moneyTransaction.js";
import { accessError, requireRecordId, idOf } from "./hospitalAccess.js";
import { localServiceDate } from "./queueContext.js";

export const familyViews = user => {
  const rows = (user?.familyMembers || []).map(member => member.toObject ? member.toObject() : member);
  return { items: rows.filter(member => !member.archivedAt), archivedItems: rows.filter(member => member.archivedAt) };
};
export function normalizeFamilyProfile(input, today = localServiceDate(new Date(), "Asia/Kolkata")) {
  const name = typeof input?.name === "string" ? input.name.trim() : "", relation = typeof input?.relation === "string" ? input.relation.trim() : "";
  if (!name || name.length > 100 || !relation || relation.length > 60) throw accessError(400, "Enter a name and relationship within 100 and 60 characters");
  const member = { name, relation };
  if (input.dob !== undefined && input.dob !== null && input.dob !== "") {
    const date = input.dob;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today) throw accessError(400, "Date of birth must be a valid date that is not in the future");
    member.dob = new Date(date);
  }
  for (const [field, values] of [["gender", ["male", "female", "other"]], ["bloodGroup", ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]]]) {
    if (input[field] !== undefined && input[field] !== null && input[field] !== "") {
      if (!values.includes(input[field])) throw accessError(400, "Choose a listed " + field + " option");
      member[field] = input[field];
    }
  }
  return member;
}
export async function addPatientFamily(userId, input) {
  const member = normalizeFamilyProfile(input);
  const user = await User.findOneAndUpdate({ _id: requireRecordId(userId, "patient") }, { $push: { familyMembers: member }, $inc: { careIdentityRevision: 1 } }, { new: true, runValidators: true }).select("familyMembers");
  if (!user) throw accessError(404, "Patient account not found");
  return familyViews(user);
}
export async function archivePatientFamily(userId, familyId, now = new Date()) {
  const owner = requireRecordId(userId, "patient").toLowerCase(), memberId = requireRecordId(familyId, "family member").toLowerCase();
  return moneyTransaction(async session => {
    const user = await User.findOneAndUpdate({ _id: owner, "familyMembers._id": memberId }, { $inc: { careIdentityRevision: 1 } }, { new: true, session }).select("familyMembers");
    if (!user) throw accessError(404, "Family profile not found");
    const member = user.familyMembers.find(row => idOf(row._id) === memberId);
    if (member.archivedAt) return { ...familyViews(user), replay: true };
    // Sequential operations inside a transaction; no parallel session commands.
    if (await Appointment.exists({ user: owner, familyMemberId: memberId, status: { $in: ["booking", "queued", "active", "refund_pending"] } }).session(session)) throw accessError(409, "Complete or cancel this person's active visits before removing their booking profile");
    if (await OpdToken.exists({ patientId: owner, familyMemberId: memberId, status: { $in: ["booking", "reserved", "waiting", "vitals_done", "in_consultation", "refund_pending"] } }).session(session)) throw accessError(409, "Complete or cancel this person's active visits before removing their booking profile");
    if (await CareReservation.exists({ user: owner, familyMemberId: memberId, state: "held", expiresAt: { $gt: now } }).session(session)) throw accessError(409, "Cancel this person's held appointment before removing their booking profile");
    const updated = await User.findOneAndUpdate({ _id: owner, "familyMembers._id": memberId }, { $set: { "familyMembers.$.archivedAt": now } }, { new: true, session }).select("familyMembers");
    return { ...familyViews(updated), replay: false };
  });
}
