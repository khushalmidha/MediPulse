import { idOf } from "./hospitalAccess.js";

// Private clinician DTO: expose the visited person, not every family profile.
export function visitPatientDisplay(appointment) {
  const familyMemberId = appointment.familyMemberId ? idOf(appointment.familyMemberId) : null;
  const account = appointment.user;
  const name = familyMemberId ? account?.familyMembers?.find(member => idOf(member._id) === familyMemberId)?.name : [account?.firstName, account?.lastName].filter(Boolean).join(" ");
  return { familyMemberId, patientDisplayName: typeof name === "string" && name.trim() ? name.trim() : null };
}
