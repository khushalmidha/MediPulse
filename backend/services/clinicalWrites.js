import crypto from "node:crypto";
import Appointment from "../model/appointment.js";
import { accessError } from "./hospitalAccess.js";

export const clinicalRevision = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw accessError(400, "A valid visit revision is required. Refresh the consultation.");
  return value;
};
export const clinicalNotes = value => {
  if (typeof value !== "string" || value.length > 12000) throw accessError(400, "Doctor notes must be text of at most 12000 characters.");
  return value.trim();
};
export const notesHash = text => crypto.createHash("sha256").update(text || "").digest("hex");
export const checkClinicalEdit = (appointment, revision, completed = false) => {
  clinicalRevision(revision);
  if (!appointment || !["active", ...(completed ? ["completed"] : [])].includes(appointment.status)) throw accessError(409, "This visit is not eligible for this clinical edit.");
  if ((appointment.revision || 0) !== revision) throw accessError(409, "Visit changed. Refresh and reconcile your draft before saving.");
};
// Every edit and its prior clinical snapshot commit in the same document update.
export async function commitClinicalEdit({ appointment, revision, actorId, fields, unset = [], reason, completed = false, condition = {} }) {
  checkClinicalEdit(appointment, revision, completed);
  const prior = appointment.toObject ? appointment.toObject() : appointment;
  const filter = { _id: appointment._id, doctor: appointment.doctor?._id || appointment.doctor,
    status: appointment.status, ...condition, ...(revision === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision }) };
  const update = { $set: fields, $inc: { revision: 1 }, $push: { clinicalHistory: {
    revision, doctorNotes: prior.doctorNotes || "", soapNote: prior.soapNote || null,
    receiptText: prior.receiptText || "", receiptGeneratedAt: prior.receiptGeneratedAt || null,
    actorId, reason, recordedAt: new Date(),
  } } };
  if (unset.length) update.$unset = Object.fromEntries(unset.map(key => [key, ""]));
  const changed = await Appointment.findOneAndUpdate(filter, update, { new: true, runValidators: true });
  if (!changed) throw accessError(409, "Visit changed. Refresh and reconcile your draft before saving.");
  return changed;
}
export const invalidateSoap = () => ({ "soapNote.isDraft": true, "soapNote.clinicianApproved": false });
export const soapApprovalFields = ["soapNote.approvedBy", "soapNote.approvedAt"];
