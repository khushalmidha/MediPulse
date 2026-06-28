import { publishKafkaMessage } from "./kafkaClient.js";

const publishEvent = async (type, payload = {}) => {
  try {
    await publishKafkaMessage({
      topic: process.env.KAFKA_APPOINTMENT_TOPIC || "medipulse.appointments",
      key: payload.appointmentId || payload.orderId || payload.paymentId || type,
      value: JSON.stringify({
        type,
        payload,
        occurredAt: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error("Kafka publish failed:", error.message);
  }
};

export { publishEvent };
