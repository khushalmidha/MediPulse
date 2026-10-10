/* eslint-disable react/prop-types */
import { createContext, useContext, useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Heart, Menu, X } from "lucide-react";
import Navbar from "./Navbar";
import { Button } from "./ui";
import { BACKEND_URL } from "../utils";
import { useProduct } from "../context/ProductContext";
import { brandVariables } from "../utils/visualSystem";

const HospitalBrandContext = createContext({ hospital: null });
// eslint-disable-next-line react-refresh/only-export-components
export const useHospitalBrand = () => useContext(HospitalBrandContext);
export function Brand({ caption, name = "MediPulse", to = "/" }) {
  return <Link className="mp-brand" to={to}><span className="mp-brand-mark"><Heart size={24} strokeWidth={1.8} aria-hidden="true" /></span><span className="mp-brand-name">{name}{caption && <small>{caption}</small>}</span></Link>;
}
function SimpleHeader({ patient, hospital }) {
  const [open, setOpen] = useState(false), location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname]);
  const links = patient ? [{ to: "/", label: "Hospital home" }, { to: "/visits", label: "My visits" }, { to: "/login", label: "Patient sign in" }] : [{ href: "#products", label: "Our products" }, { href: "/connect", label: "Connect" }, { href: "/hospitals", label: "Find a hospital" }, { href: "/hospital", label: "Hospital workspace" }];
  const renderLinks = () => links.map(link => link.to ? <NavLink key={link.label} to={link.to} end>{link.label}</NavLink> : <a key={link.label} href={link.href} onClick={() => setOpen(false)}>{link.label}</a>);
  return <header className="mp-header"><div className="mp-header-inner"><Brand name={patient ? hospital?.name || "Hospital care" : "MediPulse"} caption={patient ? "Patient portal · powered by MediPulse" : "Connected care, clearer journeys"} />{!patient && <nav className="mp-header-links" aria-label="Company">{renderLinks()}</nav>}{!patient && <Button variant="ghost" className="mp-menu-toggle" aria-label="Toggle mobile menu" aria-expanded={open} aria-controls="product-mobile-navigation" onClick={() => setOpen(value => !value)}>{open ? <X size={22} /> : <Menu size={22} />}</Button>}</div>{patient && <nav className="mp-patient-quicknav" aria-label="Hospital website">{renderLinks()}</nav>}{open && <nav id="product-mobile-navigation" className="mp-mobile-nav" aria-label="Mobile navigation" onKeyDown={event => { if (event.key === "Escape") { setOpen(false); document.querySelector('.mp-menu-toggle')?.focus(); } }}>{renderLinks()}</nav>}</header>;
}
export function ShellFooter({ type }) {
  return <footer className="mp-footer"><div className="mp-footer-inner"><div><Brand caption="Care that stays connected" /><p>Independent care and hospital OPD, in one connected platform.</p></div><nav className="mp-footer-links" aria-label="Footer">{type === "staff" ? <a href={(import.meta.env.VITE_BASE_DOMAIN ? "https://" + import.meta.env.VITE_BASE_DOMAIN : "https://medipulse.live")}>MediPulse home</a> : <><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></>}<span>© {new Date().getFullYear()} MediPulse</span></nav></div></footer>;
}
export default function ProductShell({ type, children }) {
  const product = useProduct();
  const [hospital, setHospital] = useState(product.hospital || null);
  useEffect(() => {
    if (type !== "patient" || !product.slug) return undefined;
    const controller = new AbortController();
    fetch(BACKEND_URL + "/api/hospitals/" + encodeURIComponent(product.slug), { signal: controller.signal, credentials: "omit" })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("Unavailable")))
      .then(data => { if (!controller.signal.aborted) setHospital(data.hospital); }).catch(() => {});
    return () => controller.abort();
  }, [type, product.slug]);
  const branded = type === "patient" ? brandVariables(hospital?.branding?.primaryColor) : undefined;
  return <HospitalBrandContext.Provider value={{ hospital }}><div className={"mp-shell mp-" + type} style={branded}><a className="mp-skip" href="#main-content" onClick={() => document.getElementById("main-content")?.focus()}>Skip to content</a>{["company", "patient"].includes(type) ? <SimpleHeader patient={type === "patient"} hospital={hospital} /> : <Navbar />}<div className="mp-shell-content" id="main-content" tabIndex={-1}>{children}</div><ShellFooter type={type} /></div></HospitalBrandContext.Provider>;
}
