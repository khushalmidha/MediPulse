import { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import { ProductContext } from "../context/ProductContext";
import { resolveProductLocation } from "../utils/productLocation";
import { BACKEND_URL } from "../utils";
import App from "../App";
const locationContext = resolveProductLocation({ hostname: window.location.hostname, pathname: window.location.pathname,
  baseDomain: import.meta.env.VITE_BASE_DOMAIN || "medipulse.live", appDomains: (import.meta.env.VITE_APP_DOMAINS || "").split(","),
  customDomainsEnabled: import.meta.env.VITE_ENABLE_HOSPITAL_CUSTOM_DOMAINS === "true" });
export default function ProductRouter() {
  useEffect(() => {
    const crossProduct = event => {
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target || anchor.hasAttribute("download")) return;
      const target = new URL(anchor.href);
      if (target.origin !== window.location.origin) return;
      const next = resolveProductLocation({ hostname: target.hostname, pathname: target.pathname,
        baseDomain: import.meta.env.VITE_BASE_DOMAIN || "medipulse.live", appDomains: (import.meta.env.VITE_APP_DOMAINS || "").split(","),
        customDomainsEnabled: import.meta.env.VITE_ENABLE_HOSPITAL_CUSTOM_DOMAINS === "true" });
      if (next.kind !== locationContext.kind || next.basename !== locationContext.basename) { event.preventDefault(); window.location.assign(target.href); }
    };
    document.addEventListener("click", crossProduct, true);
    return () => document.removeEventListener("click", crossProduct, true);
  }, []);
  const [resolved, setResolved] = useState(null), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const needsHostCheck = ["hospital", "custom"].includes(locationContext.kind);
  useEffect(() => {
    if (!needsHostCheck) return undefined;
    const controller = new AbortController();
    setFailed(false); setResolved(null);
    fetch(`${BACKEND_URL}/api/hospitals/resolve-host?host=${encodeURIComponent(locationContext.host)}`, { signal: controller.signal, credentials: "omit" })
      .then(async response => { if (!response.ok) throw new Error("Host unavailable"); return response.json(); })
      .then(data => { if (!data.hospital?.slug) throw new Error("Invalid host response"); if (!controller.signal.aborted) setResolved(data.hospital); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt, needsHostCheck]);
  if (locationContext.kind === "unknown" || failed) return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-bold">Website unavailable</h1><p className="my-4">This address is not registered as an active MediPulse website.</p>{failed && <button className="rounded border p-3" onClick={() => setAttempt(value => value + 1)}>Retry website</button>} <a className="underline" href="https://medipulse.live">MediPulse home</a></main>;
  if (needsHostCheck && !resolved) return <main className="p-8" role="status">Loading hospital website...</main>;
  const product = needsHostCheck ? { ...locationContext, kind: "patient", slug: resolved.slug, hospital: resolved } : locationContext;
  return <ProductContext.Provider value={product}><AuthProvider><BrowserRouter basename={product.basename}><App /></BrowserRouter></AuthProvider></ProductContext.Provider>;
}
