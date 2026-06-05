import { configDotenv } from "dotenv";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import connectMongo from "../connection.js";
import User from "../model/user.js";
import Doctor from "../model/doctor.js";
import Wallet from "../model/wallet.js";
import VirtualTransaction from "../model/virtualTransaction.js";

configDotenv({ path: [".env", "../.env", "../../.env"] });

const createTxId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const seed = async () => {
  await connectMongo(process.env.DATABASE_URL);
  const [patientPassword, doctorPassword, adminPassword] = await Promise.all([
    bcrypt.hash("patient123", 12),
    bcrypt.hash("doctor123", 12),
    bcrypt.hash("admin123", 12),
  ]);

  const [patient, doctor, admin] = await Promise.all([
    User.findOneAndUpdate(
      { email: "demo.patient@medipulse.app" },
      {
        $set: {
          firstName: "Demo",
          lastName: "Patient",
          email: "demo.patient@medipulse.app",
          password: patientPassword,
          gender: "other",
          bio: "Seed patient account",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
    Doctor.findOneAndUpdate(
      { email: "demo.doctor@medipulse.app" },
      {
        $set: {
          firstName: "Demo",
          lastName: "Doctor",
          email: "demo.doctor@medipulse.app",
          password: doctorPassword,
          gender: "other",
          bio: "Seed doctor account",
          experience: {
            years: 5,
            expertise: "General Medicine",
          },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
    User.findOneAndUpdate(
      { email: "demo.admin@medipulse.app" },
      {
        $set: {
          firstName: "Demo",
          lastName: "Admin",
          email: "demo.admin@medipulse.app",
          password: adminPassword,
          gender: "other",
          bio: "Seed admin account",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
  ]);

  const wallets = [
    { userId: patient._id, userRole: "user", balance: 10000 },
    { userId: doctor._id, userRole: "doctor", balance: 5000 },
    { userId: admin._id, userRole: "user", balance: 50000 },
  ];

  for (const wallet of wallets) {
    await Wallet.findOneAndUpdate(
      { userId: wallet.userId, userRole: wallet.userRole },
      {
        $set: {
          currency: "INR",
          status: "active",
          balance: wallet.balance,
          totalReceived: wallet.balance,
          totalSent: 0,
        },
      },
      { upsert: true, new: true },
    );
  }

  const exists = await VirtualTransaction.countDocuments({ referenceId: "SEED-INITIAL-TOPUP" });
  if (!exists) {
    await VirtualTransaction.insertMany([
      {
        transactionId: createTxId("TOPUP"),
        senderId: admin._id,
        senderRole: "user",
        receiverId: patient._id,
        receiverRole: "user",
        amount: 10000,
        type: "TOPUP",
        status: "SUCCESS",
        description: "Seed top-up for patient",
        referenceId: "SEED-INITIAL-TOPUP",
      },
      {
        transactionId: createTxId("TOPUP"),
        senderId: admin._id,
        senderRole: "user",
        receiverId: doctor._id,
        receiverRole: "doctor",
        amount: 5000,
        type: "TOPUP",
        status: "SUCCESS",
        description: "Seed top-up for doctor",
        referenceId: "SEED-INITIAL-TOPUP-DOCTOR",
      },
    ]);
  }

  console.log("Virtual gateway seed complete");
  console.log({
    patient: "demo.patient@medipulse.app / patient123",
    doctor: "demo.doctor@medipulse.app / doctor123",
    admin: "demo.admin@medipulse.app / admin123",
    adminUserIdForEnv: admin._id.toString(),
  });

  await mongoose.disconnect();
};

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
