const defaultAllowedOrigins = ["*"];

const envAllowedOrigins = (process.env.CLIENT_URLS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envAllowedOrigins])];

export const isAllowedOrigin = (origin) =>
  !origin ||
  allowedOrigins.includes(origin) ||
  /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
