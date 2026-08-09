import mongoose from "mongoose";

const opdSequenceSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  seq: { type: Number, default: 0 }
});

opdSequenceSchema.index({ hospitalId: 1, doctorId: 1, date: 1 }, { unique: true });

const OpdSequence = mongoose.model("OpdSequence", opdSequenceSchema);
export default OpdSequence;
