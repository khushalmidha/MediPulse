import { proofId } from "../services/bookingAuthorization.js";
import OutboxJob from "../model/outboxJob.js";
import QueueRevision from "../model/queueRevision.js";
import BookingChallenge from "../model/bookingChallenge.js";
import AuthSession from "../model/authSession.js";
import { sessionToken } from "./fixtures/sessionToken.js";
import BookingOperation from "../model/bookingOperation.js";
import { queueContext, patientKey } from "../services/queueContext.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { readFile, mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Hospital from "../model/hospital.js";
import Department from "../model/department.js";
import HospitalStaff from "../model/hospitalStaff.js";
import OpdToken from "../model/opdToken.js";
import OpdSequence from "../model/opdSequence.js";
import Appointment from "../model/appointment.js";
import User from "../model/user.js";
import Doctor from "../model/doctor.js";
import Review from "../model/review.js";
import PlatformFeedback from "../model/platformFeedback.js";
import StaffMessage from "../model/staffMessage.js";
import Community from "../model/community.js";
import { getRedis, bookingTokenKey } from "../services/redis.js";
import { invalidatePublicHospitalCache } from "../services/publicHospitalCache.js";
import { canAccessVisit, emitOpdEvent, staffRoom } from "../services/hospitalAccess.js";
import { canReadStaffMessage, prepareStaffMessage } from "../services/staffMessaging.js";
import { publicHospital, publicReview } from "../services/publicViews.js";
import { requireDatabaseUrl } from "../util/databaseConfig.js";

// Transitive dotenv imports run from an empty directory, never the project's .env.
// No index.js imports or database connections; all records and signing keys are synthetic.
process.env.NODE_ENV = "test";
process.env.USE_REAL_REDIS = "false";
process.env.TOKEN_KEY = "p01-test-only-signing-key";
process.env.REQUIRE_BOOKING_OTP = "false";
mongoose.set("bufferCommands", false);
const originalCwd = process.cwd();
const emptyEnvDirectory = await mkdtemp(join(tmpdir(), "medipulse-p01-env-"));
let socketModule, opdModule, hospitalModule, reviewModule, messageModule, aiModule, appointmentModule;
try {
  process.chdir(emptyEnvDirectory);
  [socketModule, opdModule, hospitalModule, reviewModule, messageModule, aiModule, appointmentModule] = await Promise.all([
    import("../socket.js"), import("../routes/opd.js"), import("../routes/hospital.js"), import("../routes/review.js"),
    import("../routes/staffMessage.js"), import("../routes/opdAi.js"), import("../routes/appointment.js"),
  ]);
} finally {
  process.chdir(originalCwd);
  await rmdir(emptyEnvDirectory);
}
const { initSocket } = socketModule;
const opdRouter = opdModule.default, hospitalRouter = hospitalModule.default, reviewRouter = reviewModule.default;
const staffMessageRouter = messageModule.default, opdAiRouter = aiModule.default, appointmentRouter = appointmentModule.default;

const id = (number) => number.toString(16).padStart(24, "0");
const H = id(1), H2 = id(2), D = id(3), D2 = id(4), D3 = id(5), U = id(6), U2 = id(7), F = id(8), F2 = id(9);
const DOC = id(10), OTHERDOC = id(11), NURSE = id(12), OTHERNURSE = id(13), ADMIN = id(14), RECEPTION = id(15), LAB = id(16), PHARMACY = id(17), FOREIGN = id(18), PLATFORMDOC = id(19), TOKEN = id(20), APPT = id(21);

const pathValues = (value, path) => {
  if (Array.isArray(value)) return value.flatMap((item) => pathValues(item, path));
  if (!path.length) return [value];
  return pathValues(value?.[path[0]], path.slice(1));
};
const equal = (a, b) => (a == null && b == null) || String(a?._id ?? a) === String(b?._id ?? b);
const matches = (row, filter) => Object.entries(filter).every(([key, expected]) => {
  if (key === "$and") return expected.every((item) => matches(row, item));
  if (key === "$or") return expected.some((item) => matches(row, item));
  const values = pathValues(row, key.split("."));
  if (expected && typeof expected === "object" && !(expected instanceof Date) && !expected._id) {
    return Object.entries(expected).every(([operator, target]) => {
      if (operator === "$in") return values.some((value) => target.some((item) => equal(value, item)));
      if (operator === "$nin") return values.every((value) => !target.some((item) => equal(value, item)));
      if (operator === "$ne") return values.every((value) => !equal(value, target));
      if (operator === "$gte") return values.some((value) => value >= target);
      if (operator === "$lte") return values.some((value) => value <= target);
      if (operator === "$lt") return values.some((value) => value < target);
      if (operator === "$exists") return values.some((value) => (value !== undefined) === target);
      throw new Error(`Unhandled synthetic filter operator ${operator}`);
    });
  }
  return values.some((value) => equal(value, expected));
});
const query = (value) => {
  const result = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  for (const method of ["select", "sort", "skip", "limit", "populate", "lean", "session"]) result[method] = () => result;
  return result;
};
const fixture = (t) => {
  const staff = (actor, role, hospitalId = H, departmentIds = [D]) => ({ _id: actor, name: `Fixture ${role}`, email: "fixture@example.invalid", role, hospitalId, departmentIds, isActive: true, inviteStatus: "accepted" });
  const records = new Map([
    [Hospital, [{ _id: H, slug: "fixture", name: "Fixture Hospital", status: "active", address: { city: "Fixture", state: "Fixture" },
      onboarding: { initialAdminPasswordEncrypted: "synthetic-private-ciphertext", initialAdminPasswordIv: "synthetic-private-iv", initialAdminPasswordTag: "synthetic-private-tag" },
      subscription: { plan: "enterprise", status: "active" }, websiteConfig: { customDomain: "fixture.invalid", customDomainVerified: true, customDomainVercelId: "private-provider-id" } },
      { _id: H2, name: "Other Fixture Hospital", status: "active" }]],
    [Department, [{ _id: D, hospitalId: H, name: "Department One", status: "active", opd: { consultationFee: 0 } },
      { _id: D2, hospitalId: H, name: "Department Two", status: "active" }, { _id: D3, hospitalId: H2, status: "active" }]],
    [HospitalStaff, [Object.assign(staff(DOC, "DOCTOR"), { doctorId: PLATFORMDOC }), staff(OTHERDOC, "DOCTOR", H, [D2]),
      staff(NURSE, "NURSE"), staff(OTHERNURSE, "NURSE", H, [D2]), staff(ADMIN, "HOSPITAL_ADMIN", H, []),
      staff(RECEPTION, "RECEPTIONIST", H, []), staff(LAB, "LAB_TECH"), staff(PHARMACY, "PHARMACIST"), staff(FOREIGN, "DOCTOR", H2, [D3])]],
    [User, [{ _id: U, firstName: "Synthetic Patient", familyMembers: [{ _id: F }] }, { _id: U2, firstName: "Other Synthetic Patient", familyMembers: [{ _id: F2 }] }]],
    [Doctor, [{ _id: PLATFORMDOC, firstName: "Fixture Doctor" }]],
    [OpdToken, [{ _id: TOKEN, hospitalId: H, departmentId: D, doctorId: DOC, patientId: U, displayToken: "T001", tokenNumber: 1,
      date: new Date(new Date().setHours(0, 0, 0, 0)), status: "waiting", vitals: { pulse: 77 }, chiefComplaint: "synthetic-clinical-complaint",
      diagnosis: "synthetic-clinical-diagnosis", consultationNotes: "synthetic-clinical-note", patientInfo: { name: "Synthetic Patient", internalNote: "private" }, aiTriage: { patientBrief: { agentSummary: "synthetic-clinical-brief" } } }]],
    [OutboxJob, []], [QueueRevision, []], [BookingChallenge, []], [BookingOperation, []], [AuthSession, []],
    [Appointment, [{ _id: APPT, doctor: PLATFORMDOC, user: U, status: "active" }]],
    [Review, [{ _id: id(30), hospitalId: { _id: H, name: "Fixture Hospital" }, doctorId: { _id: DOC, name: "Fixture Doctor" },
      patientId: { _id: U, firstName: "HiddenFirst", lastName: "HiddenLast" }, tokenId: TOKEN, metadata: { moderation: "private" },
      status: "published", isAnonymous: true, overallRating: 5, comment: "Fixture review", hospitalResponse: { text: "Thank you", respondedBy: ADMIN } }]],
    [PlatformFeedback, [{ _id: id(31), patientId: { _id: U, firstName: "HiddenFirst", lastName: "HiddenLast" }, isAnonymous: true, status: "published", rating: 5, comment: "Fixture feedback" }]],
    [StaffMessage, []], [Community, [{ _id: id(40), author: PLATFORMDOC, members: [U] }]], [OpdSequence, []],
  ]);
  const context = queueContext({ hospital: records.get(Hospital)[0], doctorId: DOC });
  Object.assign(records.get(OpdToken)[0], context, { personKey: patientKey(U), revision: 0, arrivedAt: new Date() });
  t.mock.method(mongoose, "startSession", async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} }));
  for (const [model, rows] of records) {
    t.mock.method(model, "find", (filter = {}) => query(rows.filter((row) => matches(row, filter))));
    t.mock.method(model, "findOne", (filter) => query(rows.find((row) => matches(row, filter)) || null));
    t.mock.method(model, "findById", (recordId) => query(rows.find((row) => equal(row._id, recordId)) || null));
    t.mock.method(model, "exists", (filter) => query(rows.some((row) => matches(row, filter)) ? { _id: id(100) } : null));
    t.mock.method(model, "countDocuments", (filter = {}) => query(rows.filter((row) => matches(row, filter)).length));
    t.mock.method(model, "create", async (payload) => {
      const create = (data) => { const doc = { _id: id(100 + rows.length), ...data, save: async () => doc }; rows.push(doc); return doc; };
      return Array.isArray(payload) ? payload.map(create) : create(payload);
    });
    const update = (filter, change, options = {}) => {
      let doc = rows.find((row) => matches(row, filter));
      if (!doc && options.upsert) { doc = { _id: id(120 + rows.length), ...filter, ...change.$setOnInsert }; rows.push(doc); }
      if (!doc) return query(null);
      if (change.$set) Object.assign(doc, change.$set);
      for (const [key, value] of Object.entries(change.$inc || {})) doc[key] = (doc[key] || 0) + value;
      return query(doc);
    };
    t.mock.method(model, "findOneAndUpdate", update);
    t.mock.method(model, "updateOne", (filter, change) => update(filter, change));
    t.mock.method(model, "aggregate", () => query(model === OpdToken ? [{ avgMinutes: 12 }] : rows));
    t.mock.method(model, "updateMany", () => query({ modifiedCount: 1 }));
    for (const row of rows) row.save = async () => row;
  }
  return records;
};

const httpApp = async (t) => {
  const app = express();
  app.use(cookieParser(), express.json());
  app.use("/opd", opdRouter); app.use("/hospitals", hospitalRouter); app.use("/reviews", reviewRouter);
  app.use("/messages", staffMessageRouter); app.use("/ai", opdAiRouter);
  app.use("/appointment", appointmentRouter);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: "Fixture request failed" }));
  const server = createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (path, actor, body, method) => {
    const token = actor ? await sessionToken(actor, ["user", "doctor"].includes(actor.role) ? actor.role : "staff") : null;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: method || (body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", "Idempotency-Key": `p01-${Math.random().toString(16).slice(2)}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
};
const actor = (records, who) => records.get(HospitalStaff).find((staff) => staff._id === who);

test("credential utilities require an explicit configured database and contain no credential literals", async () => {
  for (const env of [{}, { DATABASE_URL: "https://example.invalid/db" }, { DATABASE_URL: "mongodb://localhost:27017/" }]) assert.throws(() => requireDatabaseUrl(env));
  assert.equal(requireDatabaseUrl({ DATABASE_URL: "mongodb://127.0.0.1:27017/p01_fixture" }), "mongodb://127.0.0.1:27017/p01_fixture");
  for (const file of ["../sync_indexes.mjs", "../check_tokens.mjs"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /mongodb(?:\+srv)?:\/\//);
    assert.match(source, /requireDatabaseUrl/);
    assert.doesNotMatch(source, /chiefComplaint|patientBrief|useDb/);
  }
});

test("public hospital allowlist handles nested fields and contaminated legacy/current caches", async (t) => {
  const records = fixture(t), request = await httpApp(t), redis = getRedis();
  const hospital = records.get(Hospital)[0];
  assert.equal(publicHospital(hospital).onboarding, undefined);
  await redis.set("hospital:public:fixture", JSON.stringify({ hospital }));
  await redis.set("hospital:public:v2:fixture", JSON.stringify({ hospital, doctors: [{ _id: DOC, name: "Fixture", email: "private@example.invalid", password: "private-hash" }], departments: [] }));
  const response = await request("/hospitals/fixture");
  assert.equal(response.status, 200);
  assert.doesNotMatch(JSON.stringify(response.body), /synthetic-private|private-provider|subscription|private-hash|private@example/);
  assert.equal(response.body.hospital._id, H);
  assert.equal(await redis.get("hospital:public:fixture"), null);
  await redis.del("hospital:public:v2:fixture");
  const fresh = await request("/hospitals/fixture");
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.departments[0]._id, D);
  assert.equal(fresh.body.doctors[0]._id, DOC);
  assert.doesNotMatch(JSON.stringify(fresh.body), /onboarding|subscription|Fixture DOCTOR.*email/);
  const search = await request("/hospitals");
  assert.doesNotMatch(JSON.stringify(search.body), /onboarding|subscription/);
});

test("all public review feeds omit patient identifiers and anonymous names", async (t) => {
  fixture(t); const request = await httpApp(t);
  const review = { isAnonymous: false, patientId: { _id: U, firstName: "Public", lastName: "Display" }, tokenId: TOKEN };
  assert.equal(publicReview(review).reviewerName, "Public Display");
  assert.equal(publicReview(review).patientId, undefined);
  for (const path of [`/reviews/hospital/${H}`, "/reviews/global", "/reviews/platform/homepage"]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.doesNotMatch(JSON.stringify(response.body), /HiddenFirst|HiddenLast|patientId|tokenId|respondedBy|moderation/);
    assert.match(JSON.stringify(response.body), /Anonymous Patient/);
  }
});

test("patient route rejects doctor role, spoofed patient and foreign family before issuance", async (t) => {
  const records = fixture(t), request = await httpApp(t);
  const path = `/opd/${H}/${D}/book`, patient = { _id: U, role: "user" };
  assert.equal((await request(path, null, { doctorId: DOC })).status, 401);
  assert.equal((await request(path, { _id: PLATFORMDOC, role: "doctor" }, { doctorId: DOC })).status, 403);
  assert.equal((await request(path, patient, { doctorId: DOC, patientId: U2 })).status, 403);
  assert.equal((await request(path, patient, { doctorId: DOC, familyMemberId: F2 })).status, 403);
  assert.equal(OpdSequence.findOneAndUpdate.mock.callCount(), 0);
  assert.equal(OpdToken.create.mock.callCount(), 0);
  assert.equal(records.get(OpdToken).length, 1);
});

test("doctor must belong to selected hospital department; valid self/family and walk-in bookings work", async (t) => {
  const records = fixture(t), request = await httpApp(t), patient = { _id: U, role: "user" };
  records.get(OpdToken).length = 0;
  records.get(HospitalStaff)[0].doctorId = undefined; // zero-fee local OPD; no ledger or external service.
  assert.equal((await request(`/opd/${H}/${D2}/book`, patient, { doctorId: DOC })).status, 404);
  assert.equal((await request(`/opd/${H}/${D3}/book`, patient, { doctorId: DOC })).status, 404);
  const booked = await request(`/opd/${H}/${D}/book`, patient, { doctorId: DOC, familyMemberId: F });
  assert.equal(booked.status, 201);
  assert.equal(booked.body.token.patientId, U); assert.equal(booked.body.token.familyMemberId, F);
  const walkIn = await request(`/opd/${H}/${D}/token`, actor(records, RECEPTION), { doctorId: DOC, patientInfo: { name: "Fixture Walk-in" }, chiefComplaint: "private" });
  assert.equal(walkIn.status, 201);
  assert.equal(walkIn.body.token.patientInfo.isWalkIn, true);
  assert.equal(walkIn.body.token.chiefComplaint, undefined);
});

test("staff queue is tenant/doctor/department scoped and reception cannot retrieve clinical fields from cache", async (t) => {
  const records = fixture(t), request = await httpApp(t);
  assert.equal((await request(`/opd/${H}/${DOC}/queue`, actor(records, FOREIGN))).status, 403);
  assert.equal((await request(`/opd/${H}/${DOC}/queue`, actor(records, OTHERDOC))).status, 403);
  assert.equal((await request(`/opd/${H}/${DOC}/queue`, actor(records, OTHERNURSE))).status, 403);
  assert.equal((await request(`/opd/${H}/${DOC}/queue`, actor(records, PHARMACY))).status, 403);
  const clinician = await request(`/opd/${H}/${DOC}/queue`, actor(records, DOC));
  assert.equal(clinician.status, 200); assert.equal(clinician.body.waiting[0].vitals.pulse, 77);
  const reception = await request(`/opd/${H}/${DOC}/queue`, actor(records, RECEPTION));
  assert.equal(reception.status, 200); assert.equal(reception.body.waiting[0].displayToken, "T001");
  assert.doesNotMatch(JSON.stringify(reception.body), /synthetic-clinical|vitals"|aiTriage|internalNote/);
  const key = `opd:queue:${DOC}:${new Date().toISOString().slice(0, 10)}:p01`;
  await getRedis().del(key);
});

test("clinical context and mutations reject unrelated departments and administrative portal access", async (t) => {
  const records = fixture(t), request = await httpApp(t);
  actor(records, RECEPTION).adminAccess = true;
  for (const who of [ADMIN, RECEPTION, OTHERNURSE, OTHERDOC, LAB, PHARMACY]) {
    assert.equal((await request(`/ai/tokens/${TOKEN}/context`, actor(records, who))).status, 403);
  }
  assert.equal((await request(`/ai/tokens/${TOKEN}/context`, actor(records, NURSE))).status, 200);
  assert.equal((await request(`/ai/tokens/${TOKEN}/copilot`, actor(records, NURSE), {})).status, 403);
  assert.equal((await request(`/opd/tokens/${TOKEN}/vitals`, actor(records, OTHERNURSE), { pulse: 99 }, "PATCH")).status, 403);
  assert.equal((await request(`/opd/tokens/${TOKEN}/no-show`, actor(records, OTHERNURSE), {}, "PATCH")).status, 403);
  assert.equal(records.get(OpdToken)[0].status, "waiting");
});

test("hospital staff invites and department edits reject foreign references and tenant reassignment", async (t) => {
  const records = fixture(t), request = await httpApp(t), admin = actor(records, ADMIN);
  assert.equal((await request(`/hospitals/${H}/staff/invite`, admin, { email: "fixture@example.invalid", role: "DOCTOR", departmentIds: [D3] })).status, 403);
  assert.equal((await request(`/hospitals/${H}/departments/${D}`, admin, { hospitalId: H2 }, "PATCH")).status, 403);
  assert.equal((await request(`/hospitals/${H}/departments/${D}`, admin, { headDoctorId: FOREIGN }, "PATCH")).status, 403);
  assert.equal((await request(`/hospitals/${H}/departments/${D}`, admin, { opd: { timings: [{ doctorIds: [OTHERDOC] }] } }, "PATCH")).status, 403);
  assert.equal(Department.findOneAndUpdate.mock.callCount(), 0);
  assert.equal(HospitalStaff.create.mock.callCount(), 0);
  const updated = await request(`/hospitals/${H}/departments/${D}`, admin, { name: "Updated", headDoctorId: DOC }, "PATCH");
  assert.equal(updated.status, 200); assert.equal(updated.body.department.hospitalId, H);
});

test("direct and patient-context messages enforce recipient, visit and department authorization", async (t) => {
  const records = fixture(t), doctor = actor(records, DOC), nurse = actor(records, NURSE);
  await assert.rejects(prepareStaffMessage(doctor, { hospitalId: H, conversationType: "direct", recipientStaffId: FOREIGN, content: "Fixture" }), { status: 404 });
  await assert.rejects(prepareStaffMessage(doctor, { hospitalId: H, conversationType: "patient_context", tokenId: TOKEN, patientId: U2, content: "Fixture" }), { status: 403 });
  await assert.rejects(prepareStaffMessage(actor(records, OTHERNURSE), { hospitalId: H, conversationType: "patient_context", tokenId: TOKEN, content: "Fixture" }), { status: 403 });
  await assert.rejects(prepareStaffMessage(doctor, { hospitalId: H, conversationType: "direct", tokenId: TOKEN, recipientStaffId: RECEPTION, content: "Fixture" }), { status: 403 });
  const direct = await prepareStaffMessage(doctor, { hospitalId: H, conversationType: "direct", recipientStaffId: NURSE, content: "Fixture" });
  assert.equal(await canReadStaffMessage(nurse, direct), true);
  assert.equal(await canReadStaffMessage(actor(records, ADMIN), direct), false);
  const message = await prepareStaffMessage(doctor, { hospitalId: H, conversationType: "patient_context", tokenId: TOKEN, content: "Private fixture message" });
  assert.equal(await canReadStaffMessage(nurse, message), true);
  assert.equal(await canReadStaffMessage(actor(records, RECEPTION), message), false);
  assert.equal(await canReadStaffMessage(actor(records, OTHERNURSE), message), false);
});

test("REST message list and read acknowledgements do not expose unrelated private conversations", async (t) => {
  const records = fixture(t), request = await httpApp(t);
  records.get(StaffMessage).push({ _id: id(60), hospitalId: H, conversationType: "direct", sender: DOC, recipientStaffId: NURSE, content: "Private fixture" });
  const response = await request("/messages", actor(records, ADMIN));
  assert.equal(response.status, 200); assert.deepEqual(response.body.items, []);
  await request("/messages/read", actor(records, ADMIN), { messageIds: [id(60)] }, "PATCH");
  assert.deepEqual(StaffMessage.updateMany.mock.calls[0].arguments[0]._id.$in, []);
  const valid = await request("/messages", actor(records, NURSE));
  assert.equal(valid.body.items.length, 1);
});

test("OPD events target active authorized staff and never contain clinical or patient payloads", async (t) => {
  const records = fixture(t), deliveries = [];
  const io = { to: (room) => ({ emit: (event, payload) => deliveries.push({ room, event, payload }) }) };
  await emitOpdEvent(io, "opd:vitals-ready", records.get(OpdToken)[0]);
  assert.deepEqual(deliveries.map((d) => d.room).sort(), [staffRoom(H, DOC), staffRoom(H, NURSE)].sort());
  assert.doesNotMatch(JSON.stringify(deliveries), /synthetic-clinical|patientId|pulse|diagnosis|notes/);
  deliveries.length = 0; actor(records, NURSE).isActive = false;
  await emitOpdEvent(io, "opd:vitals-ready", records.get(OpdToken)[0]);
  assert.equal(deliveries.length, 1);
  assert.equal(canAccessVisit({ ...actor(records, RECEPTION), adminAccess: true }, records.get(OpdToken)[0], { clinical: true }), false);
});

const socketClient = async (t, port, identity) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
  const frames = [], waiters = [];
  ws.addEventListener("message", ({ data }) => {
    const text = String(data);
    if (text === "2") { ws.send("3"); return; }
    frames.push(text);
    for (const waiter of [...waiters]) if (waiter.predicate(text)) { waiter.resolve(text); waiters.splice(waiters.indexOf(waiter), 1); }
  });
  const wait = (predicate) => {
    const present = frames.find(predicate);
    if (present) return Promise.resolve(present);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { waiters.splice(waiters.indexOf(entry), 1); reject(new Error("Fixture socket timed out")); }, 2000);
      const entry = { predicate, resolve: (frame) => { clearTimeout(timeout); resolve(frame); } }; waiters.push(entry);
    });
  };
  t.after(() => ws.close());
  await wait((frame) => frame.startsWith("0"));
  const token = await sessionToken(identity, ["user", "doctor"].includes(identity.role) ? identity.role : "staff");
  ws.send(`40${JSON.stringify({ token })}`);
  await wait((frame) => frame.startsWith("40"));
  let nextAck = 0;
  return { frames, ws, wait, send: (event, payload) => ws.send(`42${JSON.stringify([event, payload])}`),
    call: async (event, payload) => { const ack = ++nextAck; ws.send(`42${ack}${JSON.stringify([event, payload])}`);
      const frame = await wait((value) => value.startsWith(`43${ack}[`)); return JSON.parse(frame.slice(`43${ack}`.length))[0]; } };
};

test("real Socket.IO transport denies private-room injection, foreign references and revoked staff", async (t) => {
  const records = fixture(t), server = createServer(), io = initSocket(server);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => io.close(resolve)));
  const port = server.address().port;
  const doctor = await socketClient(t, port, actor(records, DOC));
  const patient = await socketClient(t, port, { _id: U, role: "user" });
  assert.equal((await patient.call("joinCommunity", staffRoom(H, DOC))).ok, false);
  assert.equal((await patient.call("joinCommunity", `appointment:${APPT}`)).ok, false);
  assert.equal((await patient.call("joinAppointmentRoom", null)).ok, false);
  assert.equal((await doctor.call("staff:joinHospital", null)).ok, false);
  assert.equal((await patient.call("joinCommunity", id(40))).ok, true);
  assert.equal((await doctor.call("staff:sendMessage", { hospitalId: H, conversationType: "direct", recipientStaffId: FOREIGN, content: "Fixture" })).ok, false);
  assert.equal((await doctor.call("staff:sendMessage", { hospitalId: H, conversationType: "patient_context", tokenId: TOKEN, patientId: U2, content: "Fixture" })).ok, false);
  assert.equal(StaffMessage.create.mock.callCount(), 0);
  // A shared platform doctor identity cannot grant access to another practice's appointment.
  assert.equal((await doctor.call("joinAppointmentRoom", { appointmentId: APPT })).ok, false);
  actor(records, DOC).isActive = false;
  assert.equal((await doctor.call("staff:sendMessage", { hospitalId: H, conversationType: "direct", recipientStaffId: NURSE, content: "Fixture" })).ok, false);
});

test("private socket message delivery reaches the assigned care team and excludes other staff and patients", async (t) => {
  const records = fixture(t), server = createServer(), io = initSocket(server);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => io.close(resolve)));
  const port = server.address().port;
  const doctor = await socketClient(t, port, actor(records, DOC));
  const nurse = await socketClient(t, port, actor(records, NURSE));
  const outsider = await socketClient(t, port, actor(records, OTHERNURSE));
  const reception = await socketClient(t, port, actor(records, RECEPTION));
  const patient = await socketClient(t, port, { _id: U2, role: "user" });
  const result = await doctor.call("staff:sendMessage", { hospitalId: H, conversationType: "patient_context", tokenId: TOKEN, content: "Fixture private handoff" });
  assert.equal(result.ok, true);
  assert.match(await nurse.wait((frame) => frame.includes("staff:newMessage")), /Fixture private handoff/);
  await new Promise((resolve) => setTimeout(resolve, 80));
  for (const client of [outsider, reception, patient]) assert.equal(client.frames.some((frame) => frame.includes("Fixture private handoff")), false);
  const labAlert = await doctor.call("staff:sendMessage", { hospitalId: H, conversationType: "patient_context", tokenId: TOKEN, messageType: "lab_alert", content: "Fixture lab collection" });
  assert.equal(labAlert.ok, true);
});

test("a nonparticipant cannot inject signaling or end an unrelated call", async (t) => {
  fixture(t); const server = createServer(), io = initSocket(server);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => io.close(resolve)));
  const port = server.address().port;
  const owner = await socketClient(t, port, { _id: U, role: "user" });
  const stranger = await socketClient(t, port, { _id: U2, role: "user" });
  assert.equal((await owner.call("joinAppointmentRoom", { appointmentId: APPT })).ok, true);
  assert.equal((await stranger.call("joinAppointmentRoom", { appointmentId: APPT })).ok, false);
  stranger.send("appointment:offer", { appointmentId: APPT, sdp: "fixture-unauthorized-offer" });
  stranger.send("appointment:chat-message", { appointmentId: APPT, text: "fixture-unauthorized-chat" });
  stranger.send("appointment:end", { appointmentId: APPT });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(owner.frames.some((frame) => /fixture-unauthorized|appointment:ended/.test(frame)), false);
});

test("legacy and versioned public caches are invalidated for slug and custom domain", async () => {
  const redis = getRedis(), hosts = ["cache-fixture", "cache-fixture.invalid"];
  const keys = hosts.flatMap((host) => [`hospital:public:${host}`, `hospital:public:v2:${host}`]);
  for (const key of keys) await redis.set(key, "synthetic-old-private-response");
  await invalidatePublicHospitalCache({ slug: hosts[0], websiteConfig: { customDomain: hosts[1] } });
  for (const key of keys) assert.equal(await redis.get(key), null);
});

test("online appointment OTP and booking reject another account's family member before payment", async (t) => {
  fixture(t); const request = await httpApp(t), patient = { _id: U, role: "user" };
  const otp = await request(`/appointment/otp/verify/${PLATFORMDOC}`, patient, { otp: "123456", familyMemberId: F2 });
  assert.equal(otp.status, 403);
  const token = "a".repeat(64);
  await BookingChallenge.create({ _id: proofId(token), kind: "proof", userId: U, doctorId: PLATFORMDOC, familyMemberId: F2, expiresAt: new Date(Date.now() + 600000) });
  const booked = await request(`/appointment/book/${PLATFORMDOC}`, patient, { bookingToken: token });
  assert.equal(booked.status, 403);
  assert.equal(Appointment.create.mock.callCount(), 0);
  await getRedis().del(bookingTokenKey(token));
});

test("a corrupt appointment link is denied before token or other patient's appointment is modified", async (t) => {
  const records = fixture(t), request = await httpApp(t);
  records.get(OpdToken)[0].appointmentId = APPT;
  records.get(Appointment)[0].user = U2;
  t.mock.method(console, "error", () => {});
  const response = await request(`/opd/tokens/${TOKEN}/start-consultation`, actor(records, DOC), {}, "PATCH");
  assert.equal(response.status, 403);
  assert.equal(records.get(OpdToken)[0].status, "waiting");
  assert.equal(records.get(Appointment)[0].user, U2);
});

test("profile edits cannot self-verify a domain or replace the domain management configuration", async (t) => {
  const records = fixture(t), request = await httpApp(t);
  await request(`/hospitals/${H}/profile`, actor(records, ADMIN), { websiteConfig: { seoTitle: "Fixture Title", customDomainVerified: true, customDomain: "other.invalid", customDomainVercelId: "forged" } }, "PATCH");
  const change = Hospital.findOneAndUpdate.mock.calls[0].arguments[1].$set;
  assert.deepEqual(change, { "websiteConfig.seoTitle": "Fixture Title" });
});

test("message query references and legacy corrupt clinical pointers are rejected", async (t) => {
  const records = fixture(t), request = await httpApp(t);
  assert.equal((await request(`/messages?tokenId=${TOKEN}`, actor(records, OTHERNURSE))).status, 403);
  assert.equal((await request(`/messages?tokenId=${id(999)}`, actor(records, NURSE))).status, 404);
  records.get(OpdToken)[0].doctorId = FOREIGN;
  assert.equal((await request(`/ai/tokens/${TOKEN}/context`, actor(records, NURSE))).status, 403);
});
