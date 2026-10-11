import test from "node:test";
import assert from "node:assert/strict";
import User from "../model/user.js";
import Doctor from "../model/doctor.js";
import { deleteUserById } from "../controller/user.js";
import { deleteDoctorById } from "../controller/doctor.js";
import AuthSession from "../model/authSession.js";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import { createServer } from "node:http";
import userRouter from "../routes/user.js";
import doctorRouter from "../routes/doctor.js";

const owner = "0000000000000000000000ab", other = "0000000000000000000000cd";
for (const [role, Model, remove] of [["user", User, deleteUserById], ["doctor", Doctor, deleteDoctorById]]) {
  for (const [name, auth, target, expected] of [
    ["missing session", null, owner, 401],
    ["foreign role", { role: role === "user" ? "doctor" : "user", id: owner }, owner, 403],
    ["foreign account", { role, id: owner }, other, 403],
    ["malformed id", { role, id: owner }, "invalid", 400],
    ["own historical identity", { role, id: owner }, owner, 409],
    ["case-normalized own identity", { role, id: owner }, owner.toUpperCase(), 409],
  ]) test(`${role} removal rejects ${name} without deleting records`, async t => {
    const erase = t.mock.method(Model, "findByIdAndDelete", () => { throw new Error("must preserve identity"); });
    let status, body; const res = { status: value => { status = value; return res; }, json: value => { body = value; return res; } };
    await remove({ auth, params: { id: target } }, res);
    assert.equal(status, expected); assert.equal(erase.mock.callCount(), 0);
    if (expected === 409) assert.equal(body.code, "ACCOUNT_RETENTION_REVIEW_REQUIRED");
    assert.ok(!JSON.stringify(body).includes(owner)); assert.ok(!JSON.stringify(body).includes(other));
  });
}

test("real account deletion routes enforce session, CSRF, role and ownership without database writes", async t => {
  const erases = [User, Doctor].map(Model => t.mock.method(Model, "findByIdAndDelete", () => { throw new Error("must not erase"); }));
  for (const Model of [User, Doctor]) t.mock.method(Model, "findById", async () => ({ _id: owner, firstName: "Synthetic", authVersion: 0 }));
  t.mock.method(AuthSession, "findById", sid => ({ select: async () => ({ _id: sid, principalId: owner, kind: sid === "doctor-session" ? "doctor" : "user", authVersion: 0, csrfToken: "synthetic-csrf", expiresAt: new Date(Date.now() + 60000), revokedAt: null }) }));
  const token = role => jwt.sign({ id: owner, role, sid: role + "-session" }, process.env.TOKEN_KEY, { expiresIn: 60 });
  const app = express(); app.use(cookieParser(), express.json()); app.use("/user", userRouter); app.use("/doctor", doctorRouter);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: "Synthetic request rejected" }));
  const server = createServer(app).listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => new Promise(resolve => server.close(resolve)));
  const call = (path, headers = {}) => fetch("http://127.0.0.1:" + server.address().port + path, { method: "DELETE", headers });
  assert.equal((await call("/user/" + other)).status, 401);
  assert.equal((await call("/user/" + other, { Authorization: "Bearer " + token("user") })).status, 403);
  assert.equal((await call("/doctor/" + owner, { Authorization: "Bearer " + token("user") })).status, 403);
  assert.equal((await call("/doctor/invalid", { Authorization: "Bearer " + token("doctor") })).status, 400);
  assert.equal((await call("/user/" + owner, { Cookie: "token=" + token("user"), Origin: "http://localhost:5173" })).status, 403);
  const response = await call("/user/" + owner, { Cookie: "token=" + token("user"), Origin: "http://localhost:5173", "X-CSRF-Token": "synthetic-csrf" });
  assert.equal(response.status, 409); assert.equal((await response.json()).code, "ACCOUNT_RETENTION_REVIEW_REQUIRED");
  for (const erase of erases) assert.equal(erase.mock.callCount(), 0);
});
