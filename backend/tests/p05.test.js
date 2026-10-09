import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedOrigin } from "../config/corsOrigins.js";
import { safeAccount, cookieOptions, checkCsrf } from "../services/authSessions.js";
import { canAccessCommunity, isCommunityOrganizer } from "../services/communityAccess.js";
import { validateForecast } from "../services/forecastValidation.js";
import User from "../model/user.js";
import Doctor from "../model/doctor.js";
import HospitalStaff from "../model/hospitalStaff.js";

test("origins require explicit ownership/configuration, including hosted previews", () => {
  assert.equal(isAllowedOrigin("https://medipulse.live"), true);
  for (const origin of ["https://evil.vercel.app", "https://evil.onrender.com", "https://medipulse.live.evil.invalid", "http://localhost:9999", "null", "*"]) assert.equal(isAllowedOrigin(origin), false);
});
test("cookies are host-only HttpOnly and CSRF is required for ambient credentials", () => {
  assert.equal(cookieOptions().httpOnly, true); assert.equal(cookieOptions().domain, undefined);
  for (const headers of [{}, { origin: "https://medipulse.live" }, { origin: "https://evil.invalid", "x-csrf-token": "fixture" }])
    assert.throws(() => checkCsrf({ method: "POST", headers }, { csrfToken: "fixture" }, false), { status: 403 });
  checkCsrf({ method: "PATCH", headers: { origin: "https://medipulse.live", "x-csrf-token": "fixture" } }, { csrfToken: "fixture" }, false);
  checkCsrf({ method: "POST", headers: {} }, {}, true);
});
test("account serialization/projections omit password hashes and staff invite secrets", () => {
  for (const Model of [User, Doctor, HospitalStaff]) {
    const doc = new Model({ password: "synthetic-hash", authVersion: 2, inviteToken: "synthetic-secret" });
    assert.equal(Model.schema.path("password").options.select, false);
    assert.equal(JSON.stringify(doc).includes("synthetic-hash"), false);
    assert.equal(safeAccount(doc).password, undefined); assert.equal(safeAccount(doc).authVersion, undefined);
  }
});
test("community policy permits member accounts and doctor organizers only", () => {
  const community = { author: "doctor", members: ["patient"] };
  assert.equal(canAccessCommunity(community, { id: "patient", role: "user" }), true);
  assert.equal(canAccessCommunity(community, { id: "doctor", role: "doctor" }), true);
  assert.equal(canAccessCommunity(community, { id: "doctor", role: "user" }), false);
  assert.equal(canAccessCommunity(community, { id: "patient", role: "staff" }), false);
  assert.equal(isCommunityOrganizer(community, { id: "patient", role: "user" }), false);
});
test("forecast output rejects malformed, negative, unknown, duplicate and extra provider fields", () => {
  const valid = { bloodGroup: "O+", shortageRisk: "low", predictedUnits: 2, recommendedReserve: 1, explanation: "Synthetic planning draft", secret: "discarded" };
  assert.equal(validateForecast([valid], "blood")[0].secret, undefined);
  for (const value of ["garbage", {}, [], [null], [{ ...valid, predictedUnits: -1 }], [{ ...valid, predictedUnits: 1.1 }], [{ ...valid, bloodGroup: "X" }], [valid, valid]]) assert.throws(() => validateForecast(value, "blood"), { status: 502 });
  const bed = { departmentId: { name: "Fixture" }, bedType: "ICU", confidence: "Low", predictedDemand: 1, recommendedReserve: 0, explanation: "Draft" };
  assert.throws(() => validateForecast([bed], "beds", []), { status: 502 });
  assert.equal(validateForecast([bed], "beds", [{ _id: "owned-id", name: "Fixture" }])[0].departmentId._id, "owned-id");
});
