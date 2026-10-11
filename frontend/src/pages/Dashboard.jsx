/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { Navigate } from "react-router-dom";
import { ArrowUpRight, CalendarDays, FileHeart, Stethoscope } from "lucide-react";
import RecommendationCard from "../components/RecommendationCard";
import RecommendationDoctors from "../components/RecommendationDoctors";
import { Banner, Button, Card, EmptyState, LoadingState, StatusBadge } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { BACKEND_URL } from "../utils";
import { visitTime } from "../utils/appointments";
import "../components/dashboard.css";

function DashboardContent({ role, firstName }) {
  const [events, setEvents] = useState({ loading: true, items: [], error: "" }), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setEvents({ loading: true, items: [], error: "" });
    Promise.all([
      axios.get(`${BACKEND_URL}/community/user`, { withCredentials: true, signal: controller.signal }),
      axios.get(`${BACKEND_URL}/event`, { withCredentials: true, signal: controller.signal, params: { status: "upcoming" } }),
    ]).then(([memberships, response]) => {
      if (controller.signal.aborted) return;
      const communities = Array.isArray(memberships.data) ? memberships.data : memberships.data?.items || [];
      const names = new Map(communities.map(item => [String(item._id), item.title]));
      const rows = Array.isArray(response.data?.events) ? response.data.events : [];
      setEvents({ loading: false, error: "", items: rows.filter(item => names.has(String(item.community?._id || item.community))).slice(0, 4).map(item => ({ ...item, communityName: names.get(String(item.community?._id || item.community)) })) });
    }).catch(() => { if (!controller.signal.aborted) setEvents({ loading: false, items: [], error: "Your community events could not be loaded." }); });
    return () => controller.abort();
  }, [attempt]);
  return <main className="mp-page mp-page--patient mp-dashboard">
    <header className="mp-dashboard-welcome"><div><p className="mp-eyebrow">Your care, connected</p><h1>{firstName ? `Welcome back, ${firstName}` : "Your health dashboard"}</h1><p>Keep track of visits, find care and stay close to your communities.</p></div><Button to={role === "doctor" ? "/doctor/appointments" : "/my-appointments"}><CalendarDays size={18} aria-hidden="true" />{role === "doctor" ? "Open doctor queue" : "My appointments"}</Button></header>
    <div className="mp-dashboard-shortcuts"><Card><FileHeart size={24} aria-hidden="true" /><h2>Your health records</h2><p>Review visits, clinician notes and linked family profiles.</p><Button to="/health-records" variant="ghost">Open health records<ArrowUpRight size={16} aria-hidden="true" /></Button></Card><Card><Stethoscope size={24} aria-hidden="true" /><h2>Find your next clinician</h2><p>Compare recorded specialties and check actual availability.</p><Button to="/doctors" variant="ghost">Explore doctors<ArrowUpRight size={16} aria-hidden="true" /></Button></Card></div>
    <RecommendationCard />
    <section aria-labelledby="dashboard-doctors"><div className="mp-section-heading"><div><p className="mp-eyebrow">Explore care</p><h2 id="dashboard-doctors">Meet healthcare providers</h2><p>Browse profiles. A listed doctor does not confirm an available appointment.</p></div><Button to="/doctors" variant="secondary">All doctors</Button></div><RecommendationDoctors /></section>
    <Card><div className="mp-card-heading"><h2>Events from your communities</h2><Button to="/events" variant="ghost">All events</Button></div>{events.loading ? <LoadingState>Loading community events...</LoadingState> : events.error ? <Banner action={<Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>Retry events</Button>}>{events.error}</Banner> : !events.items.length ? <EmptyState title="No upcoming community events" /> : <div className="mp-dashboard-community-grid">{events.items.map(event => <div key={event._id} className="mp-visit-note"><StatusBadge>{event.kind || "Event"}</StatusBadge><h3>{event.title}</h3><p>{event.communityName}</p><p className="mp-field-hint">{visitTime(event.time)}</p><p>{event.bio}</p></div>)}</div>}</Card>
  </main>;
}
export default function Dashboard() {
  const { isAuth, loader, role, user } = useAuth();
  if (loader) return <main className="mp-page"><LoadingState>Checking your account...</LoadingState></main>;
  if (!isAuth || !user?._id) return <Navigate to="/login?returnTo=%2Fdashboard" replace />;
  return <DashboardContent key={`${role}:${user._id}`} role={role} firstName={user.firstName} />;
}
