import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { configDotenv } from "dotenv";
import cookie from "cookie";
import User from "./model/user.js";
import Doctor from "./model/doctor.js";
import Message from "./model/message.js";
import Community from "./model/community.js";

configDotenv();

/**
 * Initialize Socket.IO on the given HTTP server.
 * Returns the io instance so it can be used elsewhere if needed.
 */
export function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: [
        "http://localhost:5173",
        "https://medipulse-azure.vercel.app",
        "https://medipulse-git-main-lakshya0000s-projects.vercel.app",
        "https://medipulse-lakshya0000s-projects.vercel.app",
        "https://medipulse-dsk1.onrender.com",
        "https://medi-pulse-three.vercel.app",
        "https://medi-pulse-gamma.vercel.app",
        "https://medi-pulse-khushalmidhas-projects.vercel.app",
        "https://medi-pulse-git-main-khushalmidhas-projects.vercel.app",
      ],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // ── Authentication middleware ──────────────────────────────
  io.use(async (socket, next) => {
    try {
      const rawCookies = socket.handshake.headers.cookie;
      if (!rawCookies) return next(new Error("Authentication error"));

      const cookies = cookie.parse(rawCookies);
      const token = cookies.token;
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

    // ── Disconnect ────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(
        `🔌 Socket disconnected: ${socket.user.firstName} (${socket.id})`
      );
    });
  });

  return io;
}
