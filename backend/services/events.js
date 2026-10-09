import { Kafka } from "kafkajs";

let producerPromise;

const getKafkaProducer = async () => {
  if (!process.env.KAFKA_BROKERS) return null;

  if (!producerPromise) {
    const kafka = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID || "medipulse-api",
      brokers: process.env.KAFKA_BROKERS.split(",").map((broker) => broker.trim()),
      ssl: process.env.KAFKA_SSL === "true",
      connectionTimeout: 3000, requestTimeout: 5000, retry: { retries: 1 },
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
    producerPromise = producer.connect().then(() => producer).catch(async error => { producerPromise = null; await producer.disconnect().catch(() => {}); throw error; });
  }

  return producerPromise;
};

export const deliverBrokerEvent = async (type, payload, id) => {
  const producer = await getKafkaProducer();
  if (!producer) throw new Error("Broker delivery unavailable");
  try { await producer.send({ topic: process.env.KAFKA_APPOINTMENT_TOPIC || "medipulse.appointments",
    messages: [{ key: id, value: JSON.stringify({ type, payload, id, deliveryOwner: "outbox", occurredAt: new Date().toISOString() }) }] }); }
  catch (error) { producerPromise = null; await producer.disconnect().catch(() => {}); throw error; }
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
    console.error("Optional Kafka telemetry delivery failed");
  }
};

export { publishEvent };
