import OutboxJob from "../../model/outboxJob.js";
import QueueRevision from "../../model/queueRevision.js";
import BookingChallenge from "../../model/bookingChallenge.js";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer, request as upstreamRequest } from "node:http";
import { once } from "node:events";
import { localTestTargets } from "../../util/testTargets.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import Hospital from "../../model/hospital.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import Department from "../../model/department.js";
import AuthSession from "../../model/authSession.js";
import AuthChallenge from "../../model/authChallenge.js";
import Community from "../../model/community.js";
import Message from "../../model/message.js";
import Event from "../../model/event.js";
import Forecast from "../../model/forecast.js";
import Wallet from "../../model/wallet.js";
import VirtualTransaction from "../../model/virtualTransaction.js";
import PaymentNotification from "../../model/paymentNotification.js";
import OpdToken from "../../model/opdToken.js";
import userRoutes from "../../routes/user.js";
import doctorRoutes from "../../routes/doctor.js";
import communityRoutes from "../../routes/community.js";
import messageRoutes from "../../routes/message.js";
import eventRoutes from "../../routes/event.js";
import forecastRoutes from "../../routes/forecast.js";
import validateStaff from "../../middleware/validateStaff.js";
import asyncHandler from "../../middleware/asyncHandler.js";
import { Verifier, StaffVerifier, resetChallengeId, resetOtpHash } from "../../controller/auth.js";
import { originGuard, resolveSession } from "../../services/authSessions.js";
import { makeBedForecast, makeBloodForecast } from "../../controller/forecast.js";
import { initSocket } from "../../socket.js";
import { sessionToken } from "../fixtures/sessionToken.js";
import { closeRedis } from "../../services/redis.js";
import { inspectAuthSchema, assertAuthSchema, applyAuthSchema, authModels } from "../../services/authSchema.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const targets = localTestTargets(), suffix = crypto.randomBytes(6).toString("hex");
const uri = new URL(targets.mongo); uri.pathname = `/medipulse_test_p05_${suffix}`;
const servers = [], ios = [];
let origin, patient, outsider, doctor, hospital, foreignHospital, department, admin, nurse, community;
let providerOutput, capturedPrompt;
const browserOrigin = "https://medipulse.live";
const password = "synthetic-password-123";
const account = async (name = "Patient", Model = User) => Model.create({ firstName: `Synthetic ${name}`, email: `${crypto.randomUUID()}@example.invalid`, password, gender: "other",
  ...(Model === Doctor ? { experience: { years: 1, expertise: "General Medicine" } } : {}) });
const http = async (path, { body, method = body ? "POST" : "GET", token, cookie, csrf, originHeader = browserOrigin, serverOrigin = origin } = {}) => {
  const response = await fetch(serverOrigin + path, { method, signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/json", ...(originHeader ? { Origin: originHeader } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json(), cookies: response.headers.getSetCookie() };
};
const sessionCookie = (result, scope = "account") => result.cookies.find(value => value.startsWith(`${scope === "staff" ? "staffToken" : "token"}=`) && !value.startsWith(`${scope === "staff" ? "staffToken" : "token"}=;`))?.split(";")[0];
const login = (record, kind = "user", cookie) => http(kind === "staff" ? "/user/staff/login" : `/${kind}/login`, { cookie, body: { email: record.email, password, ...(kind === "staff" ? { hospitalId: String(record.hospitalId) } : {}) } });
async function startServer() {
  const app = express(); app.use(express.json(), cookieParser(), originGuard);
  // Isolated requests have independent synthetic rate-limit identities. No production proxy settings are changed.
  app.use((req, res, next) => { Object.defineProperty(req, "ip", { value: crypto.randomUUID() }); next(); });
  app.use("/user", userRoutes); app.use("/doctor", doctorRoutes); app.use("/community", communityRoutes);
  app.use("/message", messageRoutes); app.use("/event", eventRoutes);
  app.post("/api/forecast/beds/:hospitalId/generate", validateStaff, makeBedForecast(async prompt => { capturedPrompt = prompt; return JSON.stringify(providerOutput); }));
  app.post("/api/forecast/blood/:hospitalId/generate", validateStaff, makeBloodForecast(async prompt => { capturedPrompt = prompt; return JSON.stringify(providerOutput); }));
  app.use("/api/forecast", forecastRoutes);
  app.get("/verify", asyncHandler(Verifier)); app.get("/verify/staff", asyncHandler(StaffVerifier));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.status ? error.message : "Fixture request failed" }));
  const server = createServer(app), io = initSocket(server); servers.push(server); ios.push(io);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}
before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  await Promise.all([OutboxJob, QueueRevision, BookingChallenge,User, Doctor, HospitalStaff, AuthSession, AuthChallenge, Community, Message, Event, Forecast, Wallet, VirtualTransaction, PaymentNotification, Department, Hospital, OpdToken].map(Model => Model.createIndexes()));
  patient = await account(); outsider = await account("Outsider"); doctor = await account("Doctor", Doctor);
  hospital = await Hospital.create({ name: "Synthetic Hospital", slug: `p05-${suffix}`, registrationNumber: `p05-${suffix}`, type: "clinic", email: `${suffix}@example.invalid`, address: { city: "Fixture", state: "Fixture" }, status: "active" });
  foreignHospital = new mongoose.Types.ObjectId();
  department = await Department.create({ hospitalId: hospital._id, name: "Synthetic OPD", opd: { consultationFee: 0 } });
  admin = await HospitalStaff.create({ hospitalId: hospital._id, name: "Synthetic Admin", email: "admin@example.invalid", role: "HOSPITAL_ADMIN", inviteStatus: "accepted", password });
  nurse = await HospitalStaff.create({ hospitalId: hospital._id, departmentIds: [department._id], name: "Synthetic Nurse", email: "nurse@example.invalid", role: "NURSE", inviteStatus: "accepted", password });
  community = await Community.create({ title: "Synthetic Community", bio: "Fixture", category: "Health", author: doctor._id, members: [patient._id] });
  origin = await startServer();
});
after(async () => {
  for (const io of ios) await new Promise(resolve => io.close(resolve));
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === uri.pathname.slice(1)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect(); await closeRedis();
});

test("profile saves preserve patient/doctor password hashes and login responses omit secrets", async () => {
  for (const [record, Model, kind] of [[patient, User, "user"], [doctor, Doctor, "doctor"]]) {
    const loaded = await Model.findById(record._id).select("+password");
    const original = loaded.password; loaded.bio = "Synthetic profile save"; await loaded.save();
    assert.equal((await Model.findById(record._id).select("+password")).password, original);
    const projected = await Model.findById(record._id); projected.bio = "Synthetic projected save"; await projected.save();
    assert.equal((await Model.findById(record._id).select("+password")).password, original);
    const auth = await sessionToken(record, kind);
    const updated = await http(kind === "user" ? "/user" : "/doctor", { token: auth, method: "PUT", body: { firstName: "Synthetic Edited" } });
    assert.equal(updated.status, 200);
    assert.equal((await Model.findById(record._id).select("+password")).password, original);
    const result = await login(record, kind); assert.equal(result.status, 201); assert.equal(result.body.result.password, undefined);
    assert.equal(result.body.result.authVersion, undefined); assert.ok(result.body.csrfToken);
    assert.match(sessionCookie(result), /^token=/);
    const cookie = result.cookies.find(value => value.startsWith("token=") && value.includes("HttpOnly"));
    assert.ok(cookie); assert.equal(cookie.includes("Domain="), false);
    const verified = await http("/verify", { cookie: sessionCookie(result) });
    assert.equal(verified.body.data.password, undefined);
  }
});
test("cookie writes require the current CSRF token and an allowed origin", async () => {
  const result = await login(patient), cookie = sessionCookie(result);
  assert.equal((await http("/user", { cookie, method: "PUT", body: { firstName: "Rejected" } })).status, 403);
  assert.equal((await http("/user", { cookie, csrf: result.body.csrfToken, originHeader: "https://evil.vercel.app", method: "PUT", body: { firstName: "Rejected" } })).status, 403);
  assert.equal((await http("/user", { cookie, csrf: result.body.csrfToken, originHeader: null, method: "PUT", body: { firstName: "Rejected" } })).status, 403);
  assert.equal((await http("/user", { cookie, csrf: result.body.csrfToken, method: "PUT", body: { firstName: "Synthetic Accepted" } })).status, 200);
});
test("patient/staff switching revokes the previous workspace and cookie socket scopes stay distinct", async () => {
  const staff = await login(admin, "staff"), staffCookie = sessionCookie(staff, "staff"); assert.equal(staff.status, 200);
  const user = await login(patient, "user", staffCookie), userCookie = sessionCookie(user);
  assert.equal((await http("/verify/staff", { cookie: staffCookie })).status, 401);
  const switchBack = await login(admin, "staff", userCookie);
  assert.equal((await http("/verify", { cookie: userCookie })).status, 401);
  assert.equal((await http("/verify/staff", { cookie: sessionCookie(switchBack, "staff") })).status, 200);
  // Exercise actual Socket.IO cookie handshake via polling with both cookies present.
  const freshUser = await login(patient), both = `${sessionCookie(freshUser)}; ${sessionCookie(switchBack, "staff")}`;
  const socketId = async scope => {
    const first = await fetch(`${origin}/socket.io/?EIO=4&transport=polling`, { headers: { Cookie: both, Origin: browserOrigin } });
    const opened = JSON.parse((await first.text()).slice(1));
    await fetch(`${origin}/socket.io/?EIO=4&transport=polling&sid=${opened.sid}`, { method: "POST", headers: { Cookie: both, Origin: browserOrigin, "Content-Type": "text/plain" }, body: `40${JSON.stringify({ scope })}` });
    const frame = await (await fetch(`${origin}/socket.io/?EIO=4&transport=polling&sid=${opened.sid}`, { headers: { Cookie: both, Origin: browserOrigin }, signal: AbortSignal.timeout(5000) })).text();
    assert.match(frame, /^40/); const sid = JSON.parse(frame.slice(2)).sid;
    const socket = ios[0].sockets.sockets.get(sid); const identity = socket.user._id; socket.disconnect(true); return identity;
  };
  assert.equal(await socketId("account"), String(patient._id)); assert.equal(await socketId("staff"), String(admin._id));
});
test("logout revocation persists across another API instance and legacy tokens are rejected", async () => {
  const result = await login(patient), cookie = sessionCookie(result), secondOrigin = await startServer();
  assert.equal((await http("/verify", { cookie, serverOrigin: secondOrigin })).status, 200);
  assert.equal((await http("/user/logout", { cookie, csrf: result.body.csrfToken, body: {} })).status, 200);
  assert.equal((await http("/verify", { cookie, serverOrigin: secondOrigin })).status, 401);
  assert.equal((await http("/verify", { token: jwt.sign({ id: String(patient._id), role: "user" }, process.env.TOKEN_KEY) })).status, 401);
});
test("OTP attempts are atomic, bounded and do not extend expiry; mail-disabled send fails honestly", async () => {
  const expiresAt = new Date(Date.now() + 600000), id = resetChallengeId("user", patient.email);
  await AuthChallenge.create({ _id: id, principalId: patient._id, kind: "user", otpHash: resetOtpHash("123456"), expiresAt });
  await Promise.all(Array.from({ length: 12 }, () => http("/user/forgot-password/reset", { body: { email: patient.email, otp: "999999", newPassword: password } })));
  const state = await AuthChallenge.findById(id); assert.equal(state.attempts, 5); assert.equal(+state.expiresAt, +expiresAt);
  assert.equal((await http("/user/forgot-password/reset", { body: { email: patient.email, otp: "123456", newPassword: password } })).status, 429);
  assert.equal((await http("/user/forgot-password/send-otp", { body: { email: patient.email } })).status, 503);
});
test("valid OTP has one winner, revokes old sessions and rejects replay and expiry", async () => {
  const record = await account("Reset"), auth = await sessionToken(record, "user"), id = resetChallengeId("user", record.email);
  await AuthChallenge.create({ _id: id, principalId: record._id, kind: "user", otpHash: resetOtpHash("123456"), expiresAt: new Date(Date.now() + 600000) });
  const results = await Promise.all(Array.from({ length: 3 }, () => http("/user/forgot-password/reset", { body: { email: record.email, otp: "123456", newPassword: "synthetic-new-password" } })));
  assert.deepEqual(results.map(row => row.status).sort(), [200, 410, 410]);
  await assert.rejects(resolveSession(auth, "account"), { status: 401 });
  assert.ok(await bcrypt.compare("synthetic-new-password", (await User.findById(record._id).select("+password")).password));
  await AuthChallenge.updateOne({ _id: id }, { $set: { consumedAt: null, expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await http("/user/forgot-password/reset", { body: { email: record.email, otp: "123456", newPassword: password } })).status, 410);
});
test("staff invites require a future expiry and acceptance has one concurrent winner", async () => {
  const make = expiresAt => HospitalStaff.create({ hospitalId: hospital._id, name: "Synthetic Invited", email: `${crypto.randomUUID()}@example.invalid`, role: "NURSE", inviteToken: crypto.createHash("sha256").update("fixture-invite").digest("hex"), ...(expiresAt ? { inviteExpiresAt: expiresAt } : {}) });
  for (const expiry of [undefined, new Date(Date.now() - 1000)]) {
    const staff = await make(expiry);
    const invite = crypto.randomUUID(); await HospitalStaff.updateOne({ _id: staff._id }, { $set: { inviteToken: crypto.createHash("sha256").update(invite).digest("hex") } });
    assert.equal((await http("/user/staff/set-password", { body: { hospitalId: String(hospital._id), token: invite, password } })).status, 410);
  }
  const staff = await make(new Date(Date.now() + 600000));
  const results = await Promise.all(Array.from({ length: 3 }, () => http("/user/staff/set-password", { body: { hospitalId: String(hospital._id), token: "fixture-invite", password, name: "Synthetic Accepted" } })));
  assert.deepEqual(results.map(row => row.status).sort(), [200, 410, 410]);
  const stored = await HospitalStaff.findById(staff._id).select("+password"); assert.equal(stored.inviteToken, undefined); assert.equal(stored.inviteStatus, "accepted"); assert.ok(await bcrypt.compare(password, stored.password));
});
test("staff password changes revoke prior sessions without double hashing profile saves", async () => {
  const record = await HospitalStaff.create({ hospitalId: hospital._id, name: "Synthetic Change", email: `${crypto.randomUUID()}@example.invalid`, role: "NURSE", inviteStatus: "accepted", password });
  const hash = (await HospitalStaff.findById(record._id).select("+password")).password; record.name = "Synthetic Edited"; await record.save();
  assert.equal((await HospitalStaff.findById(record._id).select("+password")).password, hash);
  const auth = await sessionToken(record, "staff");
  const changes = await Promise.all(Array.from({ length: 2 }, () => http("/user/staff/password", { token: auth, method: "PATCH", body: { currentPassword: password, newPassword: "synthetic-new-password" } })));
  assert.deepEqual(changes.map(result => result.status).sort(), [200, 401]);
  assert.equal((await http("/verify/staff", { token: auth })).status, 401);
});
test("community REST denies nonmembers and supports doctor authors; membership changes are idempotent", async () => {
  const stranger = await sessionToken(outsider, "user"), author = await sessionToken(doctor, "doctor");
  const discovery = await http("/community", { token: stranger });
  assert.equal(discovery.body[0].memberCount, 1); assert.equal(discovery.body[0].members, undefined); assert.equal(discovery.body[0].messages, undefined);
  const owned = await http("/community/user", { token: author }); assert.equal(String(owned.body[0]._id), String(community._id));
  const created = await http("/community/create", { token: author, body: { title: "Synthetic Additional Community", bio: "Fixture", category: "Health" } });
  assert.equal(created.status, 201); assert.equal(created.body.community.memberCount, 1);
  assert.ok((await Doctor.findById(doctor._id)).communities.some(id => String(id) === created.body.community._id));
  assert.equal((await http(`/community/${community._id}`, { token: stranger })).status, 403);
  assert.equal((await http("/message", { token: stranger, body: { id: String(community._id), content: "Rejected" } })).status, 403);
  assert.equal((await http("/message", { token: author, body: { id: String(community._id), content: "Synthetic doctor message" } })).status, 201);
  await Promise.all(Array.from({ length: 3 }, () => http("/community/join", { token: stranger, body: { id: String(community._id) } })));
  assert.equal((await Community.findById(community._id)).members.filter(value => String(value) === String(outsider._id)).length, 1);
  assert.equal((await User.findById(outsider._id)).communities.length, 1);
  assert.equal((await http("/community/leave", { token: author, body: { id: String(community._id) } })).status, 409);
  await http("/community/leave", { token: stranger, body: { id: String(community._id) } });
  assert.equal((await http(`/community/${community._id}`, { token: stranger })).status, 403);
});
test("events enforce organizer permissions and membership-scoped reads", async () => {
  const member = await sessionToken(patient, "user"), author = await sessionToken(doctor, "doctor"), stranger = await sessionToken(outsider, "user");
  const body = { communityId: String(community._id), title: "Synthetic Event", bio: "Fixture", kind: "online", time: new Date(Date.now() + 3600000).toISOString(), reminders: [] };
  assert.equal((await http("/event", { token: member, body })).status, 403);
  assert.equal((await http("/event", { token: author, body })).status, 201);
  assert.equal((await http("/event", { token: stranger })).body.events.length, 0);
  assert.equal((await http("/event", { token: member })).body.events.length, 1);
  assert.equal((await http("/event", { token: author, body: { ...body, time: "invalid" } })).status, 400);
});
test("tenant forecast routes execute controllers and validate provider data before persistence", async () => {
  const auth = await sessionToken(admin, "staff"), nurseAuth = await sessionToken(nurse, "staff");
  assert.equal((await http(`/api/forecast/beds/${hospital._id}`, { token: auth })).body.forecasts.length, 0);
  assert.equal((await http(`/api/forecast/beds/${foreignHospital}`, { token: auth })).status, 403);
  assert.equal((await http(`/api/forecast/beds/${hospital._id}`, { token: nurseAuth })).status, 403);
  await OpdToken.collection.insertMany([{ hospitalId: hospital._id, departmentId: department._id, date: new Date() },
    { hospitalId: hospital._id, departmentId: department._id, date: new Date() }, { hospitalId: foreignHospital, departmentId: department._id, date: new Date() }]);
  providerOutput = [{ departmentId: { name: department.name }, bedType: "ICU", confidence: "Low", predictedDemand: 2, recommendedReserve: 1, explanation: "Synthetic draft" }];
  const generated = await http(`/api/forecast/beds/${hospital._id}/generate`, { token: auth, body: {} });
  assert.equal(generated.status, 200); assert.equal(generated.body.source, "ai_draft"); assert.equal(generated.body.reviewStatus, "unreviewed");
  assert.match(capturedPrompt, /Recent 30-Day Total OPD Volume: 2 visits/);
  providerOutput = [{ ...providerOutput[0], predictedDemand: -1 }];
  assert.equal((await http(`/api/forecast/beds/${hospital._id}/generate`, { token: auth, body: {} })).status, 502);
  assert.equal((await Forecast.findOne({ hospitalId: hospital._id, type: "beds" })).forecasts[0].predictedDemand, 2);
  providerOutput = [{ bloodGroup: "O+", shortageRisk: "low", predictedUnits: 2, recommendedReserve: 1, explanation: "Synthetic draft" }];
  assert.equal((await http(`/api/forecast/blood/${hospital._id}/generate`, { token: auth, body: {} })).status, 200);
  assert.match(capturedPrompt, /Recent 30-Day Total OPD Volume: 2 visits/);
  await Forecast.updateOne({ hospitalId: hospital._id, type: "blood" }, { $set: { forecasts: { bad: "legacy" } } });
  const legacy = await http(`/api/forecast/blood/${hospital._id}`, { token: auth });
  assert.deepEqual(legacy.body.forecasts, []); assert.equal(legacy.body.needsRegeneration, true);
});

async function connectSocket(token) {
  const ws = new WebSocket(origin.replace("http", "ws") + "/socket.io/?EIO=4&transport=websocket");
  const frames = [], waiters = [];
  ws.addEventListener("message", ({ data }) => {
    const frame = String(data); frames.push(frame); if (frame === "2") ws.send("3");
    for (const entry of [...waiters]) if (entry.predicate(frame)) { waiters.splice(waiters.indexOf(entry), 1); entry.resolve(frame); }
  });
  const wait = predicate => frames.some(predicate) ? Promise.resolve(frames.find(predicate)) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Synthetic socket timed out")), 5000);
    waiters.push({ predicate, resolve: value => { clearTimeout(timer); resolve(value); } });
  });
  await wait(frame => frame.startsWith("0")); ws.send(`40${JSON.stringify({ token })}`); await wait(frame => frame.startsWith("40"));
  let ack = 0;
  return { ws, frames, wait, call: async (event, payload) => { const number = ++ack; ws.send(`42${number}${JSON.stringify([event, payload])}`);
    return JSON.parse((await wait(frame => frame.startsWith(`43${number}[`))).slice(`43${number}`.length))[0]; } };
}
test("actual sockets reject nonmembers, let doctor authors communicate and filter departed members", async () => {
  const memberAuth = await sessionToken(patient, "user"), authorAuth = await sessionToken(doctor, "doctor"), strangerAuth = await sessionToken(outsider, "user");
  const member = await connectSocket(memberAuth), author = await connectSocket(authorAuth), stranger = await connectSocket(strangerAuth);
  try {
    assert.equal((await member.call("joinCommunity", String(community._id))).ok, true);
    assert.equal((await author.call("joinCommunity", String(community._id))).ok, true);
    assert.equal((await stranger.call("joinCommunity", String(community._id))).ok, false);
    stranger.ws.send(`42${JSON.stringify(["sendMessage", { communityId: String(community._id), content: null }, {}])}`);
    assert.equal((await stranger.call("sendMessage", { communityId: String(community._id), content: "Rejected" })).ok, false);
    assert.equal((await author.call("sendMessage", { communityId: String(community._id), content: "Synthetic socket doctor message" })).ok, true);
    await member.wait(frame => frame.includes("Synthetic socket doctor message"));
    await http("/community/leave", { token: memberAuth, body: { id: String(community._id) } });
    assert.equal((await author.call("sendMessage", { communityId: String(community._id), content: "Synthetic after leave" })).ok, true);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(member.frames.some(frame => frame.includes("Synthetic after leave")), false);
    assert.equal((await member.call("sendMessage", { communityId: String(community._id), content: "Rejected after leave" })).ok, false);
    await http("/user/logout", { token: authorAuth, body: {} });
    await author.wait(frame => frame === "41");
  } finally { member.ws.close(); author.ws.close(); stranger.ws.close(); }
});

test("same-origin HTTP relay carries scoped HttpOnly session cookies to real Socket.IO polling", async () => {
  const token = await sessionToken(doctor, "doctor"), cookie = `token=${token}`;
  const proxy = createServer((req, res) => {
    const target = new URL(req.url.replace(/^\/backend/, ""), origin);
    const upstream = upstreamRequest(target, { method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  const base = `http://127.0.0.1:${proxy.address().port}/backend/socket.io/?EIO=4&transport=polling`;
  const headers = { Cookie: cookie, "Sec-Fetch-Site": "same-origin", Referer: `${browserOrigin}/chat` };
  try {
    const rejected = await fetch(base, { headers: { ...headers, Referer: "https://evil.invalid/chat" } }); assert.equal(rejected.status, 403);
    const opened = await fetch(base, { headers }); assert.equal(opened.status, 200);
    const { sid } = JSON.parse((await opened.text()).slice(1)), url = `${base}&sid=${sid}`;
    await fetch(url, { method: "POST", headers: { ...headers, Origin: browserOrigin, "Content-Type": "text/plain" }, body: '40{"scope":"account"}' });
    const frame = await (await fetch(url, { headers, signal: AbortSignal.timeout(5000) })).text(); assert.match(frame, /^40/);
    const socket = ios[0].sockets.sockets.get(JSON.parse(frame.slice(2)).sid);
    assert.equal(socket.user._id, String(doctor._id)); assert.equal(socket.conn.transport.name, "polling");
    socket.disconnect(true);
  } finally { await new Promise(resolve => proxy.close(resolve)); }
});

test("auth schema dry-run/apply/conflict detection and index rollback preserve synthetic accounts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "medipulse-p05-schema-"));
  const backup = join(directory, "indexes.json"), script = fileURLToPath(new URL("../../scripts/initAuthSchema.js", import.meta.url));
  const run = args => execFileSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 60000,
    env: { ...process.env, DATABASE_URL: uri.href }, stdio: ["ignore", "pipe", "pipe"] });
  const count = await User.countDocuments({});
  try {
    for (const Model of authModels) for (const index of await Model.collection.listIndexes().toArray()) if (index.name !== "_id_") await Model.collection.dropIndex(index.name);
    assert.equal((await inspectAuthSchema()).ready, false); await assert.rejects(assertAuthSchema());
    assert.match(run([]), /"ready":false/);
    assert.throws(() => run(["--apply", "--backup", backup]));
    assert.match(run(["--apply", "--writers-paused", "--backup", backup]), /P05 indexes ready/);
    await assert.doesNotReject(assertAuthSchema()); assert.equal(await User.countDocuments({}), count);
    assert.match(run(["--rollback", "--writers-paused", "--backup", backup]), /documents retained/);
    await assert.rejects(assertAuthSchema()); assert.equal(await User.countDocuments({}), count);
    await AuthSession.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 60, name: "synthetic_conflicting_ttl" });
    assert.ok((await inspectAuthSchema()).collections.some(item => item.conflicts.length));
    await assert.rejects(applyAuthSchema());
    await AuthSession.collection.dropIndex("synthetic_conflicting_ttl"); await applyAuthSchema();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
