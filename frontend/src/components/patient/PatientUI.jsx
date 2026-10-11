/* eslint-disable react/prop-types */
import { Fragment } from "react";
import { useLocation } from "react-router-dom";
import { ArrowUpRight, Building2, MapPin, ShieldCheck, Star } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { Banner, Button, Card, EmptyState, LoadingState, StatusBadge } from "../ui";
import { careSystem, hospitalLocation, hospitalPath } from "../../utils/patientCare";
import "./patient.css";

export function PatientAccess({ children }) {
  const auth = useAuth(), location = useLocation();
  if (auth.loader) return <main className="mp-page"><LoadingState>Checking your patient account...</LoadingState></main>;
  if (!auth.isAuth || !auth.user || auth.role !== "user") return <PatientPage title="Your patient account is needed" description="Sign in to access your own records and care requests."><Card><EmptyState title="Continue with patient sign in" action={<Button to={"/login?returnTo=" + encodeURIComponent(location.pathname + location.search)}>Patient sign in</Button>}>Doctor and staff workspaces use separate access.</EmptyState></Card></PatientPage>;
  return <Fragment key={auth.role + ":" + auth.user._id}>{children}</Fragment>;
}
export function PatientPage({ eyebrow = "Your care, connected", title, description, actions, aside, children }) {
  return <main className="mp-page mp-patient-page"><header className="mp-patient-hero"><div><p className="mp-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="mp-patient-intro">{description}</p>{actions && <div className="mp-actions">{actions}</div>}</div>{aside && <div className="mp-patient-hero-aside">{aside}</div>}</header>{children}</main>;
}
export function ResourceNotice({ resource, label }) {
  return resource.error ? <Banner action={<Button variant="secondary" size="small" onClick={resource.refresh}>Retry {label}</Button>}>{resource.error}{resource.data && <span> Previously loaded {label} are shown; they may be out of date.</span>}</Banner> : null;
}
export function HospitalCard({ hospital }) {
  const path = hospitalPath(hospital), rating = Number(hospital.stats?.avgRating), totalReviews = Number(hospital.stats?.totalReviews);
  return <Card className="mp-hospital-card"><div className="mp-hospital-card-top"><span className="mp-hospital-mark">{hospital.branding?.logo ? <img src={hospital.branding.logo} alt="" loading="lazy" /> : <Building2 size={29} aria-hidden="true" />}</span><div><p className="mp-eyebrow">{hospital.type?.replaceAll("_", " ") || "Hospital"}</p><h2>{hospital.name || "Hospital name not listed"}</h2></div></div><p className="mp-hospital-location"><MapPin size={16} aria-hidden="true" />{hospitalLocation(hospital)}</p>{hospital.branding?.tagline && <p className="mp-hospital-description">{hospital.branding.tagline}</p>}<StatusBadge>{careSystem(hospital.medicineSystem)}</StatusBadge><div className="mp-hospital-card-bottom"><span className="mp-hospital-rating"><Star size={16} aria-hidden="true" />{Number.isFinite(rating) && rating > 0 ? <>{rating.toFixed(1)}{totalReviews > 0 && <small> ({totalReviews} reviews)</small>}</> : "No ratings yet"}</span><Button to={path || undefined} disabled={!path} variant="secondary" size="small" aria-label={(path ? "View " : "Website not listed for ") + hospital.name}>{path ? "View hospital" : "Website not listed"}<ArrowUpRight size={16} aria-hidden="true" /></Button></div></Card>;
}
export function DraftBrief({ brief }) {
  const text = value => typeof value === "string" ? value.trim() : "", summary = text(brief?.agentSummary), concern = text(brief?.chiefComplaint), suggestion = text(brief?.predictedDisease), urgency = text(brief?.urgencyLevel);
  return <div className="mp-stack"><StatusBadge tone="warning">Draft — clinician review needed</StatusBadge><p>{summary || "No summary text was returned."}</p>{concern && <div><h3>Recorded concern</h3><p>{concern}</p></div>}{suggestion && suggestion !== "Unknown" && <div className="mp-patient-note"><h3>Model suggestion</h3><p>{suggestion}</p><p className="mp-field-hint">This is an unconfirmed model output, not a diagnosis.</p></div>}{urgency && <p><strong>Model urgency flag: </strong>{urgency}</p>}</div>;
}
export function PrivateNote() { return <p className="mp-patient-private"><ShieldCheck size={17} aria-hidden="true" />Private to your signed-in patient account</p>; }
