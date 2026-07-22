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
    },
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
  this.password = await bcrypt.hash(this.password, 12);
});

const User = mongoose.model("user", userSchema);

export default User;
