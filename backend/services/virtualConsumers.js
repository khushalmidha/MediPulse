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
    ssl: process.env.KAFKA_SSL === "true",
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

const storeAnalyticsEvent = async ({ topic, event }) => {
  await VirtualAnalyticsEvent.create({
    topic,
    eventType: event.eventType || "unknown",
    payload: event.payload || {},
    occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
  });
};

const runVirtualConsumers = async () => {
  if (!process.env.KAFKA_BROKERS) {
    throw new Error("KAFKA_BROKERS is required for virtual gateway consumers");
  }

  const kafka = createKafka();
  const consumer = kafka.consumer({
    groupId: process.env.KAFKA_VPAY_CONSUMER_GROUP || "medipulse-vpay-consumers",
  });

  await consumer.connect();
  for (const topic of Object.values(TOPICS)) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const event = parseEvent(message);
      await storeAnalyticsEvent({ topic, event });
    },
  });

  return consumer;
};

export { runVirtualConsumers, storeAnalyticsEvent };
