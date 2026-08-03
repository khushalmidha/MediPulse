import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

const hospitalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, immutable: true, lowercase: true, trim: true },
    registrationNumber: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["private", "government", "clinic", "diagnostic-center", "nursing-home"],
      required: true,
    },
    // FIXED: Hospital discovery could not represent Ayurveda, Yoga, or Homeopathy partners separately from normal hospital type.
    medicineSystem: {
      type: String,
      enum: ["allopathic", "ayurveda", "homeopathy", "yoga_wellness", "integrative"],
      default: "allopathic",
      index: true,
    },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: String,
    website: String,
    address: {
      line1: String,
      city: { type: String, required: true, trim: true },
      state: { type: String, required: true, trim: true },
      pincode: String,
      coordinates: {
        lat: Number,
        lng: Number,
      },
    },
    branding: {
      logo: String,
      coverImage: String,
      primaryColor: { type: String, default: "#2563eb" },
      tagline: String,
      about: String,
      establishedYear: Number,
      specializations: [String],
      accreditations: [String],
      socialLinks: {
        facebook: String,
        instagram: String,
        twitter: String,
      },
    },
    websiteConfig: {
      subdomainEnabled: { type: Boolean, default: true },
      customDomain: String,
      customDomainVerified: { type: Boolean, default: false },
      customDomainVercelId: String,
      seoTitle: String,
      seoDescription: String,
      showRatings: { type: Boolean, default: true },
      showDoctorList: { type: Boolean, default: true },
      showFees: { type: Boolean, default: true },
      theme: { type: String, enum: ["modern", "classic", "minimal"], default: "modern" },
    },
    status: {
      type: String,
      enum: ["pending_verification", "active", "suspended", "rejected"],
      default: "pending_verification",
      index: true,
    },
    verifiedAt: Date,
    verifiedBy: { type: objectId, ref: "user" },
    rejectionReason: String,
    subscription: {
      plan: { type: String, enum: ["starter", "growth", "enterprise"], default: "starter" },
      status: { type: String, enum: ["trial", "active", "expired", "cancelled"], default: "trial" },
      trialEndsAt: Date,
      currentPeriodEnd: Date,
    },
    stats: {
      totalDoctors: { type: Number, default: 0 },
      totalDepartments: { type: Number, default: 0 },
      totalAppointments: { type: Number, default: 0 },
      avgRating: { type: Number, default: 0 },
      totalReviews: { type: Number, default: 0 },
    },
    settings: {
      appointmentConfirmationRequired: { type: Boolean, default: false },
      allowWalkIns: { type: Boolean, default: true },
      tokenPrefix: { type: String, default: "T" },
      workingDays: { type: [String], default: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] },
      emergencyContact: String,
    },
    onboarding: {
      initialAdminPasswordEncrypted: String,
      initialAdminPasswordIv: String,
      initialAdminPasswordTag: String,
      approvalCredentialsSentAt: Date,
    },
  },
  { timestamps: true },
);

hospitalSchema.index({ "address.city": 1, status: 1 });
hospitalSchema.index({ "address.coordinates": "2dsphere" });

const Hospital = mongoose.model("Hospital", hospitalSchema);

export default Hospital;
