import { accessError } from "./hospitalAccess.js";
import { localServiceDate } from "./queueContext.js";
export const defaultSchedulePolicy = { holdMinutes: 5, cancelBeforeMinutes: 0, rescheduleBeforeMinutes: 0, checkInLeadMinutes: 15, checkInGraceMinutes: 30 };
export const schedulePolicy = input => {
  const result = { ...defaultSchedulePolicy };
  if (input != null && (typeof input !== "object" || Array.isArray(input))) throw accessError(400, "Invalid scheduling policy");
  for (const key of Object.keys(input || {})) {
    if (!(key in result) || !Number.isInteger(input[key]) || input[key] < (key === "holdMinutes" ? 1 : 0) || input[key] > (key === "holdMinutes" ? 15 : 1440)) throw accessError(400, "Invalid scheduling policy");
    result[key] = input[key];
  }
  return result;
};
export const instant = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw accessError(400, "Use an ISO timestamp with an explicit offset");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw accessError(400, "Invalid timestamp");
  const time = value.slice(11, 19).split(":");
  if (Number(time[0]) > 23 || Number(time[1]) > 59 || Number(time[2] || 0) > 59) throw accessError(400, "Invalid clock time");
  // Date.parse normalizes impossible dates; reject those before applying the offset.
  const day = value.slice(0, 10);
  if (new Date(day + "T00:00:00Z").toISOString().slice(0, 10) !== day) throw accessError(400, "Invalid calendar date");
  return date;
};
export const overlaps = (a, b) => a.startsAt < b.endsAt && a.endsAt > b.startsAt;
export const sessionPlan = (input, now = new Date()) => {
  const startsAt = instant(input.startsAt), endsAt = instant(input.endsAt);
  if (startsAt <= now || endsAt <= startsAt || endsAt - startsAt > 12 * 3600000) throw accessError(400, "Session must start in the future and last at most 12 hours");
  if (startsAt - now > 366 * 86400000) throw accessError(400, "Session is outside the booking horizon");
  const timezone = input.timezone || "Asia/Kolkata", serviceDate = localServiceDate(startsAt, timezone);
  if (localServiceDate(new Date(endsAt.getTime() - 1), timezone) !== serviceDate) throw accessError(400, "Split sessions at the practice's local midnight");
  if (!Array.isArray(input.breaks || []) || (input.breaks || []).length > 20) throw accessError(400, "Invalid session breaks");
  const breaks = (input.breaks || []).map(item => ({ startsAt: instant(item.startsAt), endsAt: instant(item.endsAt) })).sort((a, b) => a.startsAt - b.startsAt);
  breaks.forEach((item, index) => { if (item.startsAt < startsAt || item.endsAt > endsAt || item.startsAt >= item.endsAt || (index && overlaps(item, breaks[index - 1]))) throw accessError(400, "Breaks must be disjoint and inside the session"); });
  const capacity = input.capacity ?? 1;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) throw accessError(400, "Capacity must be between 1 and 100");
  const minutes = input.appointmentType === "online_opd" ? null : input.slotMinutes ?? 15;
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 5 || minutes > 120)) throw accessError(400, "Slot duration must be between 5 and 120 minutes");
  const slots = [];
  if (minutes === null) {
    if (breaks.length) throw accessError(400, "Split online OPD windows around breaks");
    slots.push({ startsAt, endsAt, capacity });
  } else for (let start = startsAt.getTime(); start + minutes * 60000 <= endsAt.getTime(); start += minutes * 60000) {
    const slot = { startsAt: new Date(start), endsAt: new Date(start + minutes * 60000), capacity };
    if (!breaks.some(item => overlaps(slot, item))) slots.push(slot);
  }
  if (!slots.length) throw accessError(400, "Session has no bookable slots");
  return { startsAt, endsAt, timezone, serviceDate, breaks, slots, policy: schedulePolicy(input.policy) };
};
export const withinChangePolicy = (reservation, care, action, now = new Date()) => now < new Date(reservation.startsAt).getTime() - care.policy[(action === "cancel" ? "cancel" : "reschedule") + "BeforeMinutes"] * 60000;
export const admissionWindow = (reservation, care, now = new Date()) => {
  const start = new Date(reservation.startsAt).getTime() - care.policy.checkInLeadMinutes * 60000;
  const end = new Date(care.appointmentType === "online_opd" ? reservation.endsAt : reservation.startsAt).getTime() + care.policy.checkInGraceMinutes * 60000;
  return now.getTime() >= start && now.getTime() <= end;
};
