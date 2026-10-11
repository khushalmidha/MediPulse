import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

const hospitalLocationSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["building", "floor", "room", "desk", "station"],
      default: "room",
    },
    building: { type: String, trim: true },
    floor: { type: String, trim: true },
    roomNumber: { type: String, trim: true },
    departmentId: { type: objectId, ref: "Department" },
    assignedStaffIds: [{ type: objectId, ref: "HospitalStaff" }],
    serviceType: {
      type: String,
      enum: ["reception", "registration", "vitals", "consultation", "lab", "pharmacy", "billing", "other"],
      default: "consultation",
    },
    instructions: { type: String, trim: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

hospitalLocationSchema.index({ hospitalId: 1, name: 1 }, { unique: true });

const HospitalLocation = mongoose.model("HospitalLocation", hospitalLocationSchema);

export default HospitalLocation;
