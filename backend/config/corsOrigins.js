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

const envAllowedOrigins = () =>
  (process.env.CLIENT_URLS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const getAllowedOrigins = () => [
  ...new Set([...defaultAllowedOrigins, ...envAllowedOrigins()]),
];

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (getAllowedOrigins().includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
};

export { getAllowedOrigins, isAllowedOrigin };
