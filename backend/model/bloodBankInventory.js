import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

const bloodBankInventorySchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
      required: true,
    },
    availableUnits: { type: Number, default: 0 },
    minimumReserveUnits: { type: Number, default: 5 },
    expiresSoonUnits: { type: Number, default: 0 },
  },
  { timestamps: true },
);

bloodBankInventorySchema.index({ hospitalId: 1, bloodGroup: 1 }, { unique: true });

export default mongoose.model("BloodBankInventory", bloodBankInventorySchema);
