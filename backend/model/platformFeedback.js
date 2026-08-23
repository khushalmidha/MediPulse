import mongoose from "mongoose";

const platformFeedbackSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, maxlength: 1000, required: true },
    isAnonymous: { type: Boolean, default: false },
    status: { type: String, enum: ["published", "flagged", "removed"], default: "published" },
  },
  { timestamps: true },
);

const PlatformFeedback = mongoose.model("PlatformFeedback", platformFeedbackSchema);

export default PlatformFeedback;
