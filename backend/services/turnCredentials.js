import crypto from "node:crypto";
import Appointment from "../model/appointment.js";
import HospitalStaff from "../model/hospitalStaff.js";
import OpdToken from "../model/opdToken.js";
import { accessError, idOf, isRecordId } from "./hospitalAccess.js";
export const authorizeCall = async (appointmentId, actor) => {
  if (!isRecordId(appointmentId)) throw accessError(400, "Invalid appointment id");
  const appointment = await Appointment.findById(appointmentId).lean();
  if (!appointment) throw accessError(404, "Appointment not found");
  let allowed = actor.role === "user" && idOf(appointment.user) === actor.id || actor.role === "doctor" && idOf(appointment.doctor) === actor.id;
  if (actor.role === "doctor" && !allowed) {
    const staff = await HospitalStaff.findOne({ _id: appointment.doctor, doctorId: actor.id, role: "DOCTOR", isActive: true, inviteStatus: "accepted" });
    allowed = Boolean(staff && await OpdToken.exists({ appointmentId, doctorId: staff._id, hospitalId: staff.hospitalId, patientId: appointment.user }));
  }
  if (!allowed) throw accessError(403, "Forbidden appointment access");
  if (appointment.visitMode === "in_person" || !["queued", "active"].includes(appointment.status)) throw accessError(409, "This visit does not have an available online call");
  return appointment;
};
export const buildIceCredentials = (actorId, appointmentId, now = Date.now()) => {
  const iceServers = [], stun = (process.env.STUN_URLS ?? "stun:stun.l.google.com:19302").split(",").map(x => x.trim()).filter(Boolean);
  if (stun.length) iceServers.push({ urls: stun });
  const urls = (process.env.TURN_URLS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (urls.some(url => !/^turns?:[^\s]+$/.test(url))) throw new Error("Invalid TURN configuration");
  if (!urls.length) return { iceServers, relayConfigured: false, expiresAt: null };
  if (!process.env.TURN_SHARED_SECRET) throw new Error("TURN service is not configured");
  const ttl = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS || 600);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 3600) throw new Error("Invalid TURN credential duration");
  const expiry = Math.floor(now / 1000) + ttl, username = `${expiry}:${actorId}:${appointmentId}`;
  iceServers.push({ urls, username, credential: crypto.createHmac("sha1", process.env.TURN_SHARED_SECRET).update(username).digest("base64") });
  return { iceServers, relayConfigured: true, expiresAt: new Date(expiry * 1000).toISOString() };
};
export const getCallCredentials = async (req, res) => {
  await authorizeCall(req.params.appointmentId, req.auth);
  res.set("Cache-Control", "no-store").json(buildIceCredentials(req.auth.id, req.params.appointmentId));
};
