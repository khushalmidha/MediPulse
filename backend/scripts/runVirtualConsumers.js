import "../util/runtimeEnv.js";
import { createServer } from "node:http";
import mongoose from "mongoose";
import connectMongo from "../connection.js";
import { checkDependencies } from "../services/readiness.js";
import { closeRedis } from "../services/redis.js";
import { runVirtualConsumers } from "../services/virtualConsumers.js";

let joined = false, consumer, closing = false;
const server = createServer(async (req, res) => {
  if (req.url === "/health/live") { res.writeHead(200); return res.end('{"status":"alive"}'); }
  if (req.url !== "/health/ready") { res.writeHead(404); return res.end(); }
  try {
    const result = await checkDependencies();
    res.writeHead(result.ready && joined ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ...result, ready: result.ready && joined, consumer: joined ? "joined" : "not-joined" }));
  } catch { res.writeHead(503); res.end('{"ready":false}'); }
});
const shutdown = async (code = 0) => {
  if (closing) return;
  closing = true; joined = false;
  const deadline = setTimeout(() => process.exit(code || 1), 10000); deadline.unref();
  await consumer?.disconnect().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect(); await closeRedis().catch(() => {});
  process.exit(code);
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown());
for (const event of ["uncaughtException", "unhandledRejection"]) process.on(event, () => {
  console.error(`${event}: stopping consumer`);
  shutdown(1);
});
const run = async () => {
  if (!process.env.KAFKA_BROKERS) throw new Error("KAFKA_BROKERS is required");
  await connectMongo(process.env.DATABASE_URL);
  server.listen(Number(process.env.CONSUMER_HEALTH_PORT || 8082));
  consumer = await runVirtualConsumers({ onReady: () => { joined = true; }, onCrash: () => { joined = false; } });
  console.log("Virtual consumer started; readiness requires Kafka group membership");
};
run().catch(async () => {
  console.error("Consumer startup failed. Check MongoDB replica set, Redis and Kafka readiness/configuration.");
  await shutdown(1);
});
