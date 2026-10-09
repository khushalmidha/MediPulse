import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
	{
		firstName: {
			type: String,
			required: true,
		},
		lastName: {
			type: String,
		},
		bio: {
			type: String,
		},
		email: {
			type: String,
			required: true,
			match: /.+\@.+\..+/,
			unique: true,
		},
    password: {
      type:String,
      required:true,
      select: false,
    },
    authVersion: { type: Number, default: 0 },
		gender: {
			type: String,
			enum: ["male", "female", "other"],
			required: true,
		},
		phoneNumber: {
			type: Number,
			min: 1000000000,
			max: 9999999999,
		},
		communities: {
			type: [mongoose.Schema.Types.ObjectId],
		},
		medicalHistory: {
			primaryCondition: {
				type: String,
			},
		},
		emergencyContact: {
			name: {
				type: String,
			},
			relation: {
				type: String,
			},
			phoneNumber: {
				type: Number,
				min: 1000000000,
				max: 9999999999,
			},
		},
		familyMembers: [
			{
				name: String,
				relation: String,
				dob: Date,
				gender: String,
				bloodGroup: String,
			},
		],
	},
	{
		timestamps: true,
	},
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  if (!this.isNew) this.authVersion = (this.authVersion || 0) + 1;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.set("toJSON", { transform: (_doc, value) => {
  for (const key of ["password", "inviteToken", "inviteExpiresAt", "authVersion"]) delete value[key];
  return value;
} });

const User = mongoose.model("user", userSchema);

export default User;
