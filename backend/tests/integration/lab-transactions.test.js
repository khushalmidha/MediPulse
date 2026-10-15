import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import { localTestTargets } from "../../util/testTargets.js";
import User from "../../model/user.js";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import AuthSession from "../../model/authSession.js";
import OpdToken from "../../model/opdToken.js";
import LabOrder from "../../model/labOrder.js";
import LabTestCatalog from "../../model/labTestCatalog.js";
import labRouter from "../../routes/lab.js";
import { setLabTransactionFault } from "../../services/labWorkflow.js";
import { closeRedis } from "../../services/redis.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_labs_" + crypto.randomBytes(6).toString("hex");
const id = () => new mongoose.Types.ObjectId();
const hospital = id(), foreign = id(), department = id(), labDepartment = id(), wrongDepartment = id();
const patient = id(), stranger = id(), family = id(), doctor = id(), tech = id(), reviewer = id(), pathologist = id(), admin = id(), wrongTech = id();
const token = id(), catalog = id(), sessions = {};
let server, origin;
const parameters = [{ code: "VALUE", name: "Synthetic parameter", unit: "configured-unit", refMin: 2, refMax: 4, criticalLow: 1, criticalHigh: 5 }];
async function http(path, who, body, method = body ? "POST" : "GET", key) {
  const response = await fetch(origin + "/api/labs" + path, { method, signal: AbortSignal.timeout(15000), headers: {
    "Content-Type": "application/json", ...(who ? { Authorization: "Bearer " + sessions[who] } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function approval(who = "reviewer", enabled = true) {
  const targets = { reviewer, tech, pathologist, admin, wrongTech };
  return http("/reviewers/" + targets[who] + "/approval", "admin", { enabled, departmentIds: [String(labDepartment)], qualificationReference: "Isolated synthetic qualification review reference" });
}
async function order() {
  const response = await http("/orders", "doctor", { tokenId: String(token), serviceDepartmentId: String(labDepartment), tests: [{ catalogId: String(catalog) }] });
  assert.equal(response.status, 201); return response.body.order;
}
const values = value => [{ testCode: "SYN", parameterCode: "VALUE", value, unit: "forged", isCritical: false, flag: "normal" }];
async function execute(order, kind, body = {}, who = "tech", key = crypto.randomUUID()) {
  return http("/orders/" + order._id + "/" + kind, who, { expectedRevision: order.workflowRevision, ...body }, ["results", "correct", "acknowledge-critical"].includes(kind) ? "POST" : "PATCH", key);
}
async function entered(value = 3) {
  let record = await order(); record = (await execute(record,"collect")).body.order;
  const saved = await execute(record,"results",{ results: values(value) }); assert.equal(saved.status,200); return saved.body.order;
}
async function released(value = 3) {
  let record = await entered(value); record = (await execute(record,"verify",{},"reviewer")).body.order;
  const result = await execute(record,"release",{},"reviewer"); assert.equal(result.status,200); return result.body.order;
}
before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, serverSelectionTimeoutMS: 3000 });
  await User.collection.insertMany([{ _id: patient, firstName: "Synthetic Account", authVersion: 0,
    familyMembers: [{ _id: family, name: "Synthetic Family", archivedAt: new Date() }] }, { _id: stranger, firstName: "Synthetic Stranger", authVersion: 0 }]);
  await Hospital.collection.insertMany([hospital,foreign].map(_id => ({ _id, name: "Synthetic Hospital", slug: String(_id), status: "active" })));
  await Department.collection.insertMany([department,labDepartment,wrongDepartment].map(_id => ({ _id, hospitalId: hospital, name: "Synthetic Department", status: "active" })));
  for (const [who,_id,role,dept] of [["doctor",doctor,"DOCTOR",department],["tech",tech,"LAB_TECH",labDepartment],["reviewer",reviewer,"LAB_TECH",labDepartment],
    ["pathologist",pathologist,"DOCTOR",labDepartment],["admin",admin,"HOSPITAL_ADMIN",department],["wrongTech",wrongTech,"LAB_TECH",wrongDepartment]]) {
    await HospitalStaff.collection.insertOne({ _id, hospitalId: hospital, role, departmentIds: [dept], name: "Synthetic " + who, email: who + "@synthetic.invalid", isActive: true, inviteStatus: "accepted", authVersion: 0,
      adminAccess: who === "tech" });
    const sid = crypto.randomUUID(); await AuthSession.create({ _id: sid, principalId: _id, kind: "staff", csrfToken: "isolated-csrf", expiresAt: new Date(Date.now()+600000) });
    sessions[who] = jwt.sign({ id: String(_id), hospitalId: String(hospital), role: "staff", type: "staff", sid }, process.env.TOKEN_KEY);
  }
  for (const [who,_id] of [["patient",patient],["stranger",stranger]]) {
    const sid = crypto.randomUUID(); await AuthSession.create({ _id: sid, principalId: _id, kind: "user", csrfToken: "isolated-csrf", expiresAt: new Date(Date.now()+600000) });
    sessions[who] = jwt.sign({ id: String(_id), role: "user", sid }, process.env.TOKEN_KEY);
  }
  await OpdToken.collection.insertOne({ _id: token, hospitalId: hospital, departmentId: department, doctorId: doctor, patientId: patient,
    familyMemberId: family, personKey: "synthetic-family", patientInfo: { name: "Synthetic Family" }, tokenNumber: 1, status: "in_consultation", serviceDate: "2026-10-12" });
  await LabTestCatalog.create({ _id: catalog, hospitalId: hospital, code: "SYN", name: "Synthetic Test", parameters });
  const app = express(); app.use(express.json(),cookieParser()); app.use("/api/labs",labRouter);
  app.use((err,req,res,next) => res.status(err.status || 500).json({ message: err.message }));
  server = app.listen(0,"127.0.0.1"); await once(server,"listening"); origin = "http://127.0.0.1:" + server.address().port;
  const initialApproval = await approval(); assert.equal(initialApproval.status,200,JSON.stringify(initialApproval.body));
});
after(async () => { setLabTransactionFault(null); if (server) await new Promise(resolve => server.close(resolve)); if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase(); await mongoose.disconnect(); await closeRedis(); });

test("hospital approval is explicit, scoped, audited and cannot be self granted or forged", async () => {
  assert.equal((await http("/reviewers/"+tech+"/approval","tech",{ enabled:true, departmentIds:[String(labDepartment)], qualificationReference:"Synthetic" })).status,403);
  assert.equal((await approval("admin")).status,403); assert.equal((await approval("wrongTech")).status,403);
  assert.deepEqual((await http("/capabilities","tech")).body.reviewDepartmentIds,[]);
  const grant = await HospitalStaff.findById(reviewer).lean(); assert.equal(String(grant.labReviewApproval.approvedBy),String(admin)); assert.equal(grant.labReviewApprovalHistory.length,1);
});
test("collection before billing is allowed with server-unique accession and immutable sample history", async () => {
  const a=await order(),b=await order();
  const [one,two]=await Promise.all([execute(a,"collect"),execute(b,"collect")]); assert.equal(one.status,200); assert.equal(two.status,200);
  assert.notEqual(one.body.order.accessionBarcode,two.body.order.accessionBarcode);
  let rejected=await execute(one.body.order,"reject",{ reason:"Synthetic rejection",requestRecollection:true }); assert.equal(rejected.status,200);
  const recollected=await execute(rejected.body.order,"collect"); assert.equal(recollected.status,200); assert.notEqual(recollected.body.order.accessionBarcode,one.body.order.accessionBarcode);
  const stored=await LabOrder.findById(a._id).lean(); assert.equal(stored.samples.length,2); assert.equal(stored.samples[0].rejectionReason,"Synthetic rejection");
  assert.equal((await execute(b,"collect",{ barcode:"FORGED" })).status,400);
});
test("concurrent same-key collection executes once, changed contents and stale new commands fail", async () => {
  const record=await order(),key=crypto.randomUUID(); const result=await Promise.all([execute(record,"collect",{},"tech",key),execute(record,"collect",{},"tech",key)]);
  assert.deepEqual(result.map(r=>r.status),[200,200]); assert.equal((await LabOrder.findById(record._id)).samples.length,1);
  assert.equal((await execute(record,"collect")).status,409);
  assert.equal((await execute(record,"reject",{ reason:"Synthetic" },"tech",key)).status,409);
});
test("competing result writers cannot silently overwrite each other's report version", async () => {
  const record=(await execute(await order(),"collect")).body.order;
  const result=await Promise.all([execute(record,"results",{ results:values(3) }),execute(record,"results",{ results:values(4) })]);
  assert.deepEqual(result.map(r=>r.status).sort(),[200,409]); const stored=await LabOrder.findById(record._id); assert.equal(stored.reportVersions.length,1);
});
test("results use snapshotted parameters and derive critical flags despite client/catalog changes", async () => {
  let record=await order(); await LabTestCatalog.updateOne({ _id:catalog },{ $set:{ parameters:[{ ...parameters[0],criticalHigh:50,unit:"changed" }] } });
  try { record=(await execute(record,"collect")).body.order; const saved=await execute(record,"results",{ results:values(6) }); assert.equal(saved.status,200);
    assert.equal(saved.body.order.results[0].flag,"critical_high"); assert.equal(saved.body.order.results[0].unit,"configured-unit");
    const stored=await LabOrder.findById(record._id).lean(); assert.equal(stored.criticalValueAlert.notifiedAt,undefined);
  } finally { await LabTestCatalog.updateOne({ _id:catalog },{ $set:{ parameters } }); }
});
test("unknown, duplicate, partial, object and nonnumeric results preserve the prior state", async () => {
  const record=(await execute(await order(),"collect")).body.order, before=await LabOrder.findById(record._id).lean();
  for (const results of [[], [...values(3),...values(3)], [{ ...values(3)[0], parameterCode:"unknown" }], values("3"), values({ injected:true })]) assert.equal((await execute(record,"results",{ results })).status,400);
  assert.deepEqual(await LabOrder.findById(record._id).lean(),before);
});
test("approval and independent reviewer are required, and assigned service doctors can review", async () => {
  const record=await entered(); assert.equal((await execute(record,"verify",{},"tech")).status,403); assert.equal((await execute(record,"verify",{},"doctor")).status,403);
  assert.equal((await approval("tech")).status,200);
  try { assert.equal((await execute(record,"verify",{},"tech")).status,403); } finally { await approval("tech",false); }
  assert.equal((await approval("pathologist")).status,200); const review=await execute(record,"verify",{},"pathologist"); assert.equal(review.status,200);
  assert.equal(review.body.order.verifiedByName,"Synthetic pathologist"); assert.ok((await http("/orders","pathologist")).body.orders.some(o=>o._id===record._id));
  await approval("pathologist",false); assert.equal((await execute(review.body.order,"release",{},"pathologist")).status,403);
});
test("drafts stay private and correction preserves released results until independent re-review and release", async () => {
  let record=await released(3); const prior=JSON.stringify((await LabOrder.findById(record._id)).reportVersions[0].toObject());
  const amended=await execute(record,"correct",{ reason:"Synthetic analyzer re-run", results:values(6) }); assert.equal(amended.status,200); record=amended.body.order;
  assert.equal(record.orderStatus,"result_entered"); assert.equal(record.reportVersion,2);
  let view=(await http("/patient-results","patient")).body.results.find(o=>o._id===record._id); assert.equal(view.reportVersion,1); assert.equal(view.results[0].value,3);
  assert.doesNotMatch(JSON.stringify(view),/reportVersions|workflowCommands|authorId|criticalTask|clinicalNotes|qualificationReference/);
  assert.equal((await execute(record,"release",{},"reviewer")).status,409);
  record=(await execute(record,"verify",{},"reviewer")).body.order;
  view=(await http("/patient-results","patient")).body.results.find(o=>o._id===record._id); assert.equal(view.reportVersion,1);
  record=(await execute(record,"release",{},"reviewer")).body.order;
  view=(await http("/patient-results","patient")).body.results.find(o=>o._id===record._id); assert.equal(view.reportVersion,2); assert.equal(view.results[0].value,6);
  assert.equal(JSON.stringify((await LabOrder.findById(record._id)).reportVersions[0].toObject()),prior);
  assert.deepEqual((await http("/patient-results","stranger")).body.results,[]);
});
test("critical acknowledgement tasks are durable per reviewed version and old tasks survive a normal correction", async () => {
  let record=await released(6); assert.ok(record.reportVersions[0].criticalTask.createdAt);
  const corrected=await execute(record,"correct",{ reason:"Synthetic correction",results:values(3) }); assert.equal(corrected.status,200); record=corrected.body.order;
  assert.ok((await http("/orders?critical=pending","doctor")).body.orders.some(o=>o._id===record._id));
  assert.equal((await execute(record,"acknowledge-critical",{ reportVersion:1 },"pathologist")).status,403);
  const ack=await execute(record,"acknowledge-critical",{ reportVersion:1 },"doctor"); assert.equal(ack.status,200);
  assert.equal(ack.body.order.reportVersions[0].criticalTask.acknowledgedById,String(doctor));
  assert.equal((await execute(ack.body.order,"acknowledge-critical",{ reportVersion:1 },"doctor")).status,409);
});
test("rejection cannot replace verified/released status and unrequested recollection fails", async () => {
  const record=await released(); assert.equal((await execute(record,"reject",{ reason:"Synthetic rejection" })).status,409);
  const sample=(await execute(await order(),"collect")).body.order;
  const rejected=await execute(sample,"reject",{ reason:"Synthetic rejection",requestRecollection:false }); assert.equal(rejected.status,200);
  assert.equal((await execute(rejected.body.order,"collect")).status,409);
});
test("faults before order save roll back task, audit, command and authorization fence together", async () => {
  const record=await entered(6),before=await LabOrder.findById(record._id).lean(),staff=await HospitalStaff.findById(reviewer).lean();
  setLabTransactionFault(()=>{ throw new Error("Synthetic laboratory crash"); });
  try { assert.equal((await execute(record,"verify",{},"reviewer")).status,500); } finally { setLabTransactionFault(null); }
  assert.deepEqual(await LabOrder.findById(record._id).lean(),before); assert.deepEqual(await HospitalStaff.findById(reviewer).lean(),staff);
});
test("historical provenance is preserved and remains readable without invented workflow adoption", async () => {
  const record=await order(); await LabOrder.updateOne({ _id:record._id },{ $unset:{ workflowVersion:1 } });
  const before=await LabOrder.findById(record._id).lean(); assert.equal((await execute(record,"collect")).status,409); assert.deepEqual(await LabOrder.findById(record._id).lean(),before);
});
test("concurrent approval revocation cannot publish using a stale transaction snapshot", async () => {
  let record=await entered(); record=(await execute(record,"verify",{},"reviewer")).body.order;
  let revoked=false;
  setLabTransactionFault(async phase=>{ if (phase === "beforeAuthorizationFence" && !revoked) { revoked=true; await HospitalStaff.updateOne({ _id:reviewer },{ $set:{ "labReviewApproval.enabled":false } }); } });
  try { assert.equal((await execute(record,"release",{},"reviewer")).status,403); assert.equal((await LabOrder.findById(record._id)).orderStatus,"verified"); }
  finally { setLabTransactionFault(null); await approval(); }
});
test("keys/revisions and assigned service access are enforced without leaking operational keys", async () => {
  const record=await order(); assert.equal((await http("/orders/"+record._id+"/collect","tech",{},"PATCH")).status,428);
  assert.equal((await execute(record,"collect",{},"wrongTech")).status,403);
  assert.equal((await execute(record,"collect",{},"admin")).status,403);
  const saved=await execute(record,"collect"); assert.equal(saved.status,200); assert.doesNotMatch(JSON.stringify(saved.body),/workflowCommands|"hash"|"key"/);
});
test("browser cookie writes reject missing staff CSRF and accept the actual staff token", async () => {
  const record=await order(),path=origin+"/api/labs/orders/"+record._id+"/collect",key=crypto.randomUUID();
  const headers={ "Content-Type":"application/json", Cookie:"staffToken="+sessions.tech, Origin:"http://127.0.0.1:15173", "Idempotency-Key":key };
  const denied=await fetch(path,{ method:"PATCH", headers, body:JSON.stringify({ expectedRevision:0 }) }); assert.equal(denied.status,403);
  const accepted=await fetch(path,{ method:"PATCH", headers:{ ...headers,"X-CSRF-Token":"isolated-csrf" }, body:JSON.stringify({ expectedRevision:0 }) }); assert.equal(accepted.status,200);
});
test("colliding catalog codes cannot create an ambiguous ordered parameter set", async () => {
  const duplicate=await LabTestCatalog.create({ hospitalId:hospital,code:"SYN",name:"Synthetic duplicate",parameters });
  try {
    const before=await LabOrder.countDocuments();
    const result=await http("/orders","doctor",{ tokenId:String(token),serviceDepartmentId:String(labDepartment),tests:[{catalogId:String(catalog)},{catalogId:String(duplicate._id)}] });
    assert.equal(result.status,409);assert.equal(await LabOrder.countDocuments(),before);
  } finally { await LabTestCatalog.deleteOne({_id:duplicate._id}); }
});
test("history byte limit fails without truncating records or partially collecting a sample", async () => {
  const record=await order();
  await LabOrder.updateOne({_id:record._id},{$set:{auditHistory:[{stage:"synthetic-large-history",notes:"x".repeat(8*1024*1024)}]}});
  assert.equal((await execute(record,"collect")).status,409);
  const retained=await LabOrder.findById(record._id).lean();assert.equal(retained.orderStatus,"ordered");assert.equal(retained.samples.length,0);
  assert.equal(retained.auditHistory[0].notes.length,8*1024*1024);assert.equal(retained.workflowCommands.length,0);
});
