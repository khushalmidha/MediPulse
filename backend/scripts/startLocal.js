import { configDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { requireDatabaseUrl } from "../util/databaseConfig.js";

const file = fileURLToPath(new URL("../.env.local", import.meta.url));
if (!existsSync(file)) throw new Error("Copy backend/.env.local.example to backend/.env.local before starting development");
configDotenv({ path: file, override: true, quiet: true });
let target, redis;
try { target = new URL(requireDatabaseUrl()); redis = new URL(process.env.REDIS_URL); }
catch { throw new Error("Local development requires explicit valid localhost MongoDB and Redis URLs"); }
if (target.protocol !== "mongodb:" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  || target.pathname !== "/medipulse_dev") throw new Error("Local development requires a localhost medipulse_dev database");
if (redis.protocol !== "redis:" || !["localhost", "127.0.0.1", "[::1]"].includes(redis.hostname) || redis.pathname !== "/0"
  || process.env.USE_REAL_REDIS !== "true") throw new Error("Local development requires real localhost Redis database 0");
if (process.env.KAFKA_BROKERS && process.env.KAFKA_BROKERS.split(",").some((broker) => !/^(localhost|127\.0\.0\.1):\d+$/.test(broker.trim()))) {
  throw new Error("Local development requires localhost Kafka brokers");
}
process.env.NODE_ENV = "development";
process.env.MEDIPULSE_ENV_FILE = file;
await import(process.argv[2] === "consumer" ? "./runVirtualConsumers.js" : "../index.js");
