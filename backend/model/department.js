import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

const departmentSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: String,
    description: String,
    headDoctorId: { type: objectId, ref: "HospitalStaff" },
    icon: String,
    color: String,
    opd: {
      isActive: { type: Boolean, default: true },
      consultationFee: { type: Number, required: true },
      followUpFee: Number,
      slotDurationMinutes: { type: Number, default: 15 },
      maxPatientsPerSlot: { type: Number, default: 1 },
      timings: [
        {
          day: { type: String, enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
          startTime: String,
          endTime: String,
          doctorIds: [{ type: objectId, ref: "HospitalStaff" }],
        },
      ],
    },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true },
);

departmentSchema.index({ hospitalId: 1, name: 1 }, { unique: true });

const Department = mongoose.model("Department", departmentSchema);

export default Department;
