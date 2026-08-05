import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const objectId = mongoose.Schema.Types.ObjectId;

const hospitalStaffSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    departmentIds: [{ type: objectId, ref: "Department" }],
    userId: { type: objectId, ref: "user" },
    doctorId: { type: objectId, ref: "doctor" },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: String,
    profilePhoto: String,
    role: {
      type: String,
      enum: ["HOSPITAL_ADMIN", "DEPARTMENT_HEAD", "DOCTOR", "NURSE", "LAB_TECH", "RECEPTIONIST", "PHARMACIST"],
      required: true,
    },
    // FIXED: Doctors/nurses could not receive admin portal access without losing their clinical role.
    adminAccess: { type: Boolean, default: false, index: true },
    doctorProfile: {
      qualification: String,
      specialization: String,
      experience: Number,
      registrationNumber: String,
      consultationFee: Number,
      bio: String,
      languages: [String],
      rating: { type: Number, default: 0 },
      totalReviews: { type: Number, default: 0 },
    },
    inviteStatus: { type: String, enum: ["pending", "accepted", "expired"], default: "pending" },
    inviteToken: String,
    inviteExpiresAt: Date,
    invitedBy: { type: objectId, ref: "HospitalStaff" },
    password: String,
    isActive: { type: Boolean, default: true },
    joinedAt: Date,
  },
  { timestamps: true },
);

hospitalStaffSchema.index({ hospitalId: 1, email: 1 }, { unique: true });
hospitalStaffSchema.index({ hospitalId: 1, role: 1 });
hospitalStaffSchema.index({ role: 1, isActive: 1, inviteStatus: 1, name: 1 });

hospitalStaffSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;
  this.password = await bcrypt.hash(this.password, 12);
});

const HospitalStaff = mongoose.model("HospitalStaff", hospitalStaffSchema);

export default HospitalStaff;
