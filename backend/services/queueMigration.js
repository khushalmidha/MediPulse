import crypto from "node:crypto";
import OpdToken from "../model/opdToken.js";
import Appointment from "../model/appointment.js";
import OpdSequence from "../model/opdSequence.js";
import BookingOperation from "../model/bookingOperation.js";
import Hospital from "../model/hospital.js";
import Doctor from "../model/doctor.js";
import HospitalStaff from "../model/hospitalStaff.js";
import Department from "../model/department.js";
import User from "../model/user.js";
import { queueContext, localServiceDate, patientKey, liveTokenStatuses, liveAppointmentStatuses } from "./queueContext.js";
import { idOf } from "./hospitalAccess.js";

export const queueModels = [OpdToken, Appointment, OpdSequence, BookingOperation];
const hashRows = (rows) => crypto.createHash("sha256").update(JSON.stringify(rows.map((row) => JSON.stringify(row)).sort())).digest("hex");
const legacyKeys = [
  [OpdToken, [{ hospitalId: 1, departmentId: 1, doctorId: 1, date: 1, tokenNumber: 1 }, { patientId: 1, doctorId: 1 }]],
  [Appointment, [{ user: 1, doctor: 1 }]], [OpdSequence, [{ hospitalId: 1, doctorId: 1, date: 1 }]],
];
// Once assigned, visit context survives later timezone/session configuration edits.
const migrationContext = (row, options) => {
  if (!row.queueKey) return queueContext(options);
  const { hospital, doctor } = options;
  const context = queueContext({ ...options, serviceDate: row.serviceDate, sessionId: row.sessionId,
    hospital: hospital && { ...hospital, settings: { ...hospital.settings, timezone: row.timezone, queueSessionIds: [row.sessionId] } },
    doctor: doctor && { ...doctor, queueTimezone: row.timezone, queueSessionIds: [row.sessionId] } });
  if (["queueKey", "practiceKey", "serviceDate", "sessionId", "timezone"].some((key) => row[key] !== context[key])
    || !Number.isInteger(row.revision) || row.revision < 0 || !row.personKey) throw new Error("Invalid existing queue metadata");
  return context;
};
export const inspectQueueMigration = async () => {
  const tokens = await OpdToken.collection.find({}).toArray(), appointments = await Appointment.collection.find({}).toArray();
  const hospitals = new Map((await Hospital.find({}).lean()).map((row) => [idOf(row), row]));
  const doctors = new Map((await Doctor.find({}).lean()).map((row) => [idOf(row), row]));
  const staff = new Map((await HospitalStaff.find({ role: "DOCTOR" }).lean()).map((row) => [idOf(row), row]));
  const departments = new Map((await Department.find({}).select("_id hospitalId").lean()).map((row) => [idOf(row), row]));
  const users = new Map((await User.find({}).select("_id familyMembers._id").lean()).map((row) => [idOf(row), row]));
  const validPatient = (owner, family) => {
    const user = users.get(idOf(owner));
    return Boolean(user && (!family || user.familyMembers?.some((member) => idOf(member) === idOf(family))));
  };
  const projectedTokens = [], projectedAppointments = [], issues = [];
  const tokenByAppointment = new Map();
  for (const row of tokens) {
    try {
      const hospital = hospitals.get(idOf(row.hospitalId)), actor = staff.get(idOf(row.doctorId));
      if (!hospital || !actor || idOf(actor.hospitalId) !== idOf(row.hospitalId) || !actor.departmentIds.some((id) => idOf(id) === idOf(row.departmentId))) throw new Error();
      if (idOf(departments.get(idOf(row.departmentId))?.hospitalId) !== idOf(row.hospitalId)
        || !Number.isInteger(row.tokenNumber) || row.tokenNumber < 1
        || (row.patientId && !validPatient(row.patientId, row.familyMemberId)) || (row.familyMemberId && !row.patientId)) throw new Error();
      const timezone = hospital.settings?.timezone || "Asia/Kolkata";
      const context = migrationContext(row, { hospital, doctorId: row.doctorId, serviceDate: row.serviceDate || localServiceDate(row.date, timezone),
        sessionId: row.sessionId, historical: true });
      const personKey = row.patientId ? patientKey(row.patientId, row.familyMemberId) : row.personKey || `walkin:${row._id}`;
      if (row.queueKey && row.personKey !== personKey) throw new Error("Invalid existing patient identity");
      const projected = { ...row, ...context, personKey,
        visitMode: "in_person", revision: row.revision || 0, date: new Date(`${context.serviceDate}T00:00:00Z`) };
      if (projected.status === "waiting" && !projected.arrivedAt) projected.status = "reserved";
      projectedTokens.push(projected);
      if (row.appointmentId) {
        if (tokenByAppointment.has(idOf(row.appointmentId))) issues.push("multiple_tokens_for_appointment");
        tokenByAppointment.set(idOf(row.appointmentId), projected);
      }
    } catch { issues.push("unresolvable_token_context"); }
  }
  for (const row of appointments) {
    try {
      const token = tokenByAppointment.get(idOf(row)), actor = staff.get(idOf(row.doctor));
      const hospital = token ? hospitals.get(idOf(token.hospitalId)) : actor ? hospitals.get(idOf(actor.hospitalId)) : null;
      const doctor = doctors.get(idOf(row.doctor));
      if (!token && !doctor && !actor) throw new Error();
      if (!validPatient(row.user, row.familyMemberId)) throw new Error();
      const context = token || migrationContext(row, { hospital, doctor, doctorId: actor?._id || row.doctor,
        serviceDate: row.serviceDate || localServiceDate(row.createdAt || new Date(), hospital?.settings?.timezone || doctor?.queueTimezone || "Asia/Kolkata"), sessionId: row.sessionId, historical: true });
      if (row.queueKey && (["queueKey", "practiceKey", "serviceDate", "sessionId", "timezone"].some((key) => row[key] !== context[key])
        || row.personKey !== patientKey(row.user, row.familyMemberId))) throw new Error("Invalid existing appointment identity");
      const projected = { ...row, ...Object.fromEntries(["queueKey", "practiceKey", "serviceDate", "sessionId", "timezone", "practiceType", "hospitalId"].filter(key => context[key] !== undefined).map((key) => [key, context[key]])),
        personKey: patientKey(row.user, row.familyMemberId), revision: row.revision || 0, visitMode: hospital ? "in_person" : "online", opdTokenId: token?._id };
      if (hospital && !token) issues.push("hospital_appointment_without_token");
      if (token) {
        if (row.opdTokenId && idOf(row.opdTokenId) !== idOf(token)) issues.push("linked_token_reference_mismatch");
        const tokenDoctor = staff.get(idOf(token.doctorId));
        if (idOf(row.doctor) !== idOf(tokenDoctor.doctorId || tokenDoctor._id) || idOf(row.user) !== idOf(token.patientId)
          || idOf(row.familyMemberId) !== idOf(token.familyMemberId)) issues.push("linked_patient_or_doctor_mismatch");
        const expected = { reserved: "queued", waiting: "queued", vitals_done: "queued", in_consultation: "active", completed: "completed", cancelled: "cancelled", no_show: "cancelled", booking: "booking", refund_pending: "refund_pending" }[token.status];
        if (row.status !== expected) issues.push("linked_state_mismatch");
      }
      projectedAppointments.push(projected);
    } catch { issues.push("unresolvable_appointment_context"); }
  }
  for (const token of projectedTokens) if (token.appointmentId && !appointments.some((row) => idOf(row) === idOf(token.appointmentId))) issues.push("missing_linked_appointment");
  const duplicates = (rows, predicate, identity, label) => {
    const seen = new Set();
    for (const row of rows.filter(predicate)) { const key = identity(row); if (seen.has(key)) issues.push(label); seen.add(key); }
  };
  duplicates(projectedTokens, () => true, (row) => `${row.queueKey}:${row.tokenNumber}`, "duplicate_token_number");
  duplicates(projectedTokens, (row) => liveTokenStatuses.includes(row.status), (row) => `${row.queueKey}:${row.personKey}`, "duplicate_live_patient");
  duplicates(projectedTokens, (row) => row.status === "in_consultation", (row) => row.queueKey, "multiple_active_tokens");
  duplicates(projectedAppointments, (row) => liveAppointmentStatuses.includes(row.status), (row) => `${row.queueKey}:${row.personKey}`, "duplicate_live_appointment");
  duplicates(projectedAppointments, (row) => row.status === "active", (row) => row.queueKey, "multiple_active_appointments");
  return { tokens: projectedTokens, appointments: projectedAppointments, issues,
    summary: { tokens: tokens.length, appointments: appointments.length, issues: Object.fromEntries([...new Set(issues)].map((name) => [name, issues.filter((issue) => issue === name).length])) } };
};

export const applyQueueMigration = async (connection, plan) => {
  if (plan.issues.length) throw new Error("Queue migration requires reviewed data correction; no writes performed");
  const runId = crypto.randomBytes(8).toString("hex"), db = connection.db;
  const backups = [];
  // Private in-database recovery snapshots. Never print row contents or identifiers.
  for (const model of queueModels) {
    const rows = await model.collection.find({}).toArray();
    const backup = `p03_backup_${runId}_${model.collection.collectionName}`;
    if (rows.length) await db.collection(backup).insertMany(rows);
    let indexes = [];
    try { indexes = await model.collection.listIndexes().toArray(); } catch (error) { if (error.code !== 26) throw error; }
    backups.push({ collection: model.collection.collectionName, backup, count: rows.length, indexes });
  }
  await db.collection("p03_migrations").insertOne({ _id: runId, state: "applying", createdAt: new Date(), backups });
  for (const [model, keys] of legacyKeys) {
    let indexes = [];
    try { indexes = await model.collection.listIndexes().toArray(); } catch (error) { if (error.code !== 26) throw error; }
    for (const index of indexes) if (index.unique && keys.some((key) => JSON.stringify(key) === JSON.stringify(index.key))) await model.collection.dropIndex(index.name);
  }
  for (const [model, rows] of [[OpdToken, plan.tokens], [Appointment, plan.appointments]]) {
    for (const row of rows) await model.collection.replaceOne({ _id: row._id }, row);
  }
  const counters = new Map();
  for (const token of plan.tokens) {
    const old = counters.get(token.queueKey);
    if (!old || old.seq < token.tokenNumber) counters.set(token.queueKey, { queueKey: token.queueKey, hospitalId: token.hospitalId, doctorId: token.doctorId,
      date: token.serviceDate, sessionId: token.sessionId, seq: token.tokenNumber });
  }
  for (const row of counters.values()) await OpdSequence.collection.updateOne({ queueKey: row.queueKey }, { $max: { seq: row.seq }, $set: {
    hospitalId: row.hospitalId, doctorId: row.doctorId, date: row.date, sessionId: row.sessionId,
  } }, { upsert: true });
  for (const model of queueModels) await model.createIndexes();
  const fingerprints = {};
  for (const model of queueModels) fingerprints[model.collection.collectionName] = hashRows(await model.collection.find({}).toArray());
  await db.collection("p03_migrations").updateOne({ _id: runId }, { $set: { state: "completed", fingerprints, completedAt: new Date() } });
  return runId;
};

export const rollbackQueueMigration = async (connection, runId) => {
  if (!/^[a-f\d]{16}$/.test(runId)) throw new Error("Invalid recovery run ID");
  const db = connection.db, run = await db.collection("p03_migrations").findOne({ _id: runId, state: "completed" });
  if (!run) throw new Error("Recovery snapshot unavailable; inspect migration state privately");
  for (const backup of run.backups) {
    if (hashRows(await db.collection(backup.collection).find({}).toArray()) !== run.fingerprints[backup.collection]) throw new Error("Data changed after migration; automatic rollback is refused");
  }
  for (const backup of run.backups) {
    const collection = db.collection(backup.collection);
    const current = await collection.listIndexes().toArray();
    for (const index of current) if (index.name !== "_id_") await collection.dropIndex(index.name);
    await collection.deleteMany({});
    const rows = await db.collection(backup.backup).find({}).toArray();
    if (rows.length) await collection.insertMany(rows);
    for (const index of backup.indexes) if (index.name !== "_id_") {
      const { key, v, ns, ...options } = index;
      await collection.createIndex(key, options);
    }
  }
  await db.collection("p03_migrations").updateOne({ _id: runId }, { $set: { state: "rolled_back" } });
};

export const assertQueueIndexes = async () => {
  for (const model of queueModels) {
    let indexes = [];
    try { indexes = await model.collection.listIndexes().toArray(); } catch (error) { if (error.code !== 26) throw error; }
    const required = model.schema.indexes().filter(([, options]) => options.name?.endsWith("_p03")).map(([, options]) => options.name);
    if (required.some((name) => !indexes.some((index) => index.name === name && index.unique))) throw new Error("P03 queue indexes require migration before startup");
    if (model !== BookingOperation && await model.countDocuments(model === OpdSequence ? { queueKey: { $exists: false }, seq: { $gt: 0 } }
      : { queueKey: { $exists: false } })) {
      // Old counters are archived by migration and deliberately retained; only visits gate startup.
      if (model !== OpdSequence) throw new Error("P03 legacy visits require migration before startup");
    }
  }
};
