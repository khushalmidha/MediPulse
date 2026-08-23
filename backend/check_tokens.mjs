import mongoose from "mongoose";

const uri = "mongodb+srv://khushalmidha:7H5qXGxJ03vfYt9A@cluster0.qyi5j.mongodb.net/";

const run = async () => {
  await mongoose.connect(uri);
  const db = mongoose.connection.useDb('test'); 
  
  const tokens = await db.collection("opdtokens").find().sort({ createdAt: -1 }).limit(2).toArray();
  tokens.forEach(t => {
    console.log(`- Token ID: ${t._id}`);
    console.log(`  Symptoms/Complaint: ${t.chiefComplaint}`);
    console.log(`  Patient Brief: ${JSON.stringify(t.aiTriage?.patientBrief, null, 2)}`);
    console.log("  -----------------------------");
  });
  
  await mongoose.disconnect();
};

run().catch(console.error);
