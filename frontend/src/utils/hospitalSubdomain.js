export function getHospitalSlugFromHostname() {
  const hostname = window.location.hostname;
  const baseDomain = import.meta.env.VITE_BASE_DOMAIN || "medipulse.com";
  const customDomainsEnabled = import.meta.env.VITE_ENABLE_HOSPITAL_CUSTOM_DOMAINS === "true";
  const appDomains = [
    "localhost",
    "127.0.0.1",
    "vercel.app",
    "onrender.com",
    ...(import.meta.env.VITE_APP_DOMAINS || "")
      .split(",")
      .map((domain) => domain.trim())
      .filter(Boolean),
  ];

  if (appDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    return null;
  }

  if (hostname.endsWith(`.${baseDomain}`)) {
    const subdomain = hostname.replace(`.${baseDomain}`, "");
    if (!["www", "app", "api", "admin"].includes(subdomain)) {
      return subdomain;
    }
  }

  if (customDomainsEnabled && !hostname.includes(baseDomain)) {
    return { customDomain: hostname };
  }

  return null;
}
