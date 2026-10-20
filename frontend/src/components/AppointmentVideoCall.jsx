/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { Mic, MicOff, Video, VideoOff, PhoneOff, MessageSquare, User, Stethoscope, BrainCircuit, Info, X, Send, Maximize, Minimize, Expand, Shrink, Volume2, ShieldCheck, RefreshCw } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { BACKEND_URL } from "../utils";
import { formatDoctorName } from "../utils/appointments";
import useConsultationMedia from "../hooks/useConsultationMedia";
import "./appointments/consultation.css";

export default function AppointmentVideoCall(props) {
  const { role, user } = useAuth();
  return <ConsultationRoom key={`${props.appointmentId}:${role}:${user?._id || "guest"}`} {...props} role={role} />;
}
function ConsultationRoom({ appointmentId, role, doctorName, patientName, onCallEnd, onRequestEnd }) {
  const media = useConsultationMedia(appointmentId, role, onCallEnd);
  const root = useRef(null), returnFocus = useRef(null), assistantAbort = useRef(null);
  const [expanded, setExpanded] = useState(false), [fullscreen, setFullscreen] = useState(false), [viewNotice, setViewNotice] = useState("");
  const [panel, setPanel] = useState(null), [chat, setChat] = useState(""), [prompt, setPrompt] = useState(""), [suggestion, setSuggestion] = useState(""), [assistantError, setAssistantError] = useState(""), [assistantBusy, setAssistantBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const doctor = role === "doctor", visit = media.visit;
  const remoteName = doctor ? patientName || [visit?.user?.firstName, visit?.user?.lastName].filter(Boolean).join(" ") || "Patient" : formatDoctorName(doctorName || visit?.doctor);
  const labels = { preparing: "Preparing devices", waiting: doctor ? "Waiting for patient..." : "Waiting for doctor...", connecting: "Connecting...", connected: "Connected", reconnecting: "Reconnecting...", failed: "Connection failed", ended: "Call ended" };
  const started = Date.parse(visit?.startedAt), elapsed = Number.isFinite(started) ? Math.max(0, Math.floor((clock - started) / 1000)) : null;
  const duration = elapsed === null ? "Not started" : `${elapsed >= 3600 ? Math.floor(elapsed / 3600).toString().padStart(2, "0") + ":" : ""}${Math.floor(elapsed / 60 % 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { const host = root.current; const changed = () => setFullscreen(document.fullscreenElement === host); document.addEventListener("fullscreenchange", changed); return () => { document.removeEventListener("fullscreenchange", changed); if (document.fullscreenElement === host) document.exitFullscreen?.().catch(() => {}); }; }, [expanded]);
  useEffect(() => {
    if (!expanded && !fullscreen) return;
    const host = root.current;
    const oldOverflow = document.body.style.overflow;
    if (expanded) document.body.style.overflow = "hidden";
    host?.querySelector("button")?.focus();
    const keyboard = event => {
      if (event.key === "Escape" && expanded) { event.preventDefault(); setExpanded(false); }
      if (event.key !== "Tab") return;
      const controls = [...host.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]')].filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => { if (expanded) document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", keyboard); if (returnFocus.current?.isConnected) returnFocus.current.focus(); else document.getElementById(`consultation-${appointmentId}`)?.querySelector('button[aria-label="Expand call"]')?.focus(); };
  }, [expanded, fullscreen, appointmentId]);
  useEffect(() => () => assistantAbort.current?.abort(), []);
  useEffect(() => { if (panel === "chat") root.current?.querySelector(".mp-call-messages")?.scrollTo({ top: 100000 }); }, [panel, media.messages]);
  const exitView = async () => { if (document.fullscreenElement === root.current) await document.exitFullscreen().catch(() => {}); setExpanded(false); };
  const toggleFullscreen = async event => {
    returnFocus.current = event.currentTarget;
    if (fullscreen) { await exitView(); return; }
    if (root.current?.requestFullscreen && document.fullscreenEnabled) {
      try { await root.current.requestFullscreen(); setViewNotice(""); return; } catch { setViewNotice("Browser fullscreen is unavailable. Expanded view is open instead."); }
    } else setViewNotice("Expanded view is open. This browser does not support fullscreen here.");
    setExpanded(true);
  };
  const leave = async () => { await exitView(); media.stop(); };
  const complete = async () => { await exitView(); onRequestEnd?.(); };
  const send = event => { event.preventDefault(); if (media.sendMessage(chat)) setChat(""); };
  const ask = async event => {
    event.preventDefault(); if (assistantBusy || !prompt.trim()) return;
    const abort = new AbortController(); assistantAbort.current?.abort(); assistantAbort.current = abort; setAssistantBusy(true); setAssistantError("");
    try { const { data } = await axios.post(`${BACKEND_URL}/appointment/${appointmentId}/copilot`, { prompt: prompt.trim() }, { withCredentials: true, signal: abort.signal, timeout: 30000 }); if (!abort.signal.aborted) setSuggestion(data.suggestion || "No draft was returned."); }
    catch (error) { if (!abort.signal.aborted) setAssistantError(error.response?.data?.message || "The assistant is unavailable. Your call can continue."); }
    finally { if (!abort.signal.aborted) setAssistantBusy(false); }
  };
  const togglePanel = value => setPanel(current => current === value ? null : value);
  const control = (label, Icon, action, pressed, disabled = false, extra = "") => <button type="button" className={`mp-call-control ${pressed ? "is-selected" : ""} ${extra}`} aria-label={label} title={label} aria-pressed={typeof pressed === "boolean" ? pressed : undefined} onClick={action} disabled={disabled}><Icon size={20} aria-hidden="true" /><span>{label}</span></button>;
  const room = <section id={`consultation-${appointmentId}`} ref={root} className={`mp-call ${expanded ? "mp-call--expanded" : ""} ${panel ? "mp-call--panel" : ""}`} aria-label="Online consultation" role={expanded ? "dialog" : undefined} aria-modal={expanded ? "true" : undefined}>
    <header className="mp-call-header"><div><span className="mp-call-eyebrow"><ShieldCheck size={14} />MediPulse consultation</span><h3>{remoteName}</h3></div><div className="mp-call-header-actions"><span className={`mp-call-status mp-call-status--${media.status}`} role="status">{labels[media.status]}</span><span className="mp-call-timer" aria-label="Visit duration">{duration}</span>{control(expanded ? "Minimize call" : "Expand call", expanded ? Shrink : Expand, event => { returnFocus.current = event.currentTarget; setExpanded(value => !value); }, expanded)}{control(fullscreen ? "Exit fullscreen" : "Enter fullscreen", fullscreen ? Minimize : Maximize, toggleFullscreen, fullscreen)}</div></header>
    <div className="mp-call-body"><div className="mp-call-stage">
      <video ref={media.attachRemoteVideo} onPlaying={media.clearPlaybackNotice} autoPlay playsInline className={`mp-call-remote ${media.remoteMedia?.cameraOff ? "is-camera-off" : ""}`} aria-label={`${remoteName} video`} />
      {(media.status !== "connected" || media.remoteMedia?.cameraOff) && <div className="mp-call-placeholder"><span className="mp-call-avatar">{doctor ? <User size={44} /> : <Stethoscope size={44} />}</span><h4>{remoteName}</h4><p>{media.status === "connected" ? "Camera is off · Audio call" : labels[media.status]}</p></div>}
      <div className="mp-call-name">{remoteName}{media.remoteMedia?.muted && <MicOff size={16} aria-label="Participant microphone muted" />}</div>
      <div className="mp-call-self"><video ref={media.attachLocalVideo} autoPlay muted playsInline aria-label="Your camera preview" className={media.cameraOff ? "is-camera-off" : ""} />{media.cameraOff && <div className="mp-call-self-off"><VideoOff size={26} /></div>}<span>You{media.muted && <MicOff size={14} />}</span></div>
    </div>{panel && <aside className="mp-call-panel" aria-label={panel === "chat" ? "Call chat" : panel === "assistant" ? "Clinician assistant" : "Visit information"}><header><h4>{panel === "chat" ? "In-call messages" : panel === "assistant" ? "Clinician assistant" : "Visit information"}</h4><button type="button" aria-label="Close side panel" onClick={() => setPanel(null)}><X size={20} /></button></header>
      {panel === "chat" && <><p className="mp-call-panel-note">Messages stay in this open call view. They are not saved as a medical record.</p><div className="mp-call-messages" role="log" aria-label="Call messages">{!media.messages.length && <p>No messages yet.</p>}{media.messages.map((message, index) => <article className={message.own ? "is-own" : ""} key={index}><strong>{message.own ? "You" : remoteName}</strong><p>{message.text}</p></article>)}</div><form onSubmit={send} className="mp-call-chat-form"><label htmlFor={`call-chat-${appointmentId}`}>Message</label><div><input id={`call-chat-${appointmentId}`} value={chat} onChange={event => setChat(event.target.value)} maxLength={1000} placeholder="Type a message..." disabled={!media.ready} /><button type="submit" aria-label="Send message" disabled={!chat.trim() || !media.ready}><Send size={18} /></button></div>{media.chatNotice && <p role="status">{media.chatNotice}</p>}</form></>}
      {panel === "info" && <div className="mp-call-panel-content"><p><strong>Care mode</strong><br />Online consultation</p><p><strong>Visit status</strong><br />{visit?.status || "Checking visit"}</p><p><strong>Participant</strong><br />{remoteName}</p><p>Leaving this call does not complete the consultation. The clinician completes the visit after reviewing care and notes.</p><p>Camera and microphone are used for the live call. Automatic speech capture is off.</p><button type="button" className="mp-call-reconnect" onClick={media.retry}>Reconnect call</button>{media.relayNotice && <p role="status">{media.relayNotice}</p>}</div>}
      {panel === "assistant" && doctor && <form onSubmit={ask} className="mp-call-panel-content mp-call-assistant"><p>Optional draft assistance. Review every response before clinical use. Your call continues if the assistant is unavailable.</p><label htmlFor={`call-prompt-${appointmentId}`}>Assistant prompt</label><textarea id={`call-prompt-${appointmentId}`} rows={5} maxLength={2000} value={prompt} onChange={event => setPrompt(event.target.value)} disabled={assistantBusy} /><button type="submit" disabled={assistantBusy || !prompt.trim()}>{assistantBusy ? "Preparing draft..." : "Ask Co-Pilot"}</button>{assistantError && <p role="alert">{assistantError}</p>}{suggestion && <section><strong>Draft — clinician review needed</strong><p>{suggestion}</p></section>}</form>}
    </aside>}</div>
    <div className="mp-call-feedback">{media.error && <p role="alert">{media.error}</p>}{media.notice && <p role="status">{media.notice}</p>}{viewNotice && <p role="status">{viewNotice}</p>}{(media.error || media.status === "failed") && <button type="button" onClick={media.retry}><RefreshCw size={16} />Retry call</button>}{media.notice.includes("Play audio") && <button type="button" onClick={media.resumeAudio}><Volume2 size={16} />Play audio</button>}</div>
    <footer className="mp-call-toolbar"><div className="mp-call-primary-controls">{control(media.muted ? "Unmute" : "Mute", media.muted ? MicOff : Mic, media.toggleMic, media.muted, !media.ready)}{control(media.cameraOff ? "Turn on camera" : "Turn off camera", media.cameraOff ? VideoOff : Video, media.toggleCamera, media.cameraOff, !media.ready || media.deviceBusy)}{control("Leave call", PhoneOff, leave, undefined, false, "mp-call-leave")}{doctor && onRequestEnd && <button type="button" className="mp-call-end" onClick={complete}>End consultation</button>}</div><div className="mp-call-secondary-controls">{control("Toggle Chat", MessageSquare, () => togglePanel("chat"), panel === "chat")}{control("Visit information", Info, () => togglePanel("info"), panel === "info")}{doctor && control("Toggle AI Co-Pilot", BrainCircuit, () => togglePanel("assistant"), panel === "assistant")}</div></footer>
  </section>;
  return expanded ? createPortal(room, document.body) : room;
}
