import { classifyHostname } from "./productHosts.js";
// Compatibility helper; ProductRouter performs the authoritative host lookup.
export function getHospitalSlugFromHostname() {
  const result = classifyHostname(window.location.hostname, { baseDomain: import.meta.env.VITE_BASE_DOMAIN || "medipulse.live",
    appDomains: (import.meta.env.VITE_APP_DOMAINS || "").split(","), customDomainsEnabled: import.meta.env.VITE_ENABLE_HOSPITAL_CUSTOM_DOMAINS === "true" });
  return result.kind === "hospital" ? result.slug : result.kind === "custom" ? { customDomain: result.host } : null;
}
