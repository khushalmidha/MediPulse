import QueueRevision from "../model/queueRevision.js";
import { enqueueJob } from "./outbox.js";
export const readQueueRevision = async queueKey => queueKey ? (await QueueRevision.findById(queueKey).lean())?.revision || 0 : 0;
export const recordVisitEvent = async ({ token, appointment, action }, session) => {
  const visit = token || appointment;
  if (!visit?.queueKey) return;
  const revision = await QueueRevision.findOneAndUpdate({ _id: visit.queueKey }, { $inc: { revision: 1 } }, { upsert: true, new: true, session });
  const payload = { queueKey: visit.queueKey, queueRevision: revision.revision, action, appointmentId: appointment ? String(appointment._id) : undefined,
    tokenId: token ? String(token._id) : undefined, userId: token?.patientId || appointment?.user ? String(token?.patientId || appointment?.user) : undefined,
    hospitalId: token ? String(token.hospitalId) : undefined, doctorId: String(token?.doctorId || appointment?.doctor),
    revision: visit.revision, status: visit.status };
  const identity = `visit:${visit._id}:${visit.revision}:${action}`;
  await enqueueJob({ id: `${identity}:notify`, kind: "visit.notification", payload }, session);
  if (process.env.KAFKA_BROKERS) await enqueueJob({ id: `${identity}:event`, kind: "visit.event", payload }, session);
  if (payload.userId && ["booked", "start", "cancel", "no_show"].includes(action)) await enqueueJob({ id: `${identity}:mail`, kind: "visit.mail", payload, ...(action === "start" ? { expiresAt: new Date(Date.now() + 1800000) } : {}) }, session);
  if (action === "complete" && token?.patientId) await enqueueJob({ id: `review:${token._id}`, kind: "review.mail", payload: {
    tokenId: String(token._id), patientId: String(token.patientId), hospitalId: String(token.hospitalId) },
    availableAt: new Date(Date.now() + 1800000) }, session);
  return revision.revision;
};

export const withQueueRevision = async (queueKey, read) => {
  for (let i = 0; i < 5; i++) {
    const revision = await readQueueRevision(queueKey), snapshot = await read();
    if (revision === await readQueueRevision(queueKey)) return { ...snapshot, queueRevision: revision };
  }
  throw Object.assign(new Error("Queue changed; refresh status"), { status: 409 });
};
