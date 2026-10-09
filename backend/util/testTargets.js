import { requireDatabaseUrl } from "./databaseConfig.js";

export const localTestTargets = (env = process.env) => {
  const mongo = requireDatabaseUrl({ DATABASE_URL: env.TEST_DATABASE_URL });
  let database, redis;
  try { database = new URL(mongo); redis = new URL(env.TEST_REDIS_URL); }
  catch { throw new Error("Explicit TEST_DATABASE_URL and TEST_REDIS_URL are required"); }
  const local = new Set(["localhost", "127.0.0.1", "[::1]", "mongo", "redis"]);
  if (database.protocol !== "mongodb:" || !local.has(database.hostname) || database.username || database.password
    || !/^\/medipulse_test(?:_[a-zA-Z0-9_]+)?$/.test(database.pathname)) {
    throw new Error("Tests require a local MongoDB host and a medipulse_test database");
  }
  if (redis.protocol !== "redis:" || !local.has(redis.hostname) || redis.username || redis.password || redis.pathname !== "/15") {
    throw new Error("Tests require an explicit local Redis URL using database 15");
  }
  return { mongo, redis: redis.href };
};
