import { Kafka } from "kafkajs";

let producerPromise;

const getKafkaProducer = async () => {
  if (!process.env.KAFKA_BROKERS) return null;

  if (!producerPromise) {
    const kafka = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID || "medipulse-api",
      brokers: process.env.KAFKA_BROKERS.split(",").map((broker) => broker.trim()),
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

const publishEvent = async (type, payload = {}) => {
  try {
    const producer = await getKafkaProducer();
    if (!producer) return;

    await producer.send({
      topic: process.env.KAFKA_APPOINTMENT_TOPIC || "medipulse.appointments",
      messages: [
        {
          key: payload.appointmentId || payload.orderId || payload.paymentId || type,
          value: JSON.stringify({
            type,
            payload,
            occurredAt: new Date().toISOString(),
          }),
        },
      ],
    });
  } catch (error) {
    console.error("Kafka publish failed:", error.message);
  }
};

export { publishEvent };
