export const consultationDurationMs = () => {
  const minutes = Number(process.env.CONSULTATION_DURATION_MINUTES || 0);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 480) throw new Error("CONSULTATION_DURATION_MINUTES must be between 0 and 480");
  return minutes * 60000;
};
export const consultationDeadline = (appointment, startedAt = new Date()) => {
  const duration = consultationDurationMs();
  return appointment?.visitMode === "in_person" || !duration ? null : new Date(startedAt.getTime() + duration);
};
export const autoRefundDeadline = (appointment, now = new Date()) => appointment?.visitMode !== "in_person" && appointment?.payment?.paidAt && appointment?.admissionState !== "reserved"
  ? new Date(Math.max(now.getTime(), appointment?.scheduledStart ? new Date(appointment.scheduledStart).getTime() : 0) + 1800000) : null;
