/* eslint-disable react/prop-types */
import { CalendarDays, Check, ClipboardList, Heart, MessageCircle, Stethoscope, Video } from "lucide-react";

// Static product illustration. Never presented as a live queue or real availability.
export default function CarePreview({ mode = "company" }) {
  const online = mode === "connect";
  return <figure className={"mp-care-preview mp-care-preview--" + mode} aria-label={online ? "Illustration of the online care journey" : "Illustration of the hospital OPD journey"}>
    <div className="mp-preview-orbit" aria-hidden="true" />
    <div className="mp-preview-window"><div className="mp-preview-bar"><span className="mp-preview-brand"><Heart size={16} />{online ? "MediPulse Connect" : "MediPulse Hospital"}</span><span className="mp-preview-label">Illustrative view</span></div>
      <div className="mp-preview-body"><aside className="mp-preview-sidebar" aria-hidden="true"><span><Heart size={21} /></span><CalendarDays size={19} /><ClipboardList size={19} /><Stethoscope size={19} /><MessageCircle size={19} /></aside><div className="mp-preview-content"><div className="mp-preview-heading"><span>{online ? "Your care, connected" : "The outpatient journey"}</span><strong>{online ? "Make space for better care." : "Every step, in focus."}</strong></div>
        <div className="mp-preview-visit"><span className="mp-preview-icon">{online ? <Video size={25} /> : <Stethoscope size={25} />}</span><div><strong>{online ? "Online consultation" : "Hospital visit"}</strong><p>{online ? "Your doctor. Your care context." : "From reservation to consultation."}</p></div></div>
        <ol className="mp-preview-stages">{(online ? [[CalendarDays, "Choose a session", "Review the doctor's availability"], [Video, "Join your consultation", "Follow the appointment status"], [MessageCircle, "Stay connected", "Return to your care community"]] : [[CalendarDays, "Reservation", "Choose the right care session"], [Check, "Reception & vitals", "Confirm arrival, then prepare for care"], [Stethoscope, "Consultation", "Follow the clinical queue"]]).map(([Icon, title, description], index) => <li key={title}><span className={index === 1 ? "mp-preview-stage-active" : ""}><Icon size={15} /></span><div><strong>{title}</strong><p>{description}</p></div>{index === 1 && <span className="mp-preview-stage-tag">Next step</span>}</li>)}</ol>
      </div></div></div>
    <div className="mp-preview-floating"><span><Heart size={20} /></span><div><strong>{online ? "More than an appointment" : "Care moves together"}</strong><p>{online ? "A connection that continues." : "A shared view of the next step."}</p></div></div>
    <figcaption>Product illustration · no patient data or live availability</figcaption>
  </figure>;
}
