import mongoose from 'mongoose'

const communitySchema = new mongoose.Schema(
  {
    activityRevision: { type: Number, default: 0 },
    title: {
      type: String,
      required: true,
      unique: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    bio: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: ['Support Group', 'Health', 'Technology', 'Education', 'Others'],
      required: true,
    },
	messages : {
		type: [mongoose.Schema.Types.ObjectId],
		required: false,
	},
	members: {
	  type: [mongoose.Schema.Types.ObjectId],
	  required: false,
	},
    announcements: [
      {
        title: { type: String, required: true },
        content: { type: String, required: true },
        author: { type: mongoose.Schema.Types.ObjectId, ref: 'doctor' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    memberPreferences: [
      {
        memberId: { type: mongoose.Schema.Types.ObjectId },
        emailNotifications: { type: Boolean, default: true },
        inAppNotifications: { type: Boolean, default: true },
      },
    ],
  },
  {
    timestamps: true,
  }
)

const Community = mongoose.model('community', communitySchema)

export default Community
