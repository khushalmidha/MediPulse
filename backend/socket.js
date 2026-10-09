import { resolveSession, onSessionRevoked } from "./services/authSessions.js";
import { canAccessCommunity, createCommunityMessage, broadcastCommunity } from "./services/communityAccess.js";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import cookie from "cookie";
import { isAllowedOrigin } from "./config/corsOrigins.js";
import HospitalStaff from "./model/hospitalStaff.js";
import StaffMessage from "./model/staffMessage.js";
import Community from "./model/community.js";
import Appointment from "./model/appointment.js";
import OpdToken from "./model/opdToken.js";
import { idOf, isRecordId, staffRoom } from "./services/hospitalAccess.js";
import { prepareStaffMessage, emitStaffMessage } from "./services/staffMessaging.js";

let ioInstance = null;


export function getIO() {
  return ioInstance;
}

/**
 * Initialize Socket.IO on the given HTTP server.
 * Returns the io instance so it can be used elsewhere if needed.
 */
const permissionSignature = (principal, kind) => JSON.stringify([kind, principal.role, idOf(principal.hospitalId),
  (principal.departmentIds || []).map(idOf).sort(), idOf(principal.doctorId)]);
export function initSocket(server) {
  if (Number(process.env.API_INSTANCES || 1) !== 1) throw new Error("Multiple API instances require a configured Socket.IO adapter");
  const appointmentPresence = new Map();
  const io = new Server(server, {
    allowRequest: (req, callback) => {
      let requestOrigin = req.headers.origin;
      if (!requestOrigin && req.headers["sec-fetch-site"] === "same-origin") {
        try { requestOrigin = new URL(req.headers.referer).origin; } catch {}
      }
      callback(null, isAllowedOrigin(requestOrigin) && (Boolean(requestOrigin) || !req.headers.cookie));
    },
    cors: {
      origin(origin, callback) {
        if (isAllowedOrigin(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Socket CORS blocked origin: ${origin}`));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
  });
  ioInstance = io;

  // ── Authentication middleware ──────────────────────────────
  io.use(async (socket, next) => {
    try {
      const scope = socket.handshake.auth?.scope === "staff" ? "staff" : "account";
      const cookies = cookie.parse(socket.handshake.headers.cookie || "");
      const token = socket.handshake.auth?.token || cookies[scope === "staff" ? "staffToken" : "token"];
      if (!token) return next(new Error("Authentication error"));
      // Explicit bearer clients select scope from their signed claim; browser clients supply scope only.
      const selectedScope = socket.handshake.auth?.token && jwt.decode(token)?.type === "staff" ? "staff" : scope;
      const { principal, kind, session } = await resolveSession(token, selectedScope);
      socket.data.sessionToken = token;
      socket.data.sessionScope = selectedScope;
      socket.data.sessionId = session._id;
      socket.data.permissions = permissionSignature(principal, kind);
      socket.data.communityActor = { id: String(principal._id), role: kind, name: principal.firstName };
      if (kind === "staff") {
        socket.user = { _id: idOf(principal), firstName: principal.name, role: principal.role, type: "staff",
          hospitalId: idOf(principal.hospitalId), departmentIds: (principal.departmentIds || []).map(idOf),
          doctorId: principal.doctorId ? idOf(principal.doctorId) : null };
      } else socket.user = { _id: idOf(principal), firstName: principal.firstName, role: kind };
      next();
    } catch (err) {
      next(new Error("Authentication error"));
    }
  });

  const unsubscribe = onSessionRevoked(sid => {
    for (const socket of io.sockets.sockets.values()) if (socket.data.sessionId === sid) socket.disconnect(true);
  });
  const sessionPoll = setInterval(async () => {
    for (const socket of io.sockets.sockets.values()) {
      try { const { principal, kind } = await resolveSession(socket.data.sessionToken, socket.data.sessionScope);
        if (permissionSignature(principal, kind) !== socket.data.permissions) socket.disconnect(true); }
      catch { socket.disconnect(true); }
    }
  }, 5000);
  sessionPoll.unref();
  server.once("close", () => { clearInterval(sessionPoll); unsubscribe(); });

  // ── Connection handler ────────────────────────────────────
  io.on("connection", (socket) => {
    socket.use(async (packet, next) => {
      try { const { principal, kind } = await resolveSession(socket.data.sessionToken, socket.data.sessionScope);
        if (permissionSignature(principal, kind) !== socket.data.permissions) { socket.disconnect(true); return; } next(); }
      catch { const ack = packet.at(-1); if (typeof ack === "function") ack({ ok: false, message: "Session has ended" }); socket.disconnect(true); }
    });
    const currentStaff = () => HospitalStaff.findOne({ _id: socket.user._id, hospitalId: socket.user.hospitalId, isActive: true, inviteStatus: "accepted" });
    if (socket.user.type === "staff") {
      socket.join(staffRoom(socket.user.hospitalId, socket.user._id));
    } else {
      socket.join(`${socket.user.role}:${socket.user._id}`);
    }

    socket.on("staff:joinHospital", async (payload, callback) => {
      try {
        const { hospitalId } = payload || {};
        if (socket.user.type !== "staff" || hospitalId !== socket.user.hospitalId || !(await currentStaff())) {
          if (typeof callback === "function") callback({ ok: false, message: "Invalid hospital staff session" });
          return;
        }
        socket.join(staffRoom(hospitalId, socket.user._id));
        if (typeof callback === "function") callback({ ok: true });
      } catch { if (typeof callback === "function") callback({ ok: false, message: "Unable to join staff session" }); }
    });

    socket.on("staff:sendMessage", async (payload = {}, callback) => {
      try {
        const staff = socket.user.type === "staff" ? await currentStaff() : null;
        if (!staff) {
          if (typeof callback === "function") callback({ ok: false, message: "Active staff session required" });
          return;
        }
        const message = await StaffMessage.create(await prepareStaffMessage(staff, payload));
        await emitStaffMessage(io, message);
        if (typeof callback === "function") callback({ ok: true });
      } catch (error) {
        if (typeof callback === "function") callback({ ok: false, message: error.status ? error.message : "Could not send staff message" });
      }
    });

    // Community IDs must be real memberships, never arbitrary Socket.IO room names.
    const communityAccess = async (communityId) => {
      if (!isRecordId(communityId)) return false;
      return canAccessCommunity(await Community.findById(communityId), socket.data.communityActor);
    };
    // ── Join a community room ─────────────────────────────
    socket.on("joinCommunity", async (communityId, callback) => {
      try {
        if (!(await communityAccess(communityId))) {
          if (typeof callback === "function") callback({ ok: false, message: "Community access required" });
          return;
        }
        socket.join(communityId);
        if (typeof callback === "function") callback({ ok: true });
      } catch { if (typeof callback === "function") callback({ ok: false, message: "Unable to join community" }); }
    });
    socket.on("leaveCommunity", (communityId) => {
      if (isRecordId(communityId)) socket.leave(communityId);
    });
    socket.on("sendMessage", async (payload, callback) => {
      try {
        const { communityId, content } = payload || {};
        const msg = await createCommunityMessage(communityId, content, socket.data.communityActor);
        await broadcastCommunity(io, communityId, "newMessage", msg);
        if (typeof callback === "function") callback({ ok: true, messageId: String(msg._id) });
      } catch (error) { if (typeof callback === "function") callback({ ok: false, message: error.status ? error.message : "Unable to send message" }); }
    });
    for (const [event, outbound] of [["typing", "userTyping"], ["stopTyping", "userStopTyping"]]) {
      socket.on(event, async (payload) => {
        try {
          const { communityId } = payload || {};
          if (await communityAccess(communityId)) await broadcastCommunity(io, communityId, outbound,
            { userId: socket.user._id, userName: socket.user.firstName }, socket.id);
        } catch { /* Do not disclose room existence. */ }
      });
    }

    const appointmentAccess = async (appointment) => {
      if (socket.user.type === "staff") {
        const staff = await currentStaff();
        return staff?.role === "DOCTOR" && idOf(staff.doctorId) === idOf(appointment.doctor)
          && Boolean(await OpdToken.exists({ appointmentId: appointment._id, hospitalId: staff.hospitalId, doctorId: staff._id, patientId: appointment.user }));
      }
      return (socket.user.role === "doctor" && idOf(appointment.doctor) === socket.user._id)
        || (socket.user.role === "user" && idOf(appointment.user) === socket.user._id);
    };
    socket.on("joinAppointmentRoom", async (payload, callback) => {
      try {
      const { appointmentId } = payload || {};
      if (!isRecordId(appointmentId)) {
        if (typeof callback === "function") callback({ ok: false, message: "Appointment id is required" });
        return;
      }

      const appointment = await Appointment.findById(appointmentId);
      if (!appointment) {
        if (typeof callback === "function") callback({ ok: false, message: "Appointment not found" });
        return;
      }

      if (!(await appointmentAccess(appointment))) {
        if (typeof callback === "function") callback({ ok: false, message: "Forbidden appointment access" });
        return;
      }

      if (appointment.visitMode === "in_person") {
        if (typeof callback === "function") callback({ ok: false, message: "This is an in-person visit" });
        return;
      }
      if (!["queued", "active"].includes(appointment.status)) {
        if (typeof callback === "function") callback({ ok: false, message: "Appointment has already ended" });
        return;
      }

      const roomName = `appointment:${appointmentId}`;
      socket.join(roomName);
      const presence = appointmentPresence.get(String(appointmentId)) || { doctorJoined: false, patientJoined: false, sockets: new Map() };
      presence.sockets.set(socket.id, socket.user.role);
      if (socket.user.role === "doctor" || socket.user.role === "DOCTOR") presence.doctorJoined = true;
      if (socket.user.role === "user") presence.patientJoined = true;
      appointmentPresence.set(String(appointmentId), presence);
      const ready = presence.doctorJoined && presence.patientJoined;

      // FIXED: Call negotiation could start with only one participant present, causing a blank remote video panel.
      io.to(roomName).emit("appointment:presence", {
        appointmentId,
        doctorJoined: presence.doctorJoined,
        patientJoined: presence.patientJoined,
        ready,
      });
      socket.to(roomName).emit("appointment:peer-joined", {
        appointmentId,
        peerId: socket.id,
        peerRole: socket.user.role,
        ready,
      });

      if (typeof callback === "function") callback({ ok: true, status: appointment.status, revision: appointment.revision, doctorJoined: presence.doctorJoined, patientJoined: presence.patientJoined, ready });
      } catch { if (typeof callback === "function") callback({ ok: false, message: "Unable to join appointment" }); }
    });

    socket.on("leaveAppointmentRoom", (payload) => {
      const { appointmentId } = payload || {};
      if (!isRecordId(appointmentId) || !socket.rooms.has(`appointment:${appointmentId}`)) return;
      const roomName = `appointment:${appointmentId}`;
      socket.leave(roomName);
      const presence = appointmentPresence.get(String(appointmentId));
      if (!presence) return;
      presence.sockets.delete(socket.id);
      presence.doctorJoined = [...presence.sockets.values()].some(r => r === "doctor" || r === "DOCTOR");
      presence.patientJoined = [...presence.sockets.values()].includes("user");
      if (!presence.sockets.size) {
        appointmentPresence.delete(String(appointmentId));
        return;
      }
      appointmentPresence.set(String(appointmentId), presence);
      io.to(roomName).emit("appointment:presence", {
        appointmentId,
        doctorJoined: presence.doctorJoined,
        patientJoined: presence.patientJoined,
        ready: presence.doctorJoined && presence.patientJoined,
      });
    });

    const authorizedMember = async (appointmentId) => {
      if (!isRecordId(appointmentId) || !socket.rooms.has(`appointment:${appointmentId}`)) return false;
      const appointment = await Appointment.findById(appointmentId);
      return appointment && ["queued", "active"].includes(appointment.status) && await appointmentAccess(appointment);
    };
    for (const [event, field] of [["appointment:offer", "sdp"], ["appointment:answer", "sdp"], ["appointment:ice-candidate", "candidate"]]) {
      socket.on(event, async (payload = {}) => {
        try {
          if (payload[field] && await authorizedMember(payload.appointmentId)) socket.to(`appointment:${payload.appointmentId}`).emit(event, { appointmentId: payload.appointmentId, [field]: payload[field] });
        } catch { /* Invalid sessions cannot relay signaling. */ }
      });
    }
    socket.on("appointment:chat-message", async (message = {}) => {
      try {
        if (await authorizedMember(message.appointmentId)) socket.to(`appointment:${message.appointmentId}`).emit("appointment:chat-message", {
          appointmentId: message.appointmentId, text: message.text, message: message.message, content: message.content,
          senderId: socket.user._id, senderRole: socket.user.role, timestamp: new Date().toISOString(),
        });
      } catch { /* Unauthorized senders cannot inject call messages. */ }
    });
    socket.on("appointment:renegotiate", async (payload = {}) => {
      try { if (await authorizedMember(payload.appointmentId)) socket.to(`appointment:${payload.appointmentId}`).emit("appointment:renegotiate", { appointmentId: payload.appointmentId }); }
      catch { /* Session refresh and visit authorization apply to reconnects too. */ }
    });
    // An End button must commit the authorized REST transition. Signaling cannot end a visit.
    socket.on("appointment:end", (_payload, callback) => {
      if (typeof callback === "function") callback({ ok: false, message: "Use the appointment end API" });
    });

    // ── Disconnect ────────────────────────────────────────
    socket.on("disconnect", () => {
      for (const [appointmentId, presence] of appointmentPresence.entries()) {
        if (!presence.sockets.has(socket.id)) continue;
        presence.sockets.delete(socket.id);
        presence.doctorJoined = [...presence.sockets.values()].some(r => r === "doctor" || r === "DOCTOR");
        presence.patientJoined = [...presence.sockets.values()].includes("user");
        if (!presence.sockets.size) {
          appointmentPresence.delete(appointmentId);
        } else {
          io.to(`appointment:${appointmentId}`).emit("appointment:presence", {
            appointmentId,
            doctorJoined: presence.doctorJoined,
            patientJoined: presence.patientJoined,
            ready: presence.doctorJoined && presence.patientJoined,
          });
        }
      }

    });
  });

  return io;
}
