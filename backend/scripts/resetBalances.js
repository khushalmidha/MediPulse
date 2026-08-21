
import mongoose from "mongoose";
import dotenv from "dotenv";
import Wallet from "../model/wallet.js";

dotenv.config();

const resetBalances = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB for balance migration.");

    // Find all user wallets that might have been initialized with 5000 instead of 500.
    // Assuming we want to reset them to 500 - their spending.
    // If they were initialized with 5000, their balance would be 5000 + totalReceived - totalSent (minus the initial 5000).
    // Actually, it is easier to just deduct 4500 from any user wallet where totalReceived >= 5000, 
    // or we can simply recalculate the balance.
    
    // To be perfectly safe, if they were seeded with 5000 (totalReceived >= 5000), we can reduce their balance and totalReceived by 4500.
    const result = await Wallet.updateMany(
      { userRole: "user", totalReceived: { $gte: 5000 } },
      { $inc: { balance: -4500, totalReceived: -4500 } }
    );

    console.log(`Successfully fixed balances for ${result.modifiedCount} users.`);
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
};

resetBalances();

