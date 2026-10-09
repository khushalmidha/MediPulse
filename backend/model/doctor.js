import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const doctorSchema = new mongoose.Schema(
  {
    queueTimezone: { type: String, default: "Asia/Kolkata" },
    queueSessionIds: { type: [String], default: ["day"] },
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    authVersion: { type: Number, default: 0 },
    email: {
      type: String,
      required: true,
      match: /.+\@.+\..+/,
      unique: true,
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
      required: true,
    },
    events: {
      type: [mongoose.Schema.Types.ObjectId],
    },
    bio: {
      type: String,
    },
    profilePhoto: {
      type: String,
    },
    phone: {
      type: Number,
      min: 1000000000,
      max: 9999999999,
    },
    rating: {
      type: Number,
    },
    // Each doctor sets their own consultation fee; this is the amount actually charged at booking.
    consultationFee: {
      type: Number,
      default: 500,
      min: 0,
    },

    communities: {
      type: [mongoose.Schema.Types.ObjectId],
    },
    experience: {
      years: {
        type: Number,
        required: true,
      },
      expertise: {
        type: String,
        required: true,
      },
      qualification: {
        type: String,
      },
    },
    clinic: {
      name: {
        type: String,
      },
      location: {
        type: String,
      },
      pin: {
        type: Number,
      },
      phoneNumber: {
        type: Number,
        min: 1000000000,
        max: 9999999999,
      },
    },
    hospitals: [
      {
        hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },
        hospitalName: String,
        slug: String,
        departmentName: String,
        joinedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
)

doctorSchema.index({ firstName: 1, lastName: 1 })
doctorSchema.index({ 'experience.expertise': 1 })

doctorSchema.pre('save', async function () {
  if (!this.isModified('password')) return
  if (!this.isNew) this.authVersion = (this.authVersion || 0) + 1;
  this.password = await bcrypt.hash(this.password, 12)
})

doctorSchema.set("toJSON", { transform: (_doc, value) => {
  for (const key of ["password", "inviteToken", "inviteExpiresAt", "authVersion"]) delete value[key];
  return value;
} });

const Doctor = mongoose.model('doctor', doctorSchema)

export default Doctor
