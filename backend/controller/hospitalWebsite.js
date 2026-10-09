import { resolveTxt } from "node:dns/promises";
import mongoose from "mongoose";
import Hospital from "../model/hospital.js";
import HospitalDomain from "../model/hospitalDomain.js";
import { invalidatePublicHospitalCache } from "../services/publicHospitalCache.js";
import { canClaimCustomDomain, normalizeHostname } from "../util/productHosts.js";
import { hostOptions } from "../services/productHosts.js";
const failure = (status, message) => Object.assign(new Error(message), { status });
const projectPath = () => `/v9/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID || "")}/domains`;
const vercelRequest = async (path, options = {}) => {
  if (!process.env.VERCEL_API_TOKEN || !process.env.VERCEL_PROJECT_ID) throw failure(503, "Domain provider is not configured");
  const url = new URL(`https://api.vercel.com${path}`);
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000), headers: {
    Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`, "Content-Type": "application/json",
  } });
  if (response.status === 404 && options.method === "DELETE") return {};
  if (!response.ok) throw Object.assign(failure(502, "Domain provider could not complete the request"), { providerStatus: response.status });
  return response.json().catch(() => ({}));
};
const transaction = async fn => {
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => fn(session)); } finally { await session.endSession(); }
};
const allowed = (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ message: "Invalid hospital" }); return false; }
  if (String(req.staff?.hospitalId || "") !== req.params.id || (req.staff?.role !== "HOSPITAL_ADMIN" && !req.staff?.adminAccess)) {
    res.status(403).json({ message: "Hospital admin access is required" }); return false;
  }
  return true;
};
const challenges = payload => (payload?.verification || []).map(item => ({ type: item.type, domain: item.domain, value: item.value, reason: item.reason }));
const wrap = handler => async (req, res) => {
  if (!allowed(req, res)) return;
  try { return await handler(req, res); }
  catch (error) { return res.status(error.code === 11000 ? 409 : error.status || 502).json({ message: error.code === 11000 ? "Domain is already reserved" : error.status ? error.message : "Domain operation could not be completed; retry safely" }); }
};
export const makeDomainControllers = (request = vercelRequest, readTxt = resolveTxt) => ({
  addCustomDomain: wrap(async (req, res) => {
    const raw = req.body?.domain;
    const domain = normalizeHostname(raw);
    if (!canClaimCustomDomain(raw, hostOptions()) || String(raw).trim().includes(":")) throw failure(400, "Valid external custom domain is required");
    await transaction(async session => {
      const hospital = await Hospital.findById(req.params.id).session(session);
      if (!hospital) throw failure(404, "Hospital not found");
      if (hospital.websiteConfig?.customDomain && hospital.websiteConfig.customDomain !== domain) throw failure(409, "Remove the current domain before replacing it");
      const claim = await HospitalDomain.findById(domain).session(session);
      if (claim && (String(claim.hospitalId) !== req.params.id || claim.state === "removing")) throw failure(409, "Domain is already reserved or being removed");
      if (!claim) await HospitalDomain.create([{ _id: domain, hospitalId: req.params.id }], { session });
      hospital.websiteConfig.customDomain = domain;
      // Replaying a claim preserves verified state; only verify can grant it.
      if (!claim?.verified) hospital.websiteConfig.customDomainVerified = false;
      await hospital.save({ session });
    });
    let payload;
    try { payload = await request(`${projectPath()}/${encodeURIComponent(domain)}`); }
    catch (error) {
      if (error.providerStatus !== 404) throw error;
      payload = await request(projectPath().replace("/v9/", "/v10/"), { method: "POST", body: JSON.stringify({ name: domain }) });
    }
    await invalidatePublicHospitalCache(await Hospital.findById(req.params.id));
    const reservation = await HospitalDomain.findById(domain);
    if (!reservation || String(reservation.hospitalId) !== req.params.id || reservation.state === "removing") throw failure(409, "Domain changed during provisioning");
    return res.json({ ownershipVerification: { type: "TXT", name: `_medipulse.${domain}`, value: reservation.challenge }, message: "Domain reserved. Complete the provider ownership and DNS checks, then verify.", domain, verification: challenges(payload) });
  }),
  verifyCustomDomain: wrap(async (req, res) => {
    const hospital = await Hospital.findById(req.params.id);
    const domain = hospital?.websiteConfig?.customDomain;
    if (!domain) throw failure(404, "Custom domain is not configured");
    const claim = await HospitalDomain.findOne({ _id: domain, hospitalId: req.params.id, state: { $ne: "removing" } });
    if (!claim) throw failure(409, "Domain reservation must be migrated or recreated");
    await transaction(async session => {
      const withdrawn = await HospitalDomain.updateOne({ _id: domain, hospitalId: req.params.id, challenge: claim.challenge, state: { $ne: "removing" } }, { $set: { verified: false, state: "pending" } }, { session });
      if (!withdrawn.matchedCount) throw failure(409, "Domain is being removed");
      await Hospital.updateOne({ _id: req.params.id, "websiteConfig.customDomain": domain }, { $set: { "websiteConfig.customDomainVerified": false } }, { session });
    });
    await invalidatePublicHospitalCache(hospital);
    await request(`${projectPath()}/${encodeURIComponent(domain)}/verify`, { method: "POST" });
    const ownership = await request(`${projectPath()}/${encodeURIComponent(domain)}`);
    const config = await request(`/v6/domains/${encodeURIComponent(domain)}/config`);
    let records = [], timer;
    try { records = await Promise.race([readTxt(`_medipulse.${domain}`), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("DNS timeout")), 5000); })]); }
    catch { /* Missing ownership TXT leaves the domain unverified. */ }
    finally { clearTimeout(timer); }
    const hospitalOwnership = Boolean(claim.challenge) && records.some(record => record.join("") === claim.challenge);
    const verified = hospitalOwnership && ownership.verified === true && (config.misconfigured === false || config.configured === true);
    await transaction(async session => {
      const updated = await HospitalDomain.updateOne({ _id: domain, hospitalId: req.params.id, challenge: claim.challenge, state: { $ne: "removing" } }, { $set: { verified, state: verified ? "ready" : "pending" } }, { session });
      if (!updated.matchedCount) throw failure(409, "Domain changed during verification");
      const bound = await Hospital.updateOne({ _id: req.params.id, "websiteConfig.customDomain": domain }, { $set: { "websiteConfig.customDomainVerified": verified } }, { session });
      if (!bound.matchedCount) throw failure(409, "Domain changed during verification");
    });
    await invalidatePublicHospitalCache(hospital);
    return res.json({ domain, verified, verification: challenges(ownership), hospitalOwnership, dnsConfigured: config.misconfigured === false || config.configured === true });
  }),
  removeCustomDomain: wrap(async (req, res) => {
    const hospital = await Hospital.findById(req.params.id), domain = hospital?.websiteConfig?.customDomain;
    if (!domain) throw failure(404, "Custom domain is not configured");
    const claim = await HospitalDomain.findOne({ _id: domain, hospitalId: req.params.id });
    if (!claim) throw failure(409, "Domain reservation must be migrated or recreated");
    // Withdraw public routing before contacting the provider, including on failed deletion.
    await transaction(async session => {
      const withdrawn = await HospitalDomain.updateOne({ _id: domain, hospitalId: req.params.id, challenge: claim.challenge }, { $set: { verified: false, state: "removing" } }, { session });
      if (!withdrawn.matchedCount) throw failure(409, "Domain changed during removal");
      await Hospital.updateOne({ _id: req.params.id, "websiteConfig.customDomain": domain }, { $set: { "websiteConfig.customDomainVerified": false } }, { session });
    });
    await invalidatePublicHospitalCache(hospital);
    await request(`${projectPath()}/${encodeURIComponent(domain)}`, { method: "DELETE" });
    await transaction(async session => {
      if (!await HospitalDomain.findOne({ _id: domain, hospitalId: req.params.id, challenge: claim.challenge, state: "removing" }).session(session)) throw failure(409, "Domain changed during removal");
      const updated = await Hospital.updateOne({ _id: req.params.id, "websiteConfig.customDomain": domain }, { $unset: { "websiteConfig.customDomain": "", "websiteConfig.customDomainVercelId": "" }, $set: { "websiteConfig.customDomainVerified": false } }, { session });
      if (!updated.matchedCount) throw failure(409, "Domain changed during removal");
      await HospitalDomain.deleteOne({ _id: domain, hospitalId: req.params.id, challenge: claim.challenge, state: "removing" }, { session });
    });
    return res.json({ message: "Custom domain removed" });
  }),
});
export const { addCustomDomain, verifyCustomDomain, removeCustomDomain } = makeDomainControllers();
