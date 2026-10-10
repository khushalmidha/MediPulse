export const RESERVED_HOST_LABELS = ["www", "connect", "app", "api", "admin", "auth", "login", "signup", "hospital", "hospitals", "backend", "mail", "smtp", "status", "support", "docs", "assets", "cdn", "dev", "staging"];
// Owner-confirmed production project alias, verified against the public domain bundle.
export const COMPANY_HOST_ALIASES = ["medi-pulse-gamma.vercel.app"];
export const normalizeHostname = value => {
  if (typeof value !== "string" || !value.trim() || value.length > 260 || /[\s/\\?#@]/.test(value.trim())) return null;
  try {
    const url = new URL(`http://${value.trim()}`), host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) return null;
    if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return host;
    if (host.length > 253 || !host.includes(".") || !host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
    return host;
  } catch { return null; }
};
export const classifyHostname = (value, { baseDomain = "medipulse.live", appDomains = [], customDomainsEnabled = false } = {}) => {
  const host = normalizeHostname(value), base = normalizeHostname(baseDomain);
  if (!host || !base) return { kind: "unknown", host };
  if (host === base || host === `www.${base}` || ["localhost", "127.0.0.1", "[::1]"].includes(host)) return { kind: "company", host };
  if (base === "medipulse.live" && COMPANY_HOST_ALIASES.includes(host)) return { kind: "company", host };
  if (host === `connect.${base}`) return { kind: "connect", host };
  if (host === `app.${base}`) return { kind: "staff", host };
  if (host.endsWith(`.${base}`)) {
    const slug = host.slice(0, -(base.length + 1));
    return !slug.includes(".") && !RESERVED_HOST_LABELS.includes(slug) ? { kind: "hospital", host, slug } : { kind: "unknown", host };
  }
  if (appDomains.map(normalizeHostname).includes(host)) return { kind: "company", host };
  return { kind: customDomainsEnabled ? "custom" : "unknown", host };
};
export const canClaimCustomDomain = (value, options = {}) => {
  const host = normalizeHostname(value);
  return Boolean(host && !["localhost", "127.0.0.1", "[::1]"].includes(host) && classifyHostname(host, { ...options, customDomainsEnabled: true }).kind === "custom");
};
