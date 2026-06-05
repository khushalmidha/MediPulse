import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { configDotenv } from "dotenv";
import cookie from "cookie";
import User from "./model/user.js";
import Doctor from "./model/doctor.js";
import Message from "./model/message.js";
import Community from "./model/community.js";
import Appointment from "./model/appointment.js";

configDotenv();
let ioInstance = null;

export function getIO() {
  return ioInstance;
}

/**
 * Initialize Socket.IO on the given HTTP server.
 * Returns the io instance so it can be used elsewhere if needed.
 */
export function initSocket(server) {
  const defaultAllowedOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://medipulse-azure.vercel.app",
    "https://medipulse-git-main-lakshya0000s-projects.vercel.app",
    "https://medipulse-lakshya0000s-projects.vercel.app",
    "https://medipulse-dsk1.onrender.com",
    "https://medi-pulse-three.vercel.app",
    "https://medi-pulse-gamma.vercel.app",
    "https://medi-pulse-khushalmidhas-projects.vercel.app",
    "https://medi-pulse-git-main-khushalmidhas-projects.vercel.app",
  ];
  const envAllowedOrigins = (process.env.CLIENT_URLS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envAllowedOrigins])];
  const isAllowedOrigin = (origin) =>
    !origin ||
    allowedOrigins.includes(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

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
          token = cookies.token;
        }
      }

      if (!token) return next(new Error("Authentication error"));

      jwt.verify(token, process.env.TOKEN_KEY, async (err, data) => {
        if (err) return next(new Error("Authentication error"));

        const user = await (data.role === "user" ? User : Doctor).findById(
          data.id
        );
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

      const doctorAccess =
        socket.user.role === "doctor" &&
        appointment.doctor.toString() === socket.user._id.toString();
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
      socket.to(roomName).emit("appointment:peer-joined", {
        appointmentId,
        peerId: socket.id,
        peerRole: socket.user.role,
      });

      if (callback) callback({ ok: true });
    });

    socket.on("leaveAppointmentRoom", ({ appointmentId }) => {
      if (!appointmentId) return;
      socket.leave(`appointment:${appointmentId}`);
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

    // ── Disconnect ────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(
        `🔌 Socket disconnected: ${socket.user.firstName} (${socket.id})`
      );
    });
  });

  return io;
}
