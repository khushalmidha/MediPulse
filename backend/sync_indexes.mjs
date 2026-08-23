import mongoose from "mongoose";
import Appointment from "./model/appointment.js";
import OpdToken from "./model/opdToken.js";

const uri = "mongodb+srv://khushalmidha:7H5qXGxJ03vfYt9A@cluster0.qyi5j.mongodb.net/";

const run = async () => {
  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  // Sync indexes
  await Appointment.createIndexes();
  console.log("Appointment indexes created");

  await OpdToken.createIndexes();
  console.log("OpdToken indexes created");

  await mongoose.disconnect();
};

run().catch(console.error);
