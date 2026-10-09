import mongoose from "mongoose";

const opdSequenceSchema = new mongoose.Schema({
  queueKey: String,
  sessionId: String,
  hospitalId: { type: mongoose.Schema.Types.ObjectId, required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  seq: { type: Number, default: 0 }
}, { autoIndex: false });

opdSequenceSchema.index({ queueKey: 1 }, { unique: true, name: "queue_sequence_p03", partialFilterExpression: { queueKey: { $type: "string" } } });

const OpdSequence = mongoose.model("OpdSequence", opdSequenceSchema);
export default OpdSequence;
