import mongoose from "mongoose";
import { configDotenv } from "dotenv";
import Appointment from "./model/appointment.js";
import OpdToken from "./model/opdToken.js";
import { requireDatabaseUrl } from "./util/databaseConfig.js";

configDotenv({ path: [".env", "../.env"], quiet: true });
const run = async () => {
  try {
    await mongoose.connect(requireDatabaseUrl(), { serverSelectionTimeoutMS: 5000 });
    await Appointment.createIndexes();
    await OpdToken.createIndexes();
    console.log("Appointment and OPD token indexes created");
  } finally {
    await mongoose.disconnect();
  }
};
run().catch(() => {
  console.error("Index utility failed. Check DATABASE_URL and database access privately.");
  process.exitCode = 1;
});
