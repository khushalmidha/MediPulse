import { classifyHostname } from "./productHosts.js";
export const resolveProductLocation = ({ hostname, pathname, ...options }) => {
  const host = classifyHostname(hostname, options);
  if (["hospital", "custom", "unknown"].includes(host.kind)) return { ...host, basename: "/" };
  if (host.kind !== "company") return { ...host, basename: "/" };
  if (/^\/connect(?:\/|$)/.test(pathname)) return { ...host, kind: "connect", basename: "/connect" };
  const hospital = pathname.match(/^\/hospitals\/([a-z0-9-]+)(?:\/|$)/);
  if (hospital) return { ...host, kind: "patient", slug: hospital[1], basename: `/hospitals/${hospital[1]}` };
  if (/^\/(?:hospital(?:\/|$)|staff\/accept-invite|signup\/hospital-admin)/.test(pathname)) return { ...host, kind: "staff", basename: "/" };
  return { ...host, basename: "/" };
};
