import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

const reviewSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    doctorId: { type: objectId, ref: "HospitalStaff" },
    departmentId: { type: objectId, ref: "Department" },
    patientId: { type: objectId, ref: "user", required: true },
    tokenId: { type: objectId, ref: "OpdToken", required: true },
    ratings: {
      doctorQuality: { type: Number, min: 1, max: 5 },
      waitTime: { type: Number, min: 1, max: 5 },
      staffBehavior: { type: Number, min: 1, max: 5 },
      cleanliness: { type: Number, min: 1, max: 5 },
      valueForMoney: { type: Number, min: 1, max: 5 },
    },
    overallRating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, maxlength: 1000 },
    isAnonymous: { type: Boolean, default: false },
    hospitalResponse: {
      text: String,
      respondedAt: Date,
      respondedBy: { type: objectId, ref: "HospitalStaff" },
    },
    metadata: mongoose.Schema.Types.Mixed,
    status: { type: String, enum: ["published", "flagged", "removed"], default: "published" },
  },
  { timestamps: true },
);

reviewSchema.index({ tokenId: 1, patientId: 1 }, { unique: true });

const Review = mongoose.model("Review", reviewSchema);

export default Review;
