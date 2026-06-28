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

const publishKafkaMessage = async ({ topic, key, value }) => {
  const producer = await getKafkaProducer();
  if (!producer) return;

  await producer.send({
    topic,
    messages: [{ key, value }],
  });
};

export { getKafkaProducer, publishKafkaMessage };
