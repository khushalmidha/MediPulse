import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import cookie from "cookie";
import { isAllowedOrigin } from "./config/corsOrigins.js";
import User from "./model/user.js";
import Doctor from "./model/doctor.js";
import HospitalStaff from "./model/hospitalStaff.js";
import StaffMessage from "./model/staffMessage.js";
import Message from "./model/message.js";
import Community from "./model/community.js";
import Appointment from "./model/appointment.js";

let ioInstance = null;
const appointmentPresence = new Map();

export function getIO() {
  return ioInstance;
}

/**
 * Initialize Socket.IO on the given HTTP server.
 * Returns the io instance so it can be used elsewhere if needed.
 */
export function initSocket(server) {
  const io = new Server(server, {
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
      // Try token from auth option first (cross-origin), then fall back to cookies
      let token = socket.handshake.auth?.token;

      if (!token) {
        const rawCookies = socket.handshake.headers.cookie;
        if (rawCookies) {
          const cookies = cookie.parse(rawCookies);
          token = cookies.staffToken || cookies.token;
        }
      }

      if (!token) return next(new Error("Authentication error"));

      jwt.verify(token, process.env.TOKEN_KEY, async (err, data) => {
        if (err) return next(new Error("Authentication error"));

        if (data.type === "staff") {
          const staff = await HospitalStaff.findOne({ _id: data.id, hospitalId: data.hospitalId, isActive: true });
          if (!staff) return next(new Error("Authentication error"));
          socket.user = {
            _id: staff._id.toString(),
            firstName: staff.name,
            role: staff.role,
            type: "staff",
            hospitalId: staff.hospitalId.toString(),
            departmentIds: staff.departmentIds.map((departmentId) => departmentId.toString()),
            doctorId: staff.doctorId ? staff.doctorId.toString() : null,
          };
          return next();
        }

        const user = await (data.role === "user" ? User : Doctor).findById(data.id);
        if (!user) return next(new Error("Authentication error"));

        // Attach user info to the socket for later use
        socket.user = {
          _id: user._id.toString(),
          firstName: user.firstName,
          role: data.role,
        };
        next();
      });
    } catch (err) {
      next(new Error("Authentication error"));
    }
  });

  // ── Connection handler ────────────────────────────────────
  io.on("connection", (socket) => {
    console.log(`⚡ Socket connected: ${socket.user.firstName} (${socket.id})`);
    socket.join(`${socket.user.role}:${socket.user._id}`);
    if (socket.user.type === "staff") {
      socket.join(`hospital:${socket.user.hospitalId}`);
      socket.join(`doctor:${socket.user._id}`);
      socket.user.departmentIds.forEach((departmentId) => socket.join(`dept:${departmentId}`));
      if (socket.user.role === "LAB_TECH") socket.join(`staff:lab:${socket.user.hospitalId}`);
    }

    socket.on("staff:joinHospital", ({ hospitalId } = {}, callback) => {
      if (socket.user.type !== "staff" || hospitalId !== socket.user.hospitalId) {
        if (callback) callback({ ok: false, message: "Invalid hospital staff room" });
        return;
      }

      socket.join(`hospital:${hospitalId}`);
      socket.join(`doctor:${socket.user._id}`);
      socket.user.departmentIds.forEach((departmentId) => socket.join(`dept:${departmentId}`));
      if (socket.user.role === "LAB_TECH") socket.join(`staff:lab:${hospitalId}`);
      if (callback) callback({ ok: true });
    });

    socket.on("staff:sendMessage", async (payload = {}, callback) => {
      try {
        if (socket.user.type !== "staff") {
          if (callback) callback({ ok: false, message: "Staff session required" });
          return;
        }

        const {
          hospitalId,
          conversationType,
          content,
          tokenId,
          patientId,
          departmentId,
          recipientStaffId,
          messageType = "text",
          metadata,
        } = payload;
        const trimmedContent = String(content || "").trim();

        if (hospitalId !== socket.user.hospitalId) {
          if (callback) callback({ ok: false, message: "Invalid hospital" });
          return;
        }

        if (!["direct", "patient_context", "department", "announcement"].includes(conversationType) || !trimmedContent) {
          if (callback) callback({ ok: false, message: "Message type and content are required" });
          return;
        }

        if (conversationType === "department" && !socket.user.departmentIds.includes(departmentId) && socket.user.role !== "HOSPITAL_ADMIN") {
          if (callback) callback({ ok: false, message: "You cannot post in this department" });
          return;
        }

        if (conversationType === "direct" && !recipientStaffId) {
          if (callback) callback({ ok: false, message: "Recipient is required" });
          return;
        }

        const staffMessage = await StaffMessage.create({
          hospitalId,
          conversationType,
          tokenId,
          patientId,
          departmentId,
          recipientStaffId,
          sender: socket.user._id,
          senderName: socket.user.firstName,
          senderRole: socket.user.role,
          content: trimmedContent,
          messageType,
          metadata,
          readBy: [{ staffId: socket.user._id, readAt: new Date() }],
        });

        const messagePayload = {
          _id: staffMessage._id,
          hospitalId: staffMessage.hospitalId,
          conversationType: staffMessage.conversationType,
          tokenId: staffMessage.tokenId,
          patientId: staffMessage.patientId,
          departmentId: staffMessage.departmentId,
          recipientStaffId: staffMessage.recipientStaffId,
          sender: staffMessage.sender,
          senderName: staffMessage.senderName,
          senderRole: staffMessage.senderRole,
          content: staffMessage.content,
          messageType: staffMessage.messageType,
          metadata: staffMessage.metadata,
          createdAt: staffMessage.createdAt,
        };

        if (conversationType === "direct") {
          io.to(`doctor:${recipientStaffId}`).to(`doctor:${socket.user._id}`).emit("staff:newMessage", messagePayload);
        } else if (conversationType === "department") {
          io.to(`dept:${departmentId}`).emit("staff:newMessage", messagePayload);
        } else {
          io.to(`hospital:${hospitalId}`).emit("staff:newMessage", messagePayload);
        }

        if (messageType === "lab_alert") {
          io.to(`staff:lab:${hospitalId}`).emit("lab:order-received", messagePayload);
        }

        if (callback) callback({ ok: true, message: messagePayload });
      } catch (err) {
        console.error("Error sending staff message via socket:", err);
        if (callback) callback({ ok: false, message: "Could not send staff message" });
      }
    });

    // ── Join a community room ─────────────────────────────
    socket.on("joinCommunity", (communityId) => {
      socket.join(communityId);
      console.log(
        `${socket.user.firstName} joined community room: ${communityId}`
      );
    });

    // ── Leave a community room ────────────────────────────
    socket.on("leaveCommunity", (communityId) => {
      socket.leave(communityId);
      console.log(
        `${socket.user.firstName} left community room: ${communityId}`
      );
    });

    // ── Send a message ────────────────────────────────────
    socket.on("sendMessage", async ({ communityId, content }) => {
      try {
        if (!content || !communityId) return;

        const community = await Community.findById(communityId);
        if (!community) return;

        // Persist message in the database
        const msg = await Message.create({
          author: socket.user._id,
          author_name: socket.user.firstName,
          content: content.trim(),
          community: communityId,
        });

        const messagePayload = {
          _id: msg._id,
          author: msg.author,
          author_name: msg.author_name,
          content: msg.content,
          community: msg.community,
          createdAt: msg.createdAt,
          updatedAt: msg.updatedAt,
        };

        // Broadcast to every client in the room (including sender)
        io.to(communityId).emit("newMessage", messagePayload);
      } catch (err) {
        console.error("Error sending message via socket:", err);
      }
    });

    // ── Typing indicators (optional enhancement) ──────────
    socket.on("typing", ({ communityId }) => {
      socket.to(communityId).emit("userTyping", {
        userId: socket.user._id,
        userName: socket.user.firstName,
      });
    });

    socket.on("stopTyping", ({ communityId }) => {
      socket.to(communityId).emit("userStopTyping", {
        userId: socket.user._id,
      });
    });

    socket.on("joinAppointmentRoom", async ({ appointmentId }, callback) => {
      if (!appointmentId) {
        if (callback) callback({ ok: false, message: "Appointment id is required" });
        return;
      }

      const appointment = await Appointment.findById(appointmentId);
      if (!appointment) {
        if (callback) callback({ ok: false, message: "Appointment not found" });
        return;
      }

      const appointmentDoctorId = appointment.doctor.toString();
      const platformDoctorAccess =
        socket.user.role === "doctor" &&
        appointmentDoctorId === socket.user._id.toString();
      const staffDoctorAccess =
        socket.user.role === "DOCTOR" &&
        socket.user.doctorId &&
        appointmentDoctorId === socket.user.doctorId;
      const doctorAccess = platformDoctorAccess || staffDoctorAccess;
      const userAccess =
        socket.user.role === "user" &&
        appointment.user.toString() === socket.user._id.toString();

      if (!doctorAccess && !userAccess) {
        if (callback) callback({ ok: false, message: "Forbidden appointment access" });
        return;
      }

      if (!["queued", "active"].includes(appointment.status)) {
        if (callback) callback({ ok: false, message: "Appointment has already ended" });
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

      if (callback) callback({ ok: true, doctorJoined: presence.doctorJoined, patientJoined: presence.patientJoined, ready });
    });

    socket.on("leaveAppointmentRoom", ({ appointmentId }) => {
      if (!appointmentId) return;
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

    socket.on("appointment:offer", ({ appointmentId, sdp }) => {
      if (!appointmentId || !sdp) return;
      socket.to(`appointment:${appointmentId}`).emit("appointment:offer", {
        appointmentId,
        sdp,
      });
    });

    socket.on("appointment:answer", ({ appointmentId, sdp }) => {
      if (!appointmentId || !sdp) return;
      socket.to(`appointment:${appointmentId}`).emit("appointment:answer", {
        appointmentId,
        sdp,
      });
    });

    socket.on("appointment:ice-candidate", ({ appointmentId, candidate }) => {
      if (!appointmentId || !candidate) return;
      socket.to(`appointment:${appointmentId}`).emit("appointment:ice-candidate", {
        appointmentId,
        candidate,
      });
    });

    socket.on("appointment:chat-message", (msg) => {
      if (!msg || !msg.appointmentId) return;
      socket.to(`appointment:${msg.appointmentId}`).emit("appointment:chat-message", msg);
    });

    socket.on("appointment:end", ({ appointmentId }) => {
      if (!appointmentId) return;
      // FIXED: socket.to() excludes the sender, so only the other side was told the call ended.
      // Use io.to() so both participants terminate together instead of one being left behind.
      appointmentPresence.delete(String(appointmentId));
      io.to(`appointment:${appointmentId}`).emit("appointment:ended", { appointmentId });
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
      console.log(
        `🔌 Socket disconnected: ${socket.user.firstName} (${socket.id})`
      );
    });
  });

  return io;
}
