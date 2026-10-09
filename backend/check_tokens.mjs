import mongoose from "mongoose";
import { configDotenv } from "dotenv";
import { requireDatabaseUrl } from "./util/databaseConfig.js";

configDotenv({ path: [".env", "../.env"], quiet: true });
const run = async () => {
  try {
    await mongoose.connect(requireDatabaseUrl(), { serverSelectionTimeoutMS: 5000 });
    const tokens = mongoose.connection.collection("opdtokens");
    const [total, completedTriage] = await Promise.all([
      tokens.countDocuments({}),
      tokens.countDocuments({ "aiTriage.status": "completed" }),
    ]);
    console.log(JSON.stringify({ totalTokens: total, completedTriageTokens: completedTriage }));
  } finally {
    await mongoose.disconnect();
  }
};
run().catch(() => {
  console.error("Token diagnostic failed. Check DATABASE_URL and database access privately.");
  process.exitCode = 1;
});
