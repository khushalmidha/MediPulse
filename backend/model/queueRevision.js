import mongoose from "mongoose";
export default mongoose.model("QueueRevision", new mongoose.Schema({ _id: String, revision: { type: Number, default: 0 } }, { autoIndex: false }));
