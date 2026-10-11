import User from "../model/user.js";
import { accessError, requireRecordId, activeFamilyFilter } from "./hospitalAccess.js";
export { activeFamilyFilter };

// Booking and family archival write the same account row in their transaction.
// Mongo retries conflicting writers, so membership cannot disappear mid-booking.
export async function lockPatientIdentity(userId, familyMemberId, session) {
  if (!session) throw new Error("Patient identity lock requires a transaction");
  const query = { _id: requireRecordId(userId, "patient"), ...(familyMemberId ? { familyMembers: activeFamilyFilter(familyMemberId) } : {}) };
  const user = await User.findOneAndUpdate(query, { $inc: { careIdentityRevision: 1 } }, { session, new: true }).select("familyMembers");
  if (!user) throw accessError(403, "Patient or active family profile is not available to this booking");
  return user;
}
