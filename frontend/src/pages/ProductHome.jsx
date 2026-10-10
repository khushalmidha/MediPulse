import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Baby, Brain, Building2, CalendarDays, Check, ClipboardList, Heart, HeartHandshake, MessageCircle, Search, Sparkles, Stethoscope, Users } from "lucide-react";
import { Button, EmptyState } from "../components/ui";
import CarePreview from "../components/marketing/CarePreview";
import "../components/marketing/marketing.css";

const specialties = [
  { name: "General medicine", query: "General", Icon: Stethoscope },
  { name: "Skin & hair", query: "Dermatology", Icon: Sparkles },
  { name: "Child health", query: "Pediatrics", Icon: Baby },
  { name: "Heart health", query: "Cardiology", Icon: Heart },
  { name: "Mental wellbeing", query: "Psychiatry", Icon: Brain },
];

export function CompanyHome() {
  return <main className="mp-marketing mp-company-home">
    <section className="mp-marketing-hero mp-marketing-container" aria-labelledby="company-title">
      <div className="mp-marketing-copy"><p className="mp-marketing-kicker"><span />Connected care, from the first hello</p>
        <h1 id="company-title">Better care.<br /><span>A clearer journey.</span></h1>
        <p className="mp-marketing-intro">A closer connection with your doctor. A smoother day at the hospital. Meet the two sides of MediPulse.</p>
        <div className="mp-actions"><Button href="/connect">Explore Connect <ArrowRight size={18} /></Button><Button href="/hospital" variant="secondary">For hospitals <ArrowUpRight size={18} /></Button></div>
        <p className="mp-marketing-note">For patients. For independent doctors. For hospital teams.</p>
      </div><CarePreview />
    </section>
    <div className="mp-capability-strip"><div className="mp-marketing-container"><span><Stethoscope size={20} />Doctor discovery</span><span><CalendarDays size={20} />Appointment booking</span><span><ClipboardList size={20} />Hospital OPD</span><span><MessageCircle size={20} />Care communities</span></div></div>
    <section id="products" className="mp-marketing-section mp-marketing-container" aria-labelledby="products-title">
      <header className="mp-marketing-heading"><div><p className="mp-eyebrow">One brand. Two dedicated products.</p><h2 id="products-title">Care for people.<br />Clarity for teams.</h2></div><p>Choose the experience that brings your next step into focus.</p></header>
      <div className="mp-marketing-products">
        <article className="mp-marketing-product mp-marketing-product--connect"><span className="mp-marketing-product-brand"><HeartHandshake size={24} />MediPulse Connect</span><h3>Your doctor connection,<br />beyond a single visit.</h3><p>Discover independent doctors, explore their availability and stay connected through doctor-led communities.</p><ul><li><Check size={17} />Doctor profiles and online consultation booking</li><li><Check size={17} />Your appointments, in one place</li><li><Check size={17} />Communities for ongoing conversations</li></ul><Button href="/connect" variant="secondary">Discover Connect <ArrowUpRight size={18} /></Button><div className="mp-product-art" aria-hidden="true"><HeartHandshake size={92} strokeWidth={1} /></div></article>
        <article className="mp-marketing-product mp-marketing-product--hospital"><span className="mp-marketing-product-brand"><Building2 size={24} />MediPulse for Hospitals</span><h3>A more connected OPD.<br />From booking to consultation.</h3><p>Bring your hospital website, reservations, check-in and staff queues into one coordinated experience.</p><ul><li><Check size={17} />A branded patient website for your hospital</li><li><Check size={17} />Distinct reservations and arrival queues</li><li><Check size={17} />Workspaces for your hospital team</li></ul><Button href="/hospital" variant="secondary">Explore hospital software <ArrowUpRight size={18} /></Button><div className="mp-product-art" aria-hidden="true"><Building2 size={92} strokeWidth={1} /></div></article>
      </div>
    </section>
    <section className="mp-marketing-container mp-journey-section" aria-labelledby="journey-title"><div><p className="mp-eyebrow">Designed around the next step</p><h2 id="journey-title">A visit should feel<br />easier to follow.</h2><p>Keep the care context clear, whether you are consulting online or arriving at a hospital.</p></div><ol className="mp-journey-list">{[["Choose your care", "Find a doctor or the right hospital."], ["Review your visit", "See the available session, mode and fee."], ["Know what comes next", "Follow the reservation and check-in status."], ["Keep the connection", "Return to your visits and care community."]].map(([title, detail], index) => <li key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{detail}</p></div></li>)}</ol></section>
    <section className="mp-marketing-container mp-marketing-cta"><div><p className="mp-eyebrow">Start with the care you need</p><h2>Your next step starts here.</h2></div><div className="mp-actions"><Button href="/connect/doctors">Find a doctor <ArrowRight size={18} /></Button><Button href="/hospitals" variant="secondary">Find a hospital</Button></div></section>
  </main>;
}

export function ConnectHome() {
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  return <main className="mp-marketing mp-connect-home">
    <section className="mp-marketing-hero mp-marketing-container" aria-labelledby="connect-title"><div className="mp-marketing-copy"><p className="mp-marketing-kicker"><HeartHandshake size={18} />MediPulse Connect</p><h1 id="connect-title">Find your doctor.<br /><span>Stay connected.</span></h1><p className="mp-marketing-intro">Explore independent care, book an online consultation and find a community that keeps the conversation going.</p>
      <form className="mp-care-search" onSubmit={event => { event.preventDefault(); navigate("/doctors" + (search.trim() ? "?specialty=" + encodeURIComponent(search.trim()) : "")); }}><label htmlFor="connect-doctor-search">Search by doctor, specialty or clinic</label><div><Search size={20} aria-hidden="true" /><input id="connect-doctor-search" type="search" maxLength={120} placeholder="Who would you like to see?" value={search} onChange={event => setSearch(event.target.value)} /><Button type="submit">Search doctors <ArrowRight size={16} /></Button></div></form><div className="mp-actions"><Button to="/doctors" variant="ghost">Find independent doctors <ArrowRight size={16} /></Button><Button to="/my-appointments" variant="ghost">My appointments</Button></div>
    </div><CarePreview mode="connect" /></section>
    <section className="mp-marketing-container mp-specialties" aria-labelledby="specialties-title"><div className="mp-marketing-heading"><div><p className="mp-eyebrow">Find your starting point</p><h2 id="specialties-title">Browse by specialty</h2></div><p>Explore profiles. Availability is shown when a doctor offers a session.</p></div><div className="mp-specialty-grid">{specialties.map(({ name, query, Icon }) => <Link to={"/doctors?specialty=" + encodeURIComponent(query)} key={name}><span><Icon size={28} strokeWidth={1.6} /></span><strong>{name}</strong><ArrowUpRight size={17} /></Link>)}</div></section>
    <section className="mp-marketing-container mp-connect-community" aria-labelledby="community-title"><div className="mp-community-art" aria-hidden="true"><div><MessageCircle size={48} strokeWidth={1.4} /></div><span><Users size={26} /></span><span><Heart size={25} /></span></div><div><p className="mp-eyebrow">Keep the conversation going</p><h2 id="community-title">Care connects us.<br />Communities bring us closer.</h2><p>Discover doctor-led groups and shared conversations between visits. Community discussions support connection; personal treatment decisions belong in a consultation.</p><Button to="/communities" variant="secondary">Explore communities <ArrowRight size={18} /></Button></div></section>
    <section className="mp-marketing-container mp-doctor-invitation"><Stethoscope size={32} /><div><p className="mp-eyebrow">For independent doctors</p><h2>Your practice. Your patient connection.</h2><p>Create a profile and connect with patients through your own care context.</p></div><Button to="/signup/doctor" variant="secondary">Join as a doctor <ArrowUpRight size={18} /></Button></section>
  </main>;
}

export function StaffHome() {
  return <main className="mp-marketing mp-hospital-home"><section className="mp-marketing-hero mp-marketing-container" aria-labelledby="hospital-product-title"><div className="mp-marketing-copy"><p className="mp-marketing-kicker"><Building2 size={18} />MediPulse for Hospitals</p><h1 id="hospital-product-title">A calmer OPD.<br /><span>A connected hospital.</span></h1><p className="mp-marketing-intro">Give patients a clear way to book. Give your team a shared way to move the day forward, from reception to consultation.</p><div className="mp-actions"><Button to="/hospital/signup">Register a hospital <ArrowRight size={18} /></Button><Button to="/hospital/login" variant="secondary">Staff sign in</Button></div><p className="mp-marketing-note">Have a staff account? Sign in to your hospital workspace.</p></div><CarePreview mode="hospital" /></section>
    <div className="mp-capability-strip"><div className="mp-marketing-container"><span><Building2 size={20} />Branded patient website</span><span><CalendarDays size={20} />Reservations & check-in</span><span><ClipboardList size={20} />Doctor & nurse queues</span><span><Users size={20} />Role-based workspaces</span></div></div>
    <section className="mp-marketing-section mp-marketing-container" aria-labelledby="hospital-features-title"><header className="mp-marketing-heading"><div><p className="mp-eyebrow">Built around the OPD day</p><h2 id="hospital-features-title">One journey.<br />A coordinated team.</h2></div><p>Start with outpatient operations and a patient experience your hospital can make its own.</p></header><div className="mp-hospital-feature-grid">{[[Building2, "Your hospital, online", "A branded website where patients can discover your hospital and start a booking."], [CalendarDays, "Bookings with clear context", "Keep scheduled reservations distinct from patients who have arrived at reception."], [ClipboardList, "A shared clinical queue", "Help nurses record vitals and doctors manage the consultation queue."], [Users, "The right workspace for each role", "Hospital accounts and authorized staff access stay tied to your organization."]].map(([Icon, title, description]) => <article key={title}><span><Icon size={25} /></span><h3>{title}</h3><p>{description}</p></article>)}</div></section>
    <section className="mp-marketing-container mp-hospital-roadmap" aria-labelledby="hospital-roadmap-title"><div><p className="mp-eyebrow">Growing from an OPD foundation</p><h2 id="hospital-roadmap-title">A focused start.<br />Room to grow.</h2><p>Hospital OPD is the current core. The broader hospital journey will expand in dedicated phases.</p></div><ul><li><span>Current core</span><strong>Patient website, booking & OPD workspaces</strong></li><li><span>Planned</span><strong>Room guidance, file handoffs & richer live estimates</strong></li><li><span>Planned</span><strong>Laboratory, pharmacy & inpatient operations</strong></li></ul></section>
    <section className="mp-marketing-container mp-marketing-cta"><div><p className="mp-eyebrow">Bring your team together</p><h2>Build a clearer OPD experience.</h2></div><Button to="/hospital/signup">Get started <ArrowRight size={18} /></Button></section></main>;
}

export function RouteNotFound() { return <main className="mp-page"><EmptyState title="Page not found" action={<Button to="/">Return to this website</Button>}>This page is not available in this care workspace.</EmptyState></main>; }
