import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
	{
		author: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
		},
    author_name: {
      type:String,
      required:true,
    },
		content: {
			type: String,
			required: true,
		},
    community: {
      type: mongoose.Schema.Types.ObjectId
    },
    isAnnouncement: {
      type: Boolean,
      default: false,
    },
    isRemoved: {
      type: Boolean,
      default: false,
    },
    reports: [
      {
        reportedBy: { type: mongoose.Schema.Types.ObjectId },
        reason: { type: String, required: true },
        reportedAt: { type: Date, default: Date.now },
      },
    ],
    originalContent: {
      type: String,
    },
    moderatedBy: {
      type: mongoose.Schema.Types.ObjectId,
    },
    moderatedAt: {
      type: Date,
    },
	},
	{
		timestamps: true,
	},
);

const Message = mongoose.model("message", messageSchema);

export default Message;
