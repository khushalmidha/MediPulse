import { Kafka } from "kafkajs";
import VirtualAnalyticsEvent from "../model/virtualAnalyticsEvent.js";
import { TOPICS } from "./virtualEvents.js";
const createKafka = () =>
  new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || "medipulse-vpay-consumer",
    brokers: String(process.env.KAFKA_BROKERS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    ssl: process.env.KAFKA_SSL === "true" ? { rejectUnauthorized: false } : false,
    sasl:
      process.env.KAFKA_USERNAME && process.env.KAFKA_PASSWORD
        ? {
            mechanism: process.env.KAFKA_SASL_MECHANISM || "plain",
            username: process.env.KAFKA_USERNAME,
            password: process.env.KAFKA_PASSWORD,
          }
        : undefined,
  });

const parseEvent = (message) => {
  const value = message.value?.toString("utf8") || "{}";
  try {
    return JSON.parse(value);
  } catch {
    return {
      eventType: "unknown",
      payload: { raw: value },
      occurredAt: new Date().toISOString(),
    };
  }
};

export const sanitizeAnalyticsPayload = payload => Object.fromEntries([
  "transactionId", "referenceId", "amountMinor", "currency", "status", "type", "demo",
].filter(key => ["string", "number", "boolean"].includes(typeof payload?.[key])).map(key => [key, payload[key]]));

const storeAnalyticsEvent = async ({ topic, event }) => {
  await VirtualAnalyticsEvent.create({
    topic,
    eventType: event.eventType || "unknown",
    payload: sanitizeAnalyticsPayload(event.payload),
    occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
  });
};

export const consumerTopics = () => [...new Set([...Object.values(TOPICS), process.env.KAFKA_APPOINTMENT_TOPIC || "medipulse.appointments"])];

const runVirtualConsumers = async ({ kafka = createKafka(), onReady = () => {}, onCrash = () => {} } = {}) => {
  if (!process.env.KAFKA_BROKERS) {
    throw new Error("KAFKA_BROKERS is required for virtual gateway consumers");
  }

  const consumer = kafka.consumer({
    groupId: process.env.KAFKA_VPAY_CONSUMER_GROUP || "medipulse-vpay-consumers",
  });
  consumer.on(consumer.events.GROUP_JOIN, onReady);
  consumer.on(consumer.events.CRASH, onCrash);
  try {
  if (process.env.KAFKA_CREATE_TOPICS === "true") {
    const admin = kafka.admin();
    try {
      await admin.connect();
      await admin.createTopics({ waitForLeaders: true, topics: consumerTopics().map((topic) => ({ topic, numPartitions: 1, replicationFactor: 1 })) });
    } finally { await admin.disconnect(); }
  }
  await consumer.connect();
  for (const topic of consumerTopics()) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }
  
  const APPOINTMENTS_TOPIC = process.env.KAFKA_APPOINTMENT_TOPIC || "medipulse.appointments";

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const event = parseEvent(message);
      
      // Durable clinical mail/OTP delivery belongs exclusively to the Mongo outbox.
      // Old secret-bearing OTP broker messages are discarded without analytics storage.
      if (String(event.eventType || event.type || "").includes("otp")) return;

      // Store in analytics if it's from the analytics TOPICS list
      if (Object.values(TOPICS).includes(topic)) {
        await storeAnalyticsEvent({ topic, event });
      }
    },
  });

  return consumer;
  } catch (error) { await consumer.disconnect().catch(() => {}); throw error; }
};

export { runVirtualConsumers, storeAnalyticsEvent };
