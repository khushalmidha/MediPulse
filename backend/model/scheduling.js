import mongoose from "mongoose";
const oid = mongoose.Schema.Types.ObjectId;
const options = { timestamps: true, autoIndex: false };
const sessionSchema = new mongoose.Schema({
  canonicalDoctorId: { type: oid, required: true }, doctorId: { type: oid, required: true },
  practiceKey: { type: String, required: true }, hospitalId: oid, departmentId: oid,
  appointmentType: { type: String, enum: ["scheduled_online", "online_opd", "hospital_in_person"], required: true },
  timezone: { type: String, required: true }, serviceDate: String, sessionId: String, queueKey: String,
  startsAt: { type: Date, required: true }, endsAt: { type: Date, required: true },
  breaks: [{ _id: false, startsAt: Date, endsAt: Date }],
  state: { type: String, enum: ["open", "paused"], default: "open" },
  feeMinor: { type: Number, required: true }, currency: { type: String, default: "INR" },
  policy: { holdMinutes: Number, cancelBeforeMinutes: Number, rescheduleBeforeMinutes: Number, checkInLeadMinutes: Number, checkInGraceMinutes: Number },
}, options);
sessionSchema.index({ canonicalDoctorId: 1, startsAt: 1, endsAt: 1 }, { name: "p09_doctor_sessions" });
sessionSchema.index({ practiceKey: 1, doctorId: 1, serviceDate: 1 }, { name: "p09_practice_availability" });
sessionSchema.index({ queueKey: 1 }, { unique: true, name: "p09_session_queue" });
const slotSchema = new mongoose.Schema({ session: { type: oid, required: true }, startsAt: Date, endsAt: Date,
  capacity: { type: Number, required: true }, occupied: { type: Number, default: 0, min: 0 } }, options);
slotSchema.index({ session: 1, startsAt: 1 }, { unique: true, name: "p09_session_slots" });
const reservationSchema = new mongoose.Schema({
  session: { type: oid, required: true }, slot: { type: oid, required: true }, canonicalDoctorId: oid,
  user: { type: oid, required: true }, familyMemberId: oid, personKey: { type: String, required: true },
  state: { type: String, enum: ["held", "confirmed", "expired", "cancelled", "completed"], required: true },
  expiresAt: Date, startsAt: Date, endsAt: Date, feeMinor: Number, currency: String,
  appointmentId: oid, tokenId: oid, revision: { type: Number, default: 0 },
}, options);
reservationSchema.index({ state: 1, expiresAt: 1 }, { name: "p09_expiring_holds" });
reservationSchema.index({ session: 1, state: 1 }, { name: "p09_session_reservations" });
reservationSchema.index({ user: 1, createdAt: -1 }, { name: "p09_user_visits" });
reservationSchema.index({ personKey: 1, state: 1, startsAt: 1, endsAt: 1 }, { name: "p09_patient_overlap" });
reservationSchema.index({ appointmentId: 1 }, { unique: true, sparse: true, name: "p09_reservation_appointment" });
const operationSchema = new mongoose.Schema({ actorKey: String, kind: String, requestKey: String,
  fingerprint: String, reservationId: oid }, options);
operationSchema.index({ actorKey: 1, kind: 1, requestKey: 1 }, { unique: true, name: "p09_request_identity" });
const lockSchema = new mongoose.Schema({ _id: String, revision: { type: Number, default: 0 } }, options);
const absenceSchema = new mongoose.Schema({ canonicalDoctorId: { type: oid, required: true },
  startsAt: Date, endsAt: Date, active: { type: Boolean, default: true } }, options);
absenceSchema.index({ canonicalDoctorId: 1, active: 1, startsAt: 1, endsAt: 1 }, { name: "p09_doctor_absence" });
export const CareSession = mongoose.model("CareSession", sessionSchema);
export const CareSlot = mongoose.model("CareSlot", slotSchema);
export const CareReservation = mongoose.model("CareReservation", reservationSchema);
export const ScheduleOperation = mongoose.model("ScheduleOperation", operationSchema);
export const ScheduleLock = mongoose.model("ScheduleLock", lockSchema);
export const DoctorAbsence = mongoose.model("DoctorAbsence", absenceSchema);
export const schedulingModels = [CareSession, CareSlot, CareReservation, ScheduleOperation, ScheduleLock, DoctorAbsence];
