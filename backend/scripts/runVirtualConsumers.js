import { configDotenv } from "dotenv";
import mongoose from "mongoose";
import connectMongo from "../connection.js";
import { runVirtualConsumers } from "../services/virtualConsumers.js";

configDotenv({ path: [".env", "../.env", "../../.env"] });

const run = async () => {
  await connectMongo(process.env.DATABASE_URL);
  await runVirtualConsumers();
  console.log("Virtual payment Kafka consumers started");
};

run().catch(async (error) => {
  console.error("Virtual consumer failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});
