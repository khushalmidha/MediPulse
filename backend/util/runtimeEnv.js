import { configDotenv } from "dotenv";
import { requireDatabaseUrl } from "./databaseConfig.js";

export const loadRuntimeEnv = () => {
  if (process.env.NODE_ENV === "test") return;
  configDotenv({ path: process.env.MEDIPULSE_ENV_FILE || [".env", "../.env", "../../.env"], quiet: true });
};

export const assertRuntimeConfig = (env = process.env) => {
  // The owner explicitly selected medipulse after verifying the test -> medipulse import.
  // Maintenance/migration utilities still require their own explicit database target.
  requireDatabaseUrl(env, { defaultDatabaseName: "medipulse" });
  let tokenKey = env.TOKEN_KEY || env.JWT_SECRET;
  if (typeof tokenKey === "string") {
    tokenKey = tokenKey.trim().replace(/^["']|["']$/g, "");
    if (tokenKey.startsWith("TOKEN_KEY=")) tokenKey = tokenKey.slice("TOKEN_KEY=".length).trim().replace(/^["']|["']$/g, "");
    env.TOKEN_KEY = tokenKey;
  }
  if (!env.TOKEN_KEY || env.TOKEN_KEY.length < 16) throw new Error("TOKEN_KEY must contain at least 16 characters");
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");
};

loadRuntimeEnv();
