/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Home, Send } from "lucide-react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { BACKEND_URL } from "../utils";
import { formatDoctorName } from "../utils/appointments";
import { Button } from "./ui";
import "./dashboard.css";

const welcome = { role: "assistant", content: "Find care and communities on MediPulse. Search by name, specialty or city.", menu: true };
const rows = data => Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
const modes = { hospital: "Hospitals", doctor: "Doctors", community: "Communities", general: "General AI information" };
const search = (items, query, fields) => {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(item => terms.every(term => fields(item).join(" ").toLocaleLowerCase().includes(term))).slice(0, 6);
};

function Assistant({ isAuth }) {
  const [open, setOpen] = useState(false), [messages, setMessages] = useState([welcome]), [mode, setMode] = useState("hospital");
  const [input, setInput] = useState(""), [busy, setBusy] = useState(false);
  const [directories, setDirectories] = useState({});
  const trigger = useRef(null), field = useRef(null), end = useRef(null), inFlight = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    field.current?.focus();
    const controller = new AbortController();
    const paths = { hospital: "/api/hospitals", doctor: "/doctor", community: "/community" };
    Object.entries(paths).forEach(([key, path]) => {
      axios.get(BACKEND_URL + path, { withCredentials: true, signal: controller.signal }).then(({ data }) => {
        if (!controller.signal.aborted) setDirectories(current => ({ ...current, [key]: { items: rows(data) } }));
      }).catch(() => {
        if (!controller.signal.aborted) setDirectories(current => ({ ...current, [key]: { error: true } }));
      });
    });
    return () => controller.abort();
  }, [open]);
  useEffect(() => () => inFlight.current?.abort(), []);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages, busy]);
  const close = () => {
    inFlight.current?.abort(); inFlight.current = null; setBusy(false); setOpen(false);
    trigger.current?.focus();
  };
  const menu = () => {
    inFlight.current?.abort(); inFlight.current = null; setBusy(false); setInput(""); setMessages([welcome]); setMode("hospital"); field.current?.focus();
  };
  const choose = value => {
    inFlight.current?.abort(); inFlight.current = null; setBusy(false); setMode(value); setInput("");
    setMessages(current => [...current, { role: "assistant", content: value === "general" ? "AI replies are unreviewed general information. Do not enter identifying or private medical details. For care, contact a clinician." : `Search ${modes[value].toLowerCase()} by name${value === "doctor" ? " or recorded specialty" : value === "hospital" ? " or city" : " or category"}. These are directory matches, not medical recommendations.` }]);
    field.current?.focus();
  };
  const submit = async event => {
    event.preventDefault();
    const query = input.trim();
    if (!query || inFlight.current || busy) return;
    if (mode !== "general") {
      const directory = directories[mode];
      if (!directory || directory.error) {
        setMessages(current => [...current, { role: "assistant", content: directory?.error ? "This directory is unavailable. Use its main search page or reopen the assistant to retry." : "This directory is still loading. Please try again shortly." }]);
        return;
      }
      const fields = item => mode === "doctor" ? [formatDoctorName(item), item.experience?.expertise || "", item.doctorProfile?.specialization || ""] : mode === "hospital" ? [item.name || "", item.address?.city || "", item.medicineSystem || ""] : [item.title || "", item.category || ""];
      const found = search(directory.items, query, fields);
      setMessages(current => [...current, { role: "user", content: query }, { role: "assistant", content: found.length ? "Matches in the loaded directory. Open a profile to check details and availability." : "No matches in this directory preview. Try the full directory for more results.", cards: found, cardMode: mode }]);
      setInput("");
      return;
    }
    if (!isAuth) {
      setMessages(current => [...current, { role: "assistant", content: "Sign in to request general AI information. Directory browsing is available without an account." }]);
      return;
    }
    const controller = new AbortController();
    inFlight.current = controller; setBusy(true);
    try {
      const { data } = await axios.post(BACKEND_URL + "/gemini/chat", { prompt: query, type: "general" }, { withCredentials: true, signal: controller.signal, timeout: 10000 });
      if (inFlight.current !== controller) return;
      setMessages(current => [...current, { role: "user", content: query }, { role: "assistant", content: data.text || "No answer was returned.", draft: true }]); setInput("");
    } catch {
      if (inFlight.current === controller) setMessages(current => [...current, { role: "assistant", content: "AI information is unavailable. Your message is kept so you can retry." }]);
    } finally { if (inFlight.current === controller) { inFlight.current = null; setBusy(false); } }
  };
  return <div className="mp-assistant">
    <button ref={trigger} className="mp-assistant-trigger" aria-label="Open MediPulse assistant" aria-expanded={open} aria-controls="medipulse-assistant" onClick={() => setOpen(value => !value)}><MessageCircle aria-hidden="true" size={23} /></button>
    {open && <section id="medipulse-assistant" role="dialog" aria-modal="false" aria-labelledby="assistant-title" className="mp-assistant-panel" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <header className="mp-assistant-header"><div><h2 id="assistant-title">MediPulse Assistant</h2><p>Care directory & general information</p></div><div><Button variant="ghost" aria-label="Assistant main menu" onClick={menu}><Home size={18} aria-hidden="true" /></Button><Button variant="ghost" aria-label="Close assistant" onClick={close}><X size={18} aria-hidden="true" /></Button></div></header>
      <div className="mp-assistant-messages" role="log" aria-live="polite" aria-relevant="additions">{messages.map((message, index) => <div key={index} className={"mp-assistant-message mp-assistant-message--" + message.role}>
        {message.draft && <small>AI draft · unreviewed</small>}<p>{message.content}</p>
        {message.menu && <div className="mp-assistant-options">{Object.entries(modes).map(([value, label]) => <Button key={value} variant="secondary" onClick={() => choose(value)}>{label}</Button>)}</div>}
        {message.cards?.map(card => <div key={card._id} className="mp-assistant-card"><strong>{message.cardMode === "doctor" ? formatDoctorName(card) : card.name || card.title}</strong><Button variant="ghost" to={message.cardMode === "hospital" ? `/hospitals/${card.slug}` : message.cardMode === "community" ? `/communities#${card._id}` : card.sourceType === "hospital" && card.hospitalContext?.hospitalSlug ? `/hospitals/${card.hospitalContext.hospitalSlug}` : `/doctorsProfile/${card._id}`} onClick={close}>Open {message.cardMode}</Button></div>)}
      </div>)}{busy && <p role="status">Requesting general information...</p>}<div ref={end} /></div>
      <form onSubmit={submit} className="mp-assistant-form"><label htmlFor="assistant-query">{modes[mode]} search</label><div><input id="assistant-query" ref={field} className="mp-input" value={input} maxLength={2000} disabled={busy} onChange={event => setInput(event.target.value)} placeholder={mode === "general" ? "Ask a general question" : "Search by name or specialty"} /><Button type="submit" disabled={busy || !input.trim()} aria-label="Send assistant message"><Send size={18} aria-hidden="true" /></Button></div><small>For emergencies, contact local emergency care.</small></form>
    </section>}
  </div>;
}
export default function AiBot() {
  const { user, staffUser, isAuth, role } = useAuth();
  return <Assistant key={isAuth ? `${role}:${user?._id}` : staffUser ? `staff:${staffUser._id}` : "visitor"} isAuth={isAuth} />;
}
