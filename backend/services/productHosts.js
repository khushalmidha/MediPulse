import Hospital from "../model/hospital.js";
import HospitalDomain from "../model/hospitalDomain.js";
import { classifyHostname, normalizeHostname } from "../util/productHosts.js";
export const hostOptions = () => ({ baseDomain: process.env.PUBLIC_BASE_DOMAIN || "medipulse.live",
  appDomains: (process.env.PUBLIC_APP_DOMAINS || "").split(","), customDomainsEnabled: true });
export async function hospitalForHost(value) {
  const host = classifyHostname(value, hostOptions());
  if (host.kind === "hospital") return Hospital.findOne({ slug: host.slug, status: "active", "websiteConfig.subdomainEnabled": { $ne: false } }).lean();
  if (host.kind !== "custom") return null;
  const claim = await HospitalDomain.findOne({ _id: host.host, verified: true, state: "ready" }).lean();
  if (!claim) return null;
  return Hospital.findOne({ _id: claim.hospitalId, status: "active", "websiteConfig.customDomain": host.host, "websiteConfig.customDomainVerified": true }).lean();
}
export async function resolveHospitalHost(req, res) {
  const hospital = await hospitalForHost(req.query.host);
  res.set("Cache-Control", "no-store");
  if (!hospital) return res.status(404).json({ message: "Website unavailable" });
  return res.json({ hospital: { _id: hospital._id, slug: hospital.slug, name: hospital.name } });
}
export async function hospitalSlugFromPublicKey(key) {
  if (!key.includes(".")) return key;
  const hospital = await hospitalForHost(normalizeHostname(key));
  return hospital?.slug || null;
}
