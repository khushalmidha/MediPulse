import QueueRevision from "../model/queueRevision.js";
import Hospital from "../model/hospital.js";
import HospitalStaff from "../model/hospitalStaff.js";
import Doctor from "../model/doctor.js";
import { CareSession } from "../model/scheduling.js";
import { accessError, idOf, staffId, departmentMember } from "./hospitalAccess.js";
import { queueContext, localServiceDate } from "./queueContext.js";

export const queueControlInput = ({queueKey,revision,reason}, isPaused) => {
  if(typeof queueKey !== "string" || !/^(?:hospital:[a-f\d]{24}:[a-f\d]{24}|independent:[a-f\d]{24}:[a-f\d]{24}):\d{4}-\d{2}-\d{2}:[A-Za-z0-9_-]{1,64}$/.test(queueKey)) throw accessError(400,"A valid queue key is required");
  if(!Number.isSafeInteger(revision) || revision<0) throw accessError(400,"A current queue revision is required");
  if(isPaused && (typeof reason!=="string" || !reason.trim() || reason.length>300)) throw accessError(400,"An operational pause reason of at most 300 characters is required");
  return {queueKey,revision,reason:isPaused?reason.trim():""};
};
export const getQueuePauseState = async (queueKey, session=null) => {
  if (typeof queueKey!=="string" || (!queueKey.startsWith("hospital:") && !queueKey.startsWith("independent:"))) return {isPaused:false};
  const query=QueueRevision.findById(queueKey);
  const row = await (session ? query.session(session) : query).lean();
  return row?.pause || {isPaused:false};
};
export async function setQueuePaused(options, isPaused) {
  const {queueKey,revision,reason} = queueControlInput(options,isPaused), actor=options.actor;
  const isHospital = queueKey.startsWith("hospital:");
  const pauseActor = {
    isPaused,
    reason,
    changedAt: new Date(),
  };

  if (isHospital) {
    const [,hospitalId,doctorId,serviceDate,sessionId] = queueKey.split(":");
    if(!actor || idOf(actor.hospitalId)!==hospitalId) throw accessError(403,"You cannot control this hospital queue");
    const [hospital,doctor] = await Promise.all([Hospital.findOne({_id:hospitalId,status:"active"}).lean(),HospitalStaff.findOne({_id:doctorId,hospitalId,role:"DOCTOR",isActive:true,inviteStatus:"accepted"}).lean()]);
    if(!hospital || !doctor) throw accessError(404,"Active hospital doctor queue not found");
    const permitted = actor.role==="HOSPITAL_ADMIN" || actor.role==="DOCTOR" && staffId(actor)===doctorId || actor.role==="DEPARTMENT_HEAD" && doctor.departmentIds.some(id=>departmentMember(actor,id));
    if(!permitted) throw accessError(403,"Only the assigned doctor, department head or hospital administrator can control this queue");
    let context;
    if(/^s_[a-f\d]{24}$/.test(sessionId)) {
      const care=await CareSession.findOne({hospitalId,doctorId,queueKey,sessionId,serviceDate}).lean();
      if(!care) throw accessError(404,"Scheduled care queue not found");
      if(serviceDate!==localServiceDate(new Date(),care.timezone)) throw accessError(409,"Only today's care queues can be paused or resumed");
      context=care;
    } else context=queueContext({hospital,doctorId,sessionId,serviceDate});
    if(context.queueKey!==queueKey) throw accessError(409,"Queue context changed; refresh before retrying");
    pauseActor.actorId = staffId(actor);
    pauseActor.actorRole = actor.role;
  } else {
    // Independent practice queue control
    const [,practiceScope,doctorId,serviceDate,sessionId] = queueKey.split(":");
    if (!actor) throw accessError(401, "Sign in is required");
    const doctor = await Doctor.findById(doctorId).lean();
    if (!doctor) throw accessError(404, "Active independent doctor queue not found");
    const actorId = String(actor.id || actor._id);
    const isOwnerDoctor = (actor.role === "doctor" || actor.kind === "doctor" || actor.type === "doctor") && actorId === String(doctorId);
    if (!isOwnerDoctor) throw accessError(403, "Only the assigned doctor can control this independent queue");
    const timezone = doctor.queueTimezone || "Asia/Kolkata";
    if (serviceDate !== localServiceDate(new Date(), timezone)) throw accessError(409, "Only today's care queues can be paused or resumed");
    const sessions = doctor.queueSessionIds || ["day"];
    if (!sessions.includes(sessionId)) throw accessError(400, "Unknown care session");
    pauseActor.actorId = actorId;
    pauseActor.actorRole = "DOCTOR";
  }

  try {
    const changed=await QueueRevision.findOneAndUpdate({_id:queueKey,...(revision===0?{$or:[{revision:0},{revision:{$exists:false}}]}:{revision})},
      {$set:{pause: pauseActor},$inc:{revision:1},$push:{controlHistory:{...pauseActor,revision:revision+1}}},{upsert:revision===0,new:true,runValidators:true});
    if(!changed) throw accessError(409,"Queue changed; refresh before retrying");
    return {queueKey,queueRevision:changed.revision,pause:changed.pause};
  } catch(error) {if(error.code===11000) throw accessError(409,"Queue changed; refresh before retrying");throw error;}
}
