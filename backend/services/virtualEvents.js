import { Kafka } from "kafkajs";

const TOPICS = {
  paymentsCreated: process.env.KAFKA_PAYMENTS_CREATED_TOPIC || "payments.created",
  paymentsCompleted: process.env.KAFKA_PAYMENTS_COMPLETED_TOPIC || "payments.completed",
  paymentsFailed: process.env.KAFKA_PAYMENTS_FAILED_TOPIC || "payments.failed",
  refundsCreated: process.env.KAFKA_REFUNDS_CREATED_TOPIC || "refunds.created",
  refundsCompleted: process.env.KAFKA_REFUNDS_COMPLETED_TOPIC || "refunds.completed",
  walletUpdated: process.env.KAFKA_WALLET_UPDATED_TOPIC || "wallet.updated",
  notificationsCreated: process.env.KAFKA_NOTIFICATIONS_CREATED_TOPIC || "notifications.created",
  analyticsEvents: process.env.KAFKA_ANALYTICS_EVENTS_TOPIC || "analytics.events",
};

let producerPromise;

const getProducer = async () => {
  if (!process.env.KAFKA_BROKERS) return null;

  if (!producerPromise) {
    const kafka = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID || "medipulse-vpay",
      brokers: process.env.KAFKA_BROKERS.split(",").map((item) => item.trim()),
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

    const producer = kafka.producer();
    producerPromise = producer.connect().then(() => producer);
  }

  return producerPromise;
};

const publishVirtualEvent = async (topic, eventType, payload = {}, key = null) => {
  try {
    const producer = await getProducer();
    if (!producer) return;

    await producer.send({
      topic,
      messages: [
        {
          key: key || payload?.transactionId || payload?.referenceId || eventType,
          value: JSON.stringify({
            eventType,
            payload,
            occurredAt: new Date().toISOString(),
          }),
        },
      ],
    });
  } catch (error) {
    console.error("Virtual Kafka publish failed:", error.message);
  }
};

export { TOPICS, publishVirtualEvent };
