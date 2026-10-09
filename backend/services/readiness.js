import mongoose from "mongoose";
import { Kafka, logLevel } from "kafkajs";
import { getRedis, usesRealRedis } from "./redis.js";

export const assertMongoTransactions = async (connection) => {
  if (connection.readyState !== 1) throw new Error("MongoDB is not connected");
  const hello = await connection.db.admin().command({ hello: 1, maxTimeMS: 2000 });
  if ((!hello.setName && hello.msg !== "isdbgrid") || !hello.isWritablePrimary) {
    throw new Error("MongoDB requires a writable replica set or mongos for wallet transactions");
  }
};

export const probeKafka = async () => {
  const admin = new Kafka({ clientId: "medipulse-readiness", brokers: process.env.KAFKA_BROKERS.split(",").map((b) => b.trim()),
    ssl: process.env.KAFKA_SSL === "true", connectionTimeout: 2000, requestTimeout: 2000, retry: { retries: 0 }, logLevel: logLevel.NOTHING,
    ...(process.env.KAFKA_USERNAME && process.env.KAFKA_PASSWORD ? { sasl: { mechanism: process.env.KAFKA_SASL_MECHANISM || "plain", username: process.env.KAFKA_USERNAME, password: process.env.KAFKA_PASSWORD } } : {}),
  }).admin();
  try { await admin.connect(); await admin.describeCluster(); }
  finally { await admin.disconnect(); }
};

export const checkDependencies = async ({ mongo = () => assertMongoTransactions(mongoose.connection),
  redis = () => getRedis().ping(), kafka = probeKafka, env = process.env } = {}) => {
  const checks = [{ name: "mongodb", run: mongo }, { name: "redis", run: redis }];
  if (env.KAFKA_BROKERS) checks.push({ name: "kafka", run: kafka });
  const results = await Promise.allSettled(checks.map((check) => check.run()));
  const dependencies = Object.fromEntries(checks.map((check, i) => [check.name, results[i].status === "fulfilled" ? "ready" : "unavailable"]));
  if (!usesRealRedis(env) && dependencies.redis === "ready") dependencies.redis = "memory";
  if (!env.KAFKA_BROKERS) dependencies.kafka = "disabled";
  dependencies.mail = env.MAIL_DELIVERY === "disabled" ? "disabled" : (env.RESEND_API_KEY || env.BREVO_API_KEY ||
    ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"].every((key) => env[key]) ? "configured" : "not-configured");
  return { ready: results.slice(0, 2).every((result) => result.status === "fulfilled"), degraded: dependencies.kafka === "unavailable", dependencies };
};

export const attachHealthRoutes = (app, checks = checkDependencies) => {
  app.get("/health/live", (req, res) => res.json({ status: "alive" }));
  app.get("/health/ready", async (req, res) => {
    try {
      const result = await checks();
      res.set("Cache-Control", "no-store").status(result.ready ? 200 : 503).json(result);
    } catch { res.status(503).json({ ready: false }); }
  });
};
