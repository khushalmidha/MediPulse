import { readFileSync } from "node:fs";
import doctorRoutes from "../../routes/doctor.js";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import cookieParser from "cookie-parser";
import { once } from "node:events";
import { localTestTargets } from "../../util/testTargets.js";
import { sessionToken } from "../fixtures/sessionToken.js";
import routes from "../../routes/appointment.js";
import copilotRoutes from "../../routes/copilot.js";
import Appointment from "../../model/appointment.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import AuthSession from "../../model/authSession.js";
import OpdToken from "../../model/opdToken.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import { queueContext, patientKey } from "../../services/queueContext.js";
import { applyDurableSchema } from "../../services/durableSchema.js";
import { getRedis, closeRedis } from "../../services/redis.js";
import { commitClinicalEdit } from "../../services/clinicalWrites.js";
// Mount the same path declared by the actual server, rather than a fixture-only alias.
const serverSource=readFileSync(new URL("../../index.js",import.meta.url),"utf8");
const copilotMount=/app\.use\(['"]([^'"]+)['"],\s*copilotRouter\)/.exec(serverSource)?.[1];
assert.equal(copilotMount,"/api/copilot","Production copilot mount changed; review its client contract");
const uri=new URL(localTestTargets().mongo);uri.pathname="/medipulse_test_clinical_"+crypto.randomBytes(6).toString("hex");
let server,origin,doctor,patient;const auth={};
async function http(path,body,actor="doctor",method="POST") {
 const response=await fetch(origin+path,{method,signal:AbortSignal.timeout(15000),headers:{"Content-Type":"application/json",Authorization:"Bearer "+auth[actor]},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:response.status,body:await response.json()};
}
const path=(row,suffix)=>`/appointment/${row._id}/${suffix}`;
const notes=(row,revision,text="New synthetic note")=>http(path(row,"notes"),{revision,doctorNotes:text},"doctor","PATCH");
async function visit(fields={}) {return Appointment.create({...queueContext({doctorId:doctor._id,doctor:{queueSessionIds:["day"]}}),user:patient._id,personKey:patientKey(patient._id),doctor:doctor._id,roomId:crypto.randomUUID(),status:"active",visitMode:"online",doctorNotes:"Original synthetic note",revision:0,...fields});}
before(async()=>{
 await mongoose.connect(uri.href,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000});
 await Promise.all([Appointment,User,Doctor,AuthSession,OpdToken,HospitalStaff].map(Model=>Model.createIndexes()));await applyDurableSchema();
 patient=await User.create({firstName:"Synthetic",email:"patient@example.invalid",password:"synthetic-password",gender:"other"});
 doctor=await Doctor.create({firstName:"Synthetic",email:"doctor@example.invalid",password:"synthetic-password",gender:"other",experience:{years:1,expertise:"Fixture"}});
 const foreign=await Doctor.create({firstName:"Other Synthetic",email:"foreign@example.invalid",password:"synthetic-password",gender:"other",experience:{years:1,expertise:"Fixture"}});
 auth.doctor=await sessionToken(doctor,"doctor");auth.patient=await sessionToken(patient,"user");auth.foreign=await sessionToken(foreign,"doctor");
 const app=express();app.use(express.json(),cookieParser());app.use("/appointment",routes);app.use(copilotMount,copilotRoutes);app.use("/doctor",doctorRoutes);app.use((err,_req,res,_next)=>res.status(err.status||500).json({message:err.status?err.message:"Isolated failure"}));
 server=app.listen(0,"127.0.0.1");await once(server,"listening");origin="http://127.0.0.1:"+server.address().port;
});
beforeEach(async()=>{await Appointment.deleteMany({});});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(mongoose.connection.name===uri.pathname.slice(1))await mongoose.connection.dropDatabase();await mongoose.disconnect();await closeRedis();});

test("notes require typed text/revision and assigned doctor access",async()=>{
 const row=await visit();for(const body of [{doctorNotes:"x"},{revision:-1,doctorNotes:"x"},{revision:"0",doctorNotes:"x"},{revision:0,doctorNotes:{}},{revision:0,doctorNotes:"x".repeat(12001)}])assert.equal((await http(path(row,"notes"),body,"doctor","PATCH")).status,400);
 for(const actor of ["patient","foreign"])assert.equal((await http(path(row,"notes"),{revision:0,doctorNotes:"denied"},actor,"PATCH")).status,403);
 assert.equal((await Appointment.findById(row._id)).doctorNotes,"Original synthetic note");
});
test("parallel saves have one winner and preserve the previous clinical snapshot",async()=>{
 const row=await visit();const results=await Promise.all([notes(row,0,"Tab A"),notes(row,0,"Tab B")]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 const saved=await Appointment.findById(row._id);assert.equal(saved.revision,1);assert.equal(saved.clinicalHistory.length,1);assert.equal(saved.clinicalHistory[0].doctorNotes,"Original synthetic note");assert.equal(String(saved.clinicalHistory[0].actorId),String(doctor._id));
 assert.equal((await notes(row,0,"late overwrite")).status,409);assert.equal((await Appointment.findById(row._id)).doctorNotes,saved.doctorNotes);
});
test("terminal records refuse note and document replacement",async()=>{
 for(const status of ["completed","cancelled"]){const row=await visit({status});assert.equal((await notes(row,0)).status,409);assert.equal((await http(path(row,"receipt"),{revision:0,doctorNotes:"edit"})).status,409);assert.equal((await Appointment.findById(row._id)).doctorNotes,"Original synthetic note");}
});
test("delayed document generation cannot overwrite a newer note",async()=>{
 const row=await visit();const original=Appointment.findOneAndUpdate;let ready,release;
 const reached=new Promise(resolve=>{ready=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 Appointment.findOneAndUpdate=async function(...args){if(args[1]?.$set?.receiptText){ready();await gate;}return original.apply(this,args);};
 try{const pending=http(path(row,"receipt"),{revision:0,doctorNotes:"Document draft"});await reached;assert.equal((await notes(row,0,"Newer note")).status,200);release();assert.equal((await pending).status,409);const saved=await Appointment.findById(row._id);assert.equal(saved.doctorNotes,"Newer note");assert.equal(saved.receiptText,"");}finally{release();Appointment.findOneAndUpdate=original;}
});
test("document consent is preserved unless explicitly changed and malformed values are refused",async()=>{
 const row=await visit({voiceConsentRecorded:true,voiceConsentKeywords:["synthetic"],voiceConsentTimestamp:new Date("2026-10-01T00:00:00Z")});
 assert.equal((await http(path(row,"receipt"),{revision:0,voiceConsentRecorded:"false"})).status,400);
 const result=await http(path(row,"receipt"),{revision:0,doctorNotes:""});assert.equal(result.status,200);assert.equal(result.body.revision,1);const saved=await Appointment.findById(row._id);assert.equal(saved.doctorNotes,"");assert.equal(saved.voiceConsentRecorded,true);assert.deepEqual([...saved.voiceConsentKeywords],["synthetic"]);assert.ok(!saved.receiptText.includes("Original synthetic note"));
});
test("SOAP review binds record revision, generated version and source notes",async()=>{
 const row=await visit();const generated=await http(`${copilotMount}/${row._id}/generate-soap`,{revision:0,doctorNotes:"Synthetic SOAP source"});assert.equal(generated.status,200);assert.equal(generated.body.revision,1);assert.equal(generated.body.soapNote.version,1);
 assert.equal((await http(path(row,"soap-note/approve"),{revision:1})).status,400);assert.equal((await http(path(row,"soap-note/approve"),{revision:1,noteVersion:99})).status,409);
 const approved=await http(path(row,"soap-note/approve"),{revision:1,noteVersion:1});assert.equal(approved.status,200);assert.equal(approved.body.revision,2);assert.equal(approved.body.soapNote.clinicianApproved,true);
 assert.equal((await notes(row,2,"Changed source note")).status,200);assert.equal((await http(path(row,"soap-note/approve"),{revision:3,noteVersion:1})).status,409);
 const saved=await Appointment.findById(row._id);assert.equal(saved.soapNote.clinicianApproved,false);assert.ok(saved.clinicalHistory.some(x=>x.soapNote?.clinicianApproved===true));
});
test("legacy reviewed SOAP stays preserved without bypassing versioned approval",async()=>{
 const row=await visit({soapNote:{markdown:"Preserved historical review",clinicianApproved:true,isDraft:false,approvedBy:doctor._id,approvedAt:new Date()}});
 assert.equal((await http(path(row,"soap-note/approve"),{revision:0,noteVersion:1})).status,409);assert.equal((await notes(row,0)).status,200);
 const saved=await Appointment.findById(row._id);assert.equal(saved.clinicalHistory[0].soapNote.markdown,"Preserved historical review");assert.equal(saved.clinicalHistory[0].soapNote.clinicianApproved,true);
});
test("clinical compare-and-set loses safely against a completion revision",async()=>{
 const row=await visit();await Appointment.updateOne({_id:row._id,revision:0},{$set:{status:"completed"},$inc:{revision:1}});
 await assert.rejects(commitClinicalEdit({appointment:row,revision:0,actorId:doctor._id,fields:{doctorNotes:"late"},reason:"fixture"}),error=>error.status===409);assert.equal((await Appointment.findById(row._id)).doctorNotes,"Original synthetic note");
});
test("real completion uses the saved revision and preserves reviewed SOAP and patient projection",async()=>{
 const row=await visit();assert.equal((await notes(row,0,"Final synthetic notes")).status,200);assert.equal((await http(path(row,"end"),{revision:0})).status,409);
 const generated=await http(`${copilotMount}/${row._id}/generate-soap`,{revision:1,doctorNotes:"Final synthetic notes"});assert.equal(generated.status,200);
 assert.equal((await http(path(row,"soap-note/approve"),{revision:2,noteVersion:2})).status,200);const ended=await http(path(row,"end"),{revision:3});assert.equal(ended.status,200,ended.body.message);
 const final=await Appointment.findById(row._id);assert.equal(final.status,"completed");assert.equal(final.doctorNotes,"Final synthetic notes");assert.equal(final.soapNote.clinicianApproved,true);assert.equal(final.soapNote.version,2);
 const view=await http(`/appointment/${row._id}`,undefined,"patient","GET");assert.equal(view.status,200);assert.equal(view.body.clinicalHistory,undefined);assert.equal(view.body.soapNote,undefined);
});

test("parallel SOAP approvals cannot both record a review",async()=>{
 const row=await visit();assert.equal((await http(`${copilotMount}/${row._id}/generate-soap`,{revision:0,doctorNotes:"Review source"})).status,200);
 const results=await Promise.all([http(path(row,"soap-note/approve"),{revision:1,noteVersion:1}),http(path(row,"soap-note/approve"),{revision:1,noteVersion:1})]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 const saved=await Appointment.findById(row._id);assert.equal(saved.revision,2);assert.equal(saved.clinicalHistory.length,2);
});
test("a legacy active row without persisted revision accepts only one initial save",async()=>{
 const row=await visit();await Appointment.collection.updateOne({_id:row._id},{$unset:{revision:""}});
 const results=await Promise.all([notes(row,0,"Legacy A"),notes(row,0,"Legacy B")]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal((await Appointment.findById(row._id)).revision,1);
});


test("completion retains the preceding unapproved SOAP draft in clinical history",async()=>{
 const row=await visit({soapNote:{markdown:"Earlier synthetic unapproved draft",isDraft:true,clinicianApproved:false}});
 const result=await http(path(row,"end"),{revision:0});assert.equal(result.status,200,result.body.message);
 const saved=await Appointment.findById(row._id);assert.equal(saved.status,"completed");
 assert.ok(saved.clinicalHistory.some(snapshot=>snapshot.reason==="completion-draft" && snapshot.soapNote?.markdown==="Earlier synthetic unapproved draft"));
});

test("SOAP generation rejects explicit null notes without replacing saved content",async()=>{
 const row=await visit();assert.equal((await http(`${copilotMount}/${row._id}/generate-soap`,{revision:0,doctorNotes:null})).status,400);
 assert.equal((await Appointment.findById(row._id)).doctorNotes,"Original synthetic note");
});


test("post-commit assistant cache failure does not report a persisted SOAP draft as failed",async()=>{
 const row=await visit(),redis=getRedis(),original=redis.del;
 redis.del=async()=>{throw new Error("Synthetic cache failure");};
 try {
  const result=await http(`${copilotMount}/${row._id}/generate-soap`,{revision:0,doctorNotes:"Persisted synthetic source"});
  assert.equal(result.status,200,result.body.message);assert.equal(result.body.revision,1);
  assert.equal((await Appointment.findById(row._id)).soapNote.sourceNotesHash,result.body.soapNote.sourceNotesHash);
 } finally {redis.del=original;}
});


test("real competing note-save and completion requests cannot both consume the same revision",async()=>{
 const row=await visit();
 const [edit,end]=await Promise.all([notes(row,0,"Competing synthetic note"),http(path(row,"end"),{revision:0})]);
 assert.deepEqual([edit.status,end.status].sort(),[200,409]);
 const saved=await Appointment.findById(row._id);
 if(edit.status===200){assert.equal(saved.status,"active");assert.equal(saved.doctorNotes,"Competing synthetic note");}
 else {assert.equal(saved.status,"completed");assert.equal(saved.doctorNotes,"Original synthetic note");}
});


const recordPath=row=>`/doctor/appointments/${row._id}/consultation-records`;
test("alternate consultation-record writes cannot bypass revision or terminal guards",async()=>{
 const row=await visit();assert.equal((await http(recordPath(row),{doctorNotes:"missing revision"},"doctor","PUT")).status,400);
 const result=await http(recordPath(row),{revision:0,doctorNotes:"Reviewed source",draftNotes:"Synthetic draft",followUp:{status:"recommended",notes:"Synthetic recommendation"}},"doctor","PUT");
 assert.equal(result.status,200,result.body.message);assert.equal(result.body.appointment.revision,1);assert.equal(result.body.appointment.followUp.status,"recommended");
 assert.equal((await notes(row,0,"stale bypass")).status,409);
 await Appointment.updateOne({_id:row._id},{$set:{status:"completed"}});
 assert.equal((await http(recordPath(row),{revision:1,doctorNotes:"terminal bypass"},"doctor","PUT")).status,409);
});

test("both clinical write endpoints share one concurrent winner and preserve review history",async()=>{
 const row=await visit({draftNotes:"Earlier synthetic draft",soapNote:{markdown:"Earlier reviewed text",version:1,clinicianApproved:true,isDraft:false}});
 const results=await Promise.all([notes(row,0,"Endpoint A"),http(recordPath(row),{revision:0,doctorNotes:"Endpoint B"},"doctor","PUT")]);
 assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
 const saved=await Appointment.findById(row._id);assert.equal(saved.revision,1);assert.equal(saved.soapNote.clinicianApproved,false);assert.equal(saved.clinicalHistory[0].draftNotes,"Earlier synthetic draft");assert.equal(saved.clinicalHistory[0].soapNote.clinicianApproved,true);
});

test("consultation records reject malformed input, invented scheduled status and foreign actors",async()=>{
 const row=await visit();
 for(const fields of [{doctorNotes:{}},{draftNotes:null},{followUp:[]},{followUp:{status:"scheduled"}},{followUp:{scheduledDate:"invalid"}}])assert.equal((await http(recordPath(row),{revision:0,...fields},"doctor","PUT")).status,400);
 assert.equal((await http(recordPath(row),{revision:0,doctorNotes:"denied"},"patient","PUT")).status,403);
 assert.equal((await http(recordPath(row),{revision:0,doctorNotes:"denied"},"foreign","PUT")).status,404);
 assert.equal((await Appointment.findById(row._id)).revision,0);
});

test("the fixture-only copilot alias is absent from the production-mounted app",async()=>{
 const row=await visit();const response=await fetch(origin+`/copilot/${row._id}/generate-soap`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+auth.doctor},body:JSON.stringify({revision:0,doctorNotes:"Synthetic source"})});assert.equal(response.status,404);
});
