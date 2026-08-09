import mongoose from "mongoose";

const sharedReportSchema = new mongoose.Schema({
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Doctor",
    required: true,
  },
  fileUrl: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
});

const SharedReport = mongoose.model("SharedReport", sharedReportSchema);

export default SharedReport;
