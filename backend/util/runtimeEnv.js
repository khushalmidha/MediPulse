import { configDotenv } from "dotenv";
import { requireDatabaseUrl } from "./databaseConfig.js";

export const loadRuntimeEnv = () => {
  if (process.env.NODE_ENV === "test") return;
  configDotenv({ path: process.env.MEDIPULSE_ENV_FILE || [".env", "../.env", "../../.env"], quiet: true });
};

export const assertRuntimeConfig = (env = process.env) => {
  requireDatabaseUrl(env);
  if (!env.TOKEN_KEY || env.TOKEN_KEY.length < 16) throw new Error("TOKEN_KEY must contain at least 16 characters");
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");
};

loadRuntimeEnv();
