import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

const staffMessageSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    conversationType: {
      type: String,
      enum: ["direct", "patient_context", "department", "announcement"],
      required: true,
      index: true,
    },
    tokenId: { type: objectId, ref: "OpdToken" },
    patientId: { type: objectId, ref: "user" },
    departmentId: { type: objectId, ref: "Department" },
    recipientStaffId: { type: objectId, ref: "HospitalStaff" },
    sender: { type: objectId, ref: "HospitalStaff", required: true },
    senderName: String,
    senderRole: String,
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    messageType: {
      type: String,
      enum: ["text", "lab_alert", "vitals_ready", "system"],
      default: "text",
    },
    readBy: [
      {
        staffId: { type: objectId, ref: "HospitalStaff" },
        readAt: Date,
      },
    ],
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

staffMessageSchema.index({ hospitalId: 1, tokenId: 1, createdAt: 1 });
staffMessageSchema.index({ hospitalId: 1, departmentId: 1, createdAt: 1 });
staffMessageSchema.index({ hospitalId: 1, recipientStaffId: 1, createdAt: 1 });

const StaffMessage = mongoose.model("StaffMessage", staffMessageSchema);

export default StaffMessage;
