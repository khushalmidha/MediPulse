import crypto from "node:crypto";
import mongoose from "mongoose";
import Appointment from "../model/appointment.js";
import OpdToken from "../model/opdToken.js";
import EncounterJourney from "../model/encounterJourney.js";
import { queueContext, patientKey } from "./queueContext.js";

export const FOXO_ACCOUNTS = Object.freeze({ patient: "khushalmidha24@gmail.com", doctor: "khushalmidha18@gmail.com" });
export const FOXO_LABEL = "SYNTHETIC FOXO DEMO — fictional history, not medical advice or an actual consultation.";
const { ObjectId } = mongoose.mongo;
const { EJSON } = mongoose.mongo.BSON;
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const foxoHash = value => crypto.createHash("sha256").update(JSON.stringify(stable(EJSON.serialize(value, { relaxed: false })))).digest("hex");
const oid = text => new ObjectId(crypto.createHash("sha256").update(text).digest("hex").slice(0, 24));
const same = (a, b) => String(a) === String(b);
const opts = session => session ? { session } : {};

async function source(db, session) {
  const options = opts(session);
  const patient = await db.collection("users").findOne({ email: FOXO_ACCOUNTS.patient }, { ...options, projection: { _id: 1, email: 1, familyMembers: 1, careIdentityRevision: 1 } });
  const doctor = await db.collection("doctors").findOne({ email: FOXO_ACCOUNTS.doctor }, { ...options, projection: { _id: 1, email: 1 } });
  if (!patient || !doctor) throw new Error("The confirmed patient and doctor accounts must already exist");
  const staff = await db.collection("hospitalstaffs").find({ email: FOXO_ACCOUNTS.doctor, doctorId: doctor._id, role: "DOCTOR", isActive: true, inviteStatus: "accepted" },
    { ...options, projection: { _id: 1, hospitalId: 1, departmentIds: 1, doctorId: 1, role: 1, isActive: 1, inviteStatus: 1 } }).limit(2).toArray();
  if (staff.length !== 1) throw new Error("Exactly one active linked hospital doctor is required");
  const member = staff[0];
  const hospital = await db.collection("hospitals").findOne({ _id: member.hospitalId, status: "active" },
    { ...options, projection: { _id: 1, slug: 1, status: 1, "settings.timezone": 1, "settings.queueSessionIds": 1 } });
  const departments = await db.collection("departments").find({ _id: { $in: member.departmentIds || [] }, hospitalId: member.hospitalId, status: "active" },
    { ...options, projection: { _id: 1, hospitalId: 1, name: 1, status: 1 } }).limit(3).toArray();
  const department = departments.find(item => /pa?ediatr/i.test(item.name));
  if (!hospital?.slug || !department) throw new Error("An active published hospital route and assigned paediatric department are required");
  return { patient, doctor, staff: member, hospital, department };
}

function graph(source, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) throw new Error("Explicit valid rehearsal date required");
  const { patient, staff, hospital, department } = source;
  const tag = `foxo-v1:${patient._id}:${staff._id}:${date}`;
  const runId = oid(tag), familyId = oid(`foxo-family-v1:${patient._id}:${staff._id}`);
  const family = { _id: familyId, name: "Aarav — Synthetic Demo Child", relation: "child", dob: new Date("2018-06-15T00:00:00Z"), gender: "male" };
  const scenarios = [
    [21, "Routine child wellness discussion", "Fictional baseline visit for demonstrating a connected family timeline. No diagnosis, vaccination, medicine or investigation is asserted."],
    [10, "Mild cough and blocked nose reported for two days", "Fictional symptom-intake example. No measured vitals or clinical findings are supplied. All clinical decisions require an actual qualified clinician."],
    [3, "Follow-up discussion of the earlier fictional cough", "Fictional follow-up linked to the same child, hospital, department and doctor. This imported example is not proof of treatment or AI performance."],
  ];
  const rows = [];
  for (const [index, [days, complaint, notes]] of scenarios.entries()) {
    const start = new Date(Date.parse(date + "T04:30:00Z") - days * 86400000), end = new Date(+start + 15 * 60000);
    const context = queueContext({ hospital, doctorId: staff._id, now: start });
    const tokenId = oid(`${tag}:token:${index}`), appointmentId = oid(`${tag}:appointment:${index}`), encounterId = oid(`${tag}:encounter:${index}`);
    const common = { ...context, personKey: patientKey(patient._id, familyId), familyMemberId: familyId, createdAt: start, updatedAt: end, revision: 0 };
    const summary = `${FOXO_LABEL}\n${notes}`;
    const token = { _id: tokenId, ...common, hospitalId: hospital._id, departmentId: department._id, doctorId: staff._id, patientId: patient._id,
      appointmentId, tokenNumber: 900001 + index, displayToken: `DEMO-${index + 1}`, date: start,
      patientInfo: { name: family.name, age: 8, gender: "male", isWalkIn: false }, visitType: index === 2 ? "follow_up" : "new",
      chiefComplaint: `[Synthetic demo] ${complaint}`, status: "completed", arrivedAt: start,
      consultationStartedAt: start, consultationEndedAt: end, consultationNotes: summary,
      paymentStatus: "waived", paymentAmount: 0 };
    const appointment = { _id: appointmentId, ...common, hospitalId: hospital._id, doctor: staff._id, user: patient._id, opdTokenId: tokenId,
      appointmentType: "hospital_in_person", admissionState: "arrived", checkedInAt: start, roomId: `synthetic-foxo-${appointmentId}`,
      status: "completed", startedAt: start, endedAt: end, endedBy: "system", doctorNotes: summary,
      feeSnapshot: { amountMinor: 0, currency: "INR", demo: true } };
    const encounter = { _id: encounterId, hospitalId: hospital._id, departmentId: department._id, tokenId, appointmentId,
      patientId: patient._id, familyMemberId: familyId, isWalkIn: false, ticketNumber: `DEMO-${index + 1}`, currentStage: "completed",
      requiredSteps: ["consultation"], currentDestination: { name: "not recorded" }, physicalFile: { hasPhysicalFile: false, locationName: "not recorded" },
      stageHistory: [{ stage: "completed", actorRole: "SYSTEM", actorName: "Synthetic fixture importer", timestamp: end, notes: summary, reason: "Explicit synthetic recording fixture" }],
      createdAt: start, updatedAt: end, revision: 0 };
    for (const [Model, document] of [[OpdToken, token], [Appointment, appointment], [EncounterJourney, encounter]]) {
      if (new Model(document).validateSync()) throw new Error("Synthetic graph does not satisfy the current document schema");
      rows.push({ collection: Model.collection.name, document });
    }
  }
  return { runId, family, rows };
}

export async function inspectFoxoDemo(db, date, session) {
  const resolved = await source(db, session), data = graph(resolved, date);
  const prior = await db.collection("demofixtureruns").findOne({ _id: data.runId }, opts(session));
  if (prior) return { task: "FOXO_DEMO_V1", mode: "existing", runId: data.runId, date, database: db.databaseName };
  if (resolved.patient.familyMembers?.some(member => same(member._id, data.family._id) || member.name === data.family.name)) throw new Error("Existing synthetic family needs reviewed reuse; no duplicate profile will be added");
  for (const row of data.rows) {
    if (await db.collection(row.collection).findOne({ _id: row.document._id }, { ...opts(session), projection: { _id: 1 } })) throw new Error("A planned identity is already occupied");
    if (row.collection === "opdtokens" && await db.collection(row.collection).findOne({ queueKey: row.document.queueKey, tokenNumber: row.document.tokenNumber }, { ...opts(session), projection: { _id: 1 } })) throw new Error("A historical token number is occupied; nothing will be renumbered");
  }
  const plan = { task: "FOXO_DEMO_V1", mode: "additive", database: db.databaseName, date, source: resolved, ...data };
  return { ...plan, hash: foxoHash(plan) };
}

export async function applyFoxoDemo(db, client, plan, { approved = false, writersPaused = false, backupVerified = false, fault } = {}) {
  if (!approved || !writersPaused || !backupVerified || plan?.task !== "FOXO_DEMO_V1" || plan.mode !== "additive" || plan.database !== db.databaseName) throw new Error("An exact approved plan, private backup and paused writers are required");
  const { hash, ...contents } = plan;
  if (hash !== foxoHash(contents)) throw new Error("Plan integrity mismatch");
  if (fault && process.env.NODE_ENV !== "test") throw new Error("Fault injection is test-only");
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const previous = await db.collection("demofixtureruns").findOne({ _id: plan.runId }, { session });
      if (previous) {
        if (previous.planHash !== hash) throw new Error("Existing run belongs to another plan");
        for (const row of plan.rows) {
          const actual = await db.collection(row.collection).findOne({ _id: row.document._id }, { session });
          if (!actual || foxoHash(actual) !== foxoHash(row.document)) throw new Error("Seeded history changed; retain it for reviewed follow-up");
        }
        const patient = await db.collection("users").findOne({ _id: plan.source.patient._id }, { session });
        const family = patient?.familyMembers?.find(item => same(item._id, plan.family._id));
        if (!family || foxoHash(family) !== foxoHash(plan.family)) throw new Error("Seeded family changed; no recreation or overwrite is allowed");
        return { replay: true, addedVisits: 0 };
      }
      const fresh = await inspectFoxoDemo(db, plan.date, session);
      if (fresh.hash !== hash) throw new Error("Source data changed; prepare and review a fresh plan");
      await db.collection("users").updateOne({ _id: plan.source.patient._id }, { $push: { familyMembers: plan.family }, $inc: { careIdentityRevision: 1 } }, { session });
      for (const row of plan.rows) await db.collection(row.collection).insertOne(row.document, { session });
      if (fault) await fault();
      await db.collection("demofixtureruns").insertOne({ _id: plan.runId, task: plan.task, planHash: hash, createdAt: new Date(),
        synthetic: true, familyId: plan.family._id, patientId: plan.source.patient._id, references: plan.rows.map(row => ({ collection: row.collection, id: row.document._id })) }, { session });
      return { replay: false, addedVisits: 3, addedFamilyProfiles: 1, insertedDocuments: 9 };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
  } finally { await session.endSession(); }
}
