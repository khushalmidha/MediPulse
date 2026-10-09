export const careLabels = { scheduled_online: "Online appointment", online_opd: "Online OPD window", hospital_in_person: "Hospital visit", immediate: "Immediate online queue" };
export const doctorName = doctor => doctor?.fullName || doctor?.name || [doctor?.firstName, doctor?.lastName].filter(Boolean).join(" ") || "Doctor";
export const dateInZone = (date = new Date(), timezone = "Asia/Kolkata") => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(key => parts.find(part => part.type === key).value).join("-");
};
export const visitTime = (value, timezone = "Asia/Kolkata") => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-IN", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not recorded";
export const timeOfDay = (value, timezone) => new Intl.DateTimeFormat("en-IN", { timeZone: timezone || "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(value));
export const feeText = fee => Number.isFinite(fee?.amountMinor) ? new Intl.NumberFormat("en-IN", { style: "currency", currency: fee.currency || "INR", maximumFractionDigits: 2 }).format(fee.amountMinor / 100) : "Fee unavailable";
export const safeReturnPath = value => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || (value.includes("\\") || [...value].some(character => character.charCodeAt(0) <= 32))) return "/dashboard";
  const target = new URL(value, "https://medipulse.invalid");
  return target.origin === "https://medipulse.invalid" && !/^\/(?:login|signup)(?:\/|$)/.test(target.pathname) ? target.pathname + target.search + target.hash : "/dashboard";
};
export const canCheckIn = (visit, now = Date.now()) => {
  const { reservation, session, appointment } = visit || {};
  if (!reservation || !session || session.visitMode !== "online" || visit.doctorUnavailable || reservation.state !== "confirmed" || appointment?.admissionState !== "reserved" || appointment?.status !== "queued") return false;
  const start = Date.parse(reservation.startsAt) - (session.policy?.checkInLeadMinutes || 0) * 60000;
  const end = Date.parse(session.appointmentType === "online_opd" ? reservation.endsAt : reservation.startsAt) + (session.policy?.checkInGraceMinutes || 0) * 60000;
  return now >= start && now <= end;
};
const icsEscape = value => String(value || "").replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(";", "\\;").replaceAll(",", "\\,");
export const calendarReminder = (visit, now = new Date()) => {
  if (visit?.reservation?.state !== "confirmed") throw new Error("A confirmed visit is required");
  const stamp = value => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MediPulse//Care reminder//EN", "BEGIN:VEVENT", "UID:" + icsEscape(visit.reservation._id) + "@medipulse.live", "DTSTAMP:" + stamp(now), "DTSTART:" + stamp(visit.reservation.startsAt), "DTEND:" + stamp(visit.reservation.endsAt), "SUMMARY:MediPulse visit", "DESCRIPTION:" + icsEscape(visit.session.visitMode === "in_person" ? "Check in at hospital reception. Follow your reservation for current instructions." : "Sign in to MediPulse and check in online during your arrival window."), "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", "DESCRIPTION:MediPulse visit reminder", "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
};
export const downloadText = (name, text, type = "text/plain") => {
  const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement("a");
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
