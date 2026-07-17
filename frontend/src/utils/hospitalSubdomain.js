export function getHospitalSlugFromHostname() {
  const hostname = window.location.hostname;
  const baseDomain = import.meta.env.VITE_BASE_DOMAIN || "medipulse.com";

  if (hostname.endsWith(`.${baseDomain}`)) {
    const subdomain = hostname.replace(`.${baseDomain}`, "");
    if (!["www", "app", "api", "admin"].includes(subdomain)) {
      return subdomain;
    }
  }

  if (!hostname.includes(baseDomain) && !hostname.includes("localhost") && hostname !== "127.0.0.1") {
    return { customDomain: hostname };
  }

  return null;
}
