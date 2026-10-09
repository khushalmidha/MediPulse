import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import AuthSession from "../model/authSession.js";
import User from "../model/user.js";
import Doctor from "../model/doctor.js";
import HospitalStaff from "../model/hospitalStaff.js";
import { isAllowedOrigin } from "../config/corsOrigins.js";

const listeners = new Set();
const failure = (message, status = 401) => Object.assign(new Error(message), { status });
export const onSessionRevoked = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const notifyRevoked = (sessionId) => { for (const listener of listeners) listener(sessionId); };
export const cookieOptions = (remember = false) => ({
  httpOnly: true, path: "/", secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  ...(remember ? { maxAge: 30 * 86400000 } : {}),
});
export const safeAccount = (account) => {
  const value = account?.toObject ? account.toObject() : { ...account };
  for (const key of ["password", "inviteToken", "inviteExpiresAt", "authVersion"]) delete value[key];
  return value;
};
export async function revokeToken(token) {
  if (!token) return;
  let claims;
  try { claims = jwt.verify(token, process.env.TOKEN_KEY); } catch { return; }
  if (!claims.sid) return;
  await AuthSession.updateOne({ _id: claims.sid, principalId: claims.id }, { $set: { revokedAt: new Date() } });
  notifyRevoked(claims.sid);
}
export async function revokePrincipal(id, kind, session) {
  const active = await AuthSession.find({ principalId: id, kind, revokedAt: null }).session(session || null);
  await AuthSession.updateMany({ principalId: id, kind, revokedAt: null }, { $set: { revokedAt: new Date() } }, { session });
  return () => { for (const row of active) notifyRevoked(row._id); };
}
export function clearAuthCookies(res) {
  for (const name of ["token", "staffToken", "id", "staffId"]) res.clearCookie(name, cookieOptions());
}
export async function issueSession(req, res, principal, kind, remember = false) {
  // One active workspace per browser. Revoke both old cookie sessions before switching.
  for (const token of [req.cookies?.token, req.cookies?.staffToken]) await revokeToken(token);
  clearAuthCookies(res);
  const seconds = (remember ? 30 : 3) * 86400;
  const session = await AuthSession.create({ _id: crypto.randomUUID(), principalId: principal._id,
    kind, authVersion: principal.authVersion || 0, csrfToken: crypto.randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + seconds * 1000) });
  const claims = { id: String(principal._id), sid: session._id, role: kind === "staff" ? principal.role : kind,
    ...(kind === "staff" ? { type: "staff", hospitalId: String(principal.hospitalId) } : {}) };
  res.cookie(kind === "staff" ? "staffToken" : "token", jwt.sign(claims, process.env.TOKEN_KEY, { expiresIn: seconds }), cookieOptions(remember));
  return session.csrfToken;
}
export async function resolveSession(token, scope) {
  let claims;
  try { claims = jwt.verify(token, process.env.TOKEN_KEY); } catch { throw failure("Expired or invalid session"); }
  const kind = claims.type === "staff" ? "staff" : claims.role;
  if (!claims.sid || !["user", "doctor", "staff"].includes(kind) || (scope === "staff") !== (kind === "staff")) throw failure("Invalid session scope");
  const session = await AuthSession.findById(claims.sid).select("+csrfToken");
  if (!session || session.revokedAt || session.expiresAt <= new Date() || String(session.principalId) !== claims.id || session.kind !== kind) throw failure("Session has ended");
  const principal = kind === "staff"
    ? await HospitalStaff.findOne({ _id: claims.id, hospitalId: claims.hospitalId, isActive: true, inviteStatus: "accepted" })
    : await (kind === "user" ? User : Doctor).findById(claims.id);
  if (!principal || (principal.authVersion || 0) !== session.authVersion) throw failure("Session has ended");
  return { claims, session, principal, kind };
}
export function checkCsrf(req, session, bearer) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) throw failure("Origin is not allowed", 403);
  // Explicit bearer clients do not use browser ambient credentials.
  if (bearer) return;
  if (!req.headers.origin || req.headers["x-csrf-token"] !== session.csrfToken) throw failure("Session verification required", 403);
}
export const originGuard = (req, res, next) => {
  if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) return res.status(403).json({ message: "Origin is not allowed" });
  // Browser mutations with any ambient session must have an allowed Origin, including auth endpoints.
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && (req.cookies?.token || req.cookies?.staffToken) && !req.headers.origin)
    return res.status(403).json({ message: "Origin is required" });
  next();
};
export async function authenticateRequest(req, scope) {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || req.cookies?.[scope === "staff" ? "staffToken" : "token"];
  if (!token) throw failure("Sign in is required");
  const result = await resolveSession(token, scope);
  checkCsrf(req, result.session, Boolean(bearer));
  req.authSession = result.session;
  return result;
}
