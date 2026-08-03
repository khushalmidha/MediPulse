import Hospital from "../model/hospital.js";
import { getRedis } from "../services/redis.js";

const domainPattern = /^(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,}$/;

const requireHospitalAdminAccess = (req, res, hospitalId) => {
  // FIXED: ObjectId/string mismatch could reject valid admins for website domain actions.
  if (String(req.staff?.hospitalId || "") !== String(hospitalId || "") || req.staff?.role !== "HOSPITAL_ADMIN") {
    res.status(403).json({ message: "Hospital admin access is required" });
    return false;
  }

  return true;
};

const vercelRequest = async (path, options = {}) => {
  if (!process.env.VERCEL_API_TOKEN || !process.env.VERCEL_PROJECT_ID) {
    throw new Error("Vercel domain API is not configured");
  }

  const response = await fetch(`https://api.vercel.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Vercel API failed with ${response.status}`);
  }

  return payload;
};

const dnsInstructionsForDomain = (domain) => {
  const isApex = domain.split(".").length === 2;
  return isApex
    ? { type: "A", record: { name: "@", value: "76.76.21.21" } }
    : { type: "CNAME", record: { name: domain.split(".")[0], value: "cname.vercel-dns.com" } };
};

const addCustomDomain = async (req, res) => {
  const { id } = req.params;
  if (!requireHospitalAdminAccess(req, res, id)) return;

  const domain = String(req.body.domain || "").trim().toLowerCase();
  if (!domainPattern.test(domain)) {
    return res.status(400).json({ message: "Valid custom domain is required" });
  }

  try {
    const payload = await vercelRequest(`/v10/projects/${process.env.VERCEL_PROJECT_ID}/domains`, {
      method: "POST",
      body: JSON.stringify({ name: domain }),
    });

    const hospital = await Hospital.findByIdAndUpdate(
      id,
      {
        "websiteConfig.customDomain": domain,
        "websiteConfig.customDomainVerified": false,
        "websiteConfig.customDomainVercelId": payload?.id,
      },
      { new: true },
    );

    if (!hospital) return res.status(404).json({ message: "Hospital not found" });

    // Cache invalidation: custom domain changes affect public website routing/profile.
    await getRedis().del(`hospital:public:${hospital.slug}`);
    return res.status(200).json({
      message: "Custom domain added. Configure DNS to complete verification.",
      domain,
      verification: dnsInstructionsForDomain(domain),
    });
  } catch (error) {
    return res.status(502).json({ message: error.message });
  }
};

const verifyCustomDomain = async (req, res) => {
  const { id } = req.params;
  if (!requireHospitalAdminAccess(req, res, id)) return;

  const hospital = await Hospital.findById(id);
  if (!hospital?.websiteConfig?.customDomain) {
    return res.status(404).json({ message: "Custom domain is not configured" });
  }

  try {
    const payload = await vercelRequest(`/v6/domains/${hospital.websiteConfig.customDomain}/config`);
    const verified = Boolean(payload?.configuredBy) || payload?.misconfigured === false || payload?.configured === true;
    hospital.websiteConfig.customDomainVerified = verified;
    await hospital.save();
    await getRedis().del(`hospital:public:${hospital.slug}`);
    return res.status(200).json({ domain: hospital.websiteConfig.customDomain, verified, vercel: payload });
  } catch (error) {
    return res.status(502).json({ message: error.message });
  }
};

const removeCustomDomain = async (req, res) => {
  const { id } = req.params;
  if (!requireHospitalAdminAccess(req, res, id)) return;

  const hospital = await Hospital.findById(id);
  if (!hospital?.websiteConfig?.customDomain) {
    return res.status(404).json({ message: "Custom domain is not configured" });
  }

  try {
    await vercelRequest(
      `/v10/projects/${process.env.VERCEL_PROJECT_ID}/domains/${hospital.websiteConfig.customDomain}`,
      { method: "DELETE" },
    );
  } catch (error) {
    return res.status(502).json({ message: error.message });
  }

  hospital.websiteConfig.customDomain = undefined;
  hospital.websiteConfig.customDomainVerified = false;
  hospital.websiteConfig.customDomainVercelId = undefined;
  await hospital.save();
  await getRedis().del(`hospital:public:${hospital.slug}`);
  return res.status(200).json({ message: "Custom domain removed" });
};

export { addCustomDomain, removeCustomDomain, verifyCustomDomain };
