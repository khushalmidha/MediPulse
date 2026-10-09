import { accessError, idOf } from "./hospitalAccess.js";

export const liveTokenStatuses = ["booking", "reserved", "waiting", "vitals_done", "in_consultation", "refund_pending"];
export const liveAppointmentStatuses = ["booking", "queued", "active", "refund_pending"];
export const localServiceDate = (date = new Date(), timezone = "Asia/Kolkata") => {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const get = (name) => parts.find((part) => part.type === name).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch { throw accessError(400, "Invalid queue timezone or date"); }
};

export const queueContext = ({ hospital, doctorId, doctor, sessionId, serviceDate, now = new Date(), historical = false }) => {
  const timezone = hospital?.settings?.timezone || doctor?.queueTimezone || "Asia/Kolkata";
  const sessions = hospital?.settings?.queueSessionIds || doctor?.queueSessionIds || ["day"];
  const session = sessionId || sessions[0] || "day";
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(session) || !sessions.includes(session)) throw accessError(400, "Unknown care session");
  const today = localServiceDate(now, timezone);
  const date = serviceDate || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw accessError(400, "Invalid service date");
  if (!historical && date !== today) throw accessError(409, "This endpoint books only the current service date");
  const practiceKey = hospital ? `hospital:${idOf(hospital)}` : `independent:${idOf(doctorId)}`;
  return { practiceType: hospital ? "hospital" : "independent", ...(hospital ? { hospitalId: idOf(hospital) } : {}), visitMode: hospital ? "in_person" : "online", practiceKey, serviceDate: date, sessionId: session, timezone,
    queueKey: `${practiceKey}:${idOf(doctorId)}:${date}:${session}` };
};
export const patientKey = (owner, family) => `${idOf(owner)}:${idOf(family) || "self"}`;
export const requireQueueContext = (record) => {
  if (!record?.queueKey || !record.serviceDate || !record.sessionId || !record.personKey) throw accessError(409, "Queue data migration is required");
};
export const opdCacheKey = (context) => `opd:queue:p03:${context.queueKey}`;
export const invalidateVisitQueue = async (token, redis) => {
  await redis.del(`hospital:queue-status:${idOf(token.hospitalId)}:p03:${token.serviceDate}`, opdCacheKey(token), `hospital:queue-status:${idOf(token.hospitalId)}`,
    `opd:queue:${idOf(token.doctorId)}:${token.serviceDate}`, `opd:queue:${idOf(token.doctorId)}:${token.serviceDate}:p01`);
};

export const validateRequestedContext = (body, context) => {
  for (const key of ["practiceType", "practiceKey", "hospitalId", "visitMode", "queueKey"]) {
    if (body?.[key] !== undefined && String(body[key]) !== String(context[key] ?? "")) throw accessError(409, "Requested care context does not match this booking endpoint");
  }
};
export const explicitPractice = row => ({ practiceType: row.practiceKey?.startsWith("hospital:") ? "hospital" : "independent",
  ...(row.practiceKey?.startsWith("hospital:") ? { hospitalId: row.practiceKey.split(":")[1] } : {}), visitMode: row.visitMode || (row.practiceKey?.startsWith("hospital:") ? "in_person" : "online") });
