import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import AuthSession from "../../model/authSession.js";
// Synthetic principals only; a persisted sid exercises the real session guard.
export async function sessionToken(record, kind) {
  const session = await AuthSession.create({ _id: crypto.randomUUID(), principalId: record._id,
    kind, authVersion: record.authVersion || 0, csrfToken: "fixture-csrf", expiresAt: new Date(Date.now() + 3600000) });
  return jwt.sign({ id: String(record._id), sid: session._id, role: kind,
    ...(kind === "staff" ? { type: "staff", hospitalId: String(record.hospitalId) } : {}) }, process.env.TOKEN_KEY, { expiresIn: 3600 });
}
