import { Kafka } from "kafkajs";
import VirtualAnalyticsEvent from "../model/virtualAnalyticsEvent.js";
import { TOPICS } from "./virtualEvents.js";
import User from "../model/user.js";
import Doctor from "../model/doctor.js";
import { sendAppointmentBookedMail, sendAppointmentRefundMail, sendPasswordResetOtpMail } from "../util/mailer.js";

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
  
  const APPOINTMENTS_TOPIC = process.env.KAFKA_APPOINTMENT_TOPIC || "medipulse.appointments";
  await consumer.subscribe({ topic: APPOINTMENTS_TOPIC, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const event = parseEvent(message);
      
      // Async Email processing for appointments
      if (topic === APPOINTMENTS_TOPIC && event.type === "appointment.booked") {
        try {
          const { userId, doctorId, appointmentId } = event.payload || {};
          if (userId && doctorId) {
            const user = await User.findById(userId);
            const doctor = await Doctor.findById(doctorId);
            const patientName = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Patient" : "Patient";
            const doctorName = doctor ? `${doctor.firstName || ""} ${doctor.lastName || ""}`.trim() || "Doctor" : "Doctor";
            
            if (user && user.email) {
              await sendAppointmentBookedMail({
                to: user.email,
                doctorName,
                patientName,
                appointmentId
              });
              console.log(`Async email sent for appointment ${appointmentId}`);
            }
          }
        } catch (error) {
          console.error("Async email failed:", error.message);
        }
      }
      
      // Async Refund Email processing
      if (topic === APPOINTMENTS_TOPIC && event.type === "appointment.refunded") {
        try {
          const { userId, doctorId, appointmentId, amount } = event.payload || {};
          if (userId && doctorId) {
            const user = await User.findById(userId);
            const doctor = await Doctor.findById(doctorId);
            const patientName = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Patient" : "Patient";
            const doctorName = doctor ? `${doctor.firstName || ""} ${doctor.lastName || ""}`.trim() || "Doctor" : "Doctor";
            
            if (user && user.email) {
              await sendAppointmentRefundMail({
                to: user.email,
                doctorName,
                patientName,
                appointmentId,
                amount,
                currency: "INR"
              });
              console.log(`Async refund email sent for appointment ${appointmentId}`);
            }
          }
        } catch(error) {
          console.error("Async refund email failed:", error.message);
        }
      }

      // Async OTP Email processing
      if (topic === TOPICS.notificationsCreated && event.eventType === "auth.otp_requested") {
        try {
          const { email, accountName, otp } = event.payload || {};
          if (email && otp) {
            await sendPasswordResetOtpMail({
              to: email,
              accountName,
              otp
            });
            console.log(`Async OTP email sent to ${email}`);
          }
        } catch(error) {
          console.error("Async OTP email failed:", error.message);
        }
      }

      // Store in analytics if it's from the analytics TOPICS list
      if (Object.values(TOPICS).includes(topic)) {
        await storeAnalyticsEvent({ topic, event });
      }
    },
  });

  return consumer;
};

export { runVirtualConsumers, storeAnalyticsEvent };
