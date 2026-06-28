import { publishKafkaMessage } from "./kafkaClient.js";

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

const publishVirtualEvent = async (topic, eventType, payload = {}, key = null) => {
  try {
    await publishKafkaMessage({
      topic,
      key: key || payload?.transactionId || payload?.referenceId || eventType,
      value: JSON.stringify({
        eventType,
        payload,
        occurredAt: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error("Virtual Kafka publish failed:", error.message);
  }
};

export { TOPICS, publishVirtualEvent };
