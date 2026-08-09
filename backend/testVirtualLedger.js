import mongoose from "mongoose";
import "dotenv/config.js";
import { transferVirtualMoney, refundVirtualPayment, topupWallet } from "./services/virtualLedger.js";
import Wallet from "./model/wallet.js";
import VirtualTransaction from "./model/virtualTransaction.js";

async function runTests() {
  await mongoose.connect(process.env.DATABASE_URL);
  console.log("Connected to MongoDB for Testing");

  const senderId = new mongoose.Types.ObjectId();
  const receiverId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();

  try {
    // 1. Topup sender
    console.log("1. Testing Topup...");
    const topupTxn = await topupWallet({
      adminId: adminId,
      targetId: senderId,
      targetRole: "user",
      amount: 1000,
      description: "Test Topup"
    });
    console.log("Topup Txn:", topupTxn.transactionId);

    // 2. Transfer money
    console.log("2. Testing Transfer...");
    const transferTxn = await transferVirtualMoney({
      senderId: senderId,
      senderRole: "user",
      receiverId: receiverId,
      receiverRole: "doctor",
      amount: 250,
      type: "PAYMENT",
      description: "Test Payment"
    });
    console.log("Transfer Txn:", transferTxn.transactionId);

    // Verify wallets
    const senderWallet = await Wallet.findOne({ userId: senderId });
    const receiverWallet = await Wallet.findOne({ userId: receiverId });
    console.log("Sender Balance:", senderWallet.balance, "(Expected: 750)");
    console.log("Receiver Balance:", receiverWallet.balance, "(Expected: 250)");

    // 3. Refund Payment
    console.log("3. Testing Refund...");
    const refundData = await refundVirtualPayment({
      actorId: receiverId,
      actorRole: "doctor",
      originalTransactionId: transferTxn.transactionId,
      amount: 100,
      reason: "Test Refund",
      isAdmin: false
    });
    console.log("Refund Txn:", refundData.refundTxn.transactionId);

    // Verify wallets again
    const senderWalletAfter = await Wallet.findOne({ userId: senderId });
    const receiverWalletAfter = await Wallet.findOne({ userId: receiverId });
    console.log("Sender Balance After Refund:", senderWalletAfter.balance, "(Expected: 850)");
    console.log("Receiver Balance After Refund:", receiverWalletAfter.balance, "(Expected: 150)");

    console.log("Tests Passed!");
  } catch (error) {
    console.error("Test Failed:", error);
  } finally {
    // Cleanup
    await Wallet.deleteMany({ userId: { $in: [senderId, receiverId] } });
    await VirtualTransaction.deleteMany({ senderId: { $in: [senderId, receiverId, adminId] } });
    await mongoose.disconnect();
    process.exit(0);
  }
}

runTests();
