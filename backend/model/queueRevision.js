import mongoose from "mongoose";
const pauseSchema = new mongoose.Schema({ isPaused: {type:Boolean,default:false}, reason:String,
  changedAt:Date, actorId:mongoose.Schema.Types.ObjectId, actorRole:String }, {_id:false});
export default mongoose.model("QueueRevision", new mongoose.Schema({ _id:String, revision:{type:Number,default:0},
  pause:pauseSchema, controlHistory:[{ _id:false, isPaused:Boolean, reason:String, changedAt:Date,
    actorId:mongoose.Schema.Types.ObjectId, actorRole:String, revision:Number }]
}, {autoIndex:false}));
