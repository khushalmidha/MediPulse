import "../util/runtimeEnv.js";
const defaults = ["https://medipulse.live", "https://www.medipulse.live", "https://connect.medipulse.live", "https://app.medipulse.live", "https://medi-pulse-gamma.vercel.app"];
const local = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8081", "http://127.0.0.1:8081", "http://127.0.0.1:15173"];
export const allowedOrigins = [...new Set([...defaults, ...(process.env.NODE_ENV === "production" ? [] : local),
  ...(process.env.CLIENT_URLS || "").split(",").map(value => value.trim()).filter(Boolean)])];
export const isAllowedOrigin = origin => !origin || (origin !== "null" && allowedOrigins.includes(origin));
