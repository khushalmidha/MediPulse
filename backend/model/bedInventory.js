import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

const bedInventorySchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    departmentId: { type: objectId, ref: "Department", index: true },
    bedType: {
      type: String,
      enum: ["general", "icu", "emergency", "maternity", "pediatric"],
      default: "general",
      index: true,
    },
    totalBeds: { type: Number, default: 0 },
    occupiedBeds: { type: Number, default: 0 },
  },
  { timestamps: true },
);

bedInventorySchema.index({ hospitalId: 1, departmentId: 1, bedType: 1 }, { unique: true });

export default mongoose.model("BedInventory", bedInventorySchema);
