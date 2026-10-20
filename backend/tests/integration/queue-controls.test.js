import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import {fork} from "node:child_process";
import {once} from "node:events";
import {fileURLToPath} from "node:url";
import {localTestTargets} from "../../util/testTargets.js";
import {sessionToken} from "../fixtures/sessionToken.js";
import {queueContext,patientKey} from "../../services/queueContext.js";
import {queueModels} from "../../services/queueMigration.js";
import {durableModels} from "../../services/durableSchema.js";
import {closeRedis} from "../../services/redis.js";
import QueueRevision from "../../model/queueRevision.js";
import AuthSession from "../../model/authSession.js";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import Doctor from "../../model/doctor.js";
import User from "../../model/user.js";
import OpdToken from "../../model/opdToken.js";
import {CareSession} from "../../model/scheduling.js";
const targets=localTestTargets(),uri=new URL(targets.mongo);uri.pathname="/medipulse_test_controls_"+crypto.randomBytes(6).toString("hex");
const children=[],origins=[],auth={};let hospital,department,doctor,patient,context;
async function startApi(){
 const child=fork(fileURLToPath(new URL("../fixtures/p03-api.mjs",import.meta.url)),[],{execArgv:["--import",new URL("../bootstrap.js",import.meta.url).href],stdio:["ignore","ignore","pipe","ipc"],env:{...process.env,TEST_DATABASE_URL:uri.href,TEST_REDIS_URL:targets.redis}});children.push(child);
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error("Local API startup timed out"));},30000);child.once("message",message=>{clearTimeout(timer);resolve("http://127.0.0.1:"+message.port);});child.once("exit",()=>{clearTimeout(timer);reject(new Error("Local API exited before startup"));});});
}
async function stop(child){if(child.exitCode===null){const ended=once(child,"exit");child.send("stop");await ended;}}
async function http(path,body,actor="doctor",server=0,method="POST"){
 const response=await fetch(origins[server]+path,{method,signal:AbortSignal.timeout(15000),headers:{"Content-Type":"application/json",...(auth[actor]?{Authorization:"Bearer "+auth[actor]}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};
}
const control=(kind,revision=0,actor="doctor",server=0,extra={})=>http("/opd/queue/"+kind,{queueKey:context.queueKey,revision,reason:"Synthetic operational break",...extra},actor,server);
const queue=(server=0)=>http(`/opd/${hospital._id}/${doctor._id}/queue`,undefined,"doctor",server,"GET");
const start=row=>http(`/opd/tokens/${row._id}/start-consultation`,{revision:row.revision},"doctor",0,"PATCH");
async function token(extra={}) {return OpdToken.create({...context,hospitalId:hospital._id,departmentId:department._id,doctorId:doctor._id,patientId:patient._id,personKey:patientKey(patient._id),tokenNumber:1,date:new Date(),arrivedAt:new Date(),status:"waiting",...extra});}
before(async()=>{
 await mongoose.connect(uri.href,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000});await Promise.all([...new Set([...queueModels,...durableModels,AuthSession])].map(Model=>Model.createIndexes()));
 hospital=await Hospital.create({name:"Synthetic Control Hospital",slug:"controls",registrationNumber:"controls",type:"clinic",email:"hospital@example.invalid",address:{city:"Synthetic",state:"Synthetic"},status:"active"});
 department=await Department.create({hospitalId:hospital._id,name:"Synthetic department",opd:{consultationFee:0}});
 const account=await Doctor.create({firstName:"Synthetic",email:"doctor@example.invalid",password:"synthetic-password",gender:"other",experience:{years:1,expertise:"Fixture"}});
 doctor=await HospitalStaff.create({hospitalId:hospital._id,name:"Synthetic doctor",email:"staff@example.invalid",role:"DOCTOR",departmentIds:[department._id],doctorId:account._id,isActive:true,inviteStatus:"accepted"});
 patient=await User.create({firstName:"Synthetic",email:"patient@example.invalid",password:"synthetic-password",gender:"other"});
 auth.doctor=await sessionToken(doctor,"staff");auth.patient=await sessionToken(patient,"user");
 for(const [name,role] of [["nurse","NURSE"],["reception","RECEPTIONIST"],["other","DOCTOR"],["head","DEPARTMENT_HEAD"],["admin","HOSPITAL_ADMIN"]]){
  const row=await HospitalStaff.create({hospitalId:hospital._id,name:"Synthetic "+name,email:name+"@example.invalid",role,departmentIds:[department._id],isActive:true,inviteStatus:"accepted"});auth[name]=await sessionToken(row,"staff");
 }
 context=queueContext({hospital,doctorId:doctor._id});origins.push(await startApi(),await startApi());
});
beforeEach(async()=>{await OpdToken.deleteMany({});await QueueRevision.deleteMany({});});
after(async()=>{for(const child of children)await stop(child);if(mongoose.connection.name===uri.pathname.slice(1))await mongoose.connection.dropDatabase();await mongoose.disconnect();await closeRedis();});

test("queue controls reject anonymous/patient/foreign-doctor and unsupported staff, bad scope and malformed commands",async()=>{
 for(const actor of ["anonymous","patient","nurse","reception","other"]){const result=await control("pause",0,actor);assert.ok([401,403].includes(result.status),actor+":"+result.status);}
 assert.equal((await control("pause",0,"doctor",0,{queueKey:context.queueKey.replace(String(hospital._id),String(new mongoose.Types.ObjectId()))})).status,403);
 for(const extra of [{revision:"0"},{reason:" "},{reason:"x".repeat(301)},{queueKey:"independent:invalid"}])assert.equal((await control("pause",0,"doctor",0,extra)).status,400);
 assert.equal(await QueueRevision.countDocuments({}),0);
});

test("pause persists across API processes and a process restart, blocks start, and only a current resume reopens care",async()=>{
 const visit=await token();assert.equal((await control("pause")).status,200);assert.equal((await queue(1)).body.pause.isPaused,true);
 await stop(children[1]);origins[1]=await startApi();assert.equal((await queue(1)).body.pause.isPaused,true);
 assert.equal((await start(visit)).status,409);assert.equal((await control("resume",0,"doctor",1)).status,409);
 assert.equal((await control("resume",1,"doctor",1)).status,200);assert.equal((await start(visit)).status,200);
 const row=await QueueRevision.findById(context.queueKey);assert.equal(row.pause.isPaused,false);assert.equal(row.controlHistory.length,2);assert.equal(String(row.controlHistory[0].actorId),String(doctor._id));
});

test("two first pause commands consume a queue revision once",async()=>{
 const results=await Promise.all([control("pause",0,"doctor",0),control("pause",0,"doctor",1)]);assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);
 assert.equal((await QueueRevision.findById(context.queueKey)).controlHistory.length,1);
});

test("concurrent pause and start serialize through the same queue revision",async()=>{
 const visit=await token();await QueueRevision.create({_id:context.queueKey,revision:0});
 const [paused,started]=await Promise.all([control("pause",0,"doctor",1),start(visit)]);assert.deepEqual([paused.status,started.status].sort(),[200,409]);
 const final=await OpdToken.findById(visit._id);assert.equal(final.status,paused.status===200?"waiting":"in_consultation");
});

test("pausing permits completion of existing care while blocking the following patient",async()=>{
 const visit=await token();assert.equal((await start(visit)).status,200);assert.equal((await control("pause",1)).status,200);
 assert.equal((await http(`/opd/tokens/${visit._id}/complete`,{revision:1,notes:"Synthetic final notes"},"doctor",0,"PATCH")).status,200);
 const next=await token({tokenNumber:2,personKey:"synthetic-walkin-next",patientId:undefined});assert.equal((await start(next)).status,409);
 assert.equal((await OpdToken.findById(visit._id)).status,"completed");
});

test("paused patient estimates withhold numeric waits and private operational reasons",async()=>{
 const visit=await token();assert.equal((await control("pause",0,"doctor",0,{reason:"Private synthetic operational detail"})).status,200);
 const response=await http(`/opd/tokens/${visit._id}/live-timeline`,undefined,"patient",1,"GET");assert.equal(response.status,200);
 assert.equal(response.body.timeline.eta.doctorStatus,"paused");assert.equal(response.body.timeline.eta.etaRange.minMinutes,null);assert.equal(response.body.timeline.eta.etaRange.maxMinutes,null);
 assert.ok(!JSON.stringify(response.body).includes("Private synthetic operational detail"));
});

test("authorized department heads/admins are audited and unknown or past sessions are rejected",async()=>{
 assert.equal((await control("pause",0,"head")).status,200);assert.equal((await control("resume",1,"admin")).status,200);
 assert.equal((await control("pause",2,"doctor",0,{queueKey:context.queueKey.replace(/:day$/ ,":unknown")})).status,400);
 assert.equal((await control("pause",2,"doctor",0,{queueKey:context.queueKey.replace(context.serviceDate,"2000-01-01")})).status,409);
 const row=await QueueRevision.findById(context.queueKey);assert.deepEqual(row.controlHistory.map(entry=>entry.actorRole),["DEPARTMENT_HEAD","HOSPITAL_ADMIN"]);
});

test("scheduled hospital sessions use their actual persisted queue scope",async()=>{
 const id=new mongoose.Types.ObjectId(),sessionId="s_"+id,queueKey=context.queueKey.replace(/:day$/,":"+sessionId);
 await CareSession.collection.insertOne({_id:id,hospitalId:hospital._id,doctorId:doctor._id,queueKey,sessionId,serviceDate:context.serviceDate,timezone:context.timezone});
 assert.equal((await control("pause",0,"doctor",1,{queueKey})).status,200);
 assert.equal((await QueueRevision.findById(queueKey)).pause.isPaused,true);
});
