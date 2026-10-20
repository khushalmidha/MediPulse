/* eslint-disable react/prop-types */
import { Fragment, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { Activity, Clock3, RefreshCcw, Stethoscope, UsersRound } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { BACKEND_URL } from "../../utils";
import { Banner, Button, Card, Dialog, EmptyState, Field, LoadingState, StatusBadge } from "../ui";
import { Feedback } from "../account/AccountUI";
import { DraftBrief } from "../patient/PatientUI";
import CallPanel from "../appointments/CallPanel";
import useFormTask from "../../hooks/useFormTask";
import { clinicalPatientName, notesOf, textValue } from "../../utils/clinicalWorkspace";
import "./clinical.css";

export function ClinicalAccess({ hospital = false, children }) {
  const auth = useAuth(), location = useLocation();
  if (auth.loader) return <main className="mp-page"><LoadingState>Checking clinician access...</LoadingState></main>;
  const allowed = hospital ? auth.isStaffAuth && auth.staffUser && auth.staffRole === "DOCTOR" : auth.isAuth && auth.user && auth.role === "doctor";
  if (!allowed) return <ClinicalPage title={hospital ? "Hospital doctor access is needed" : "Your doctor account is needed"} description="Sign in to the clinician workspace assigned to your care context."><Card><EmptyState title="Continue with clinician sign in" action={<Button to={(hospital ? "/hospital/login" : "/login") + "?returnTo=" + encodeURIComponent(location.pathname + location.search)}>Clinician sign in</Button>}>Patient accounts and other staff roles use their own workspaces.</EmptyState></Card></ClinicalPage>;
  const actor = hospital ? `${auth.staffUser.hospitalId}:${auth.staffUser._id || auth.staffUser.id}:${auth.staffRole}` : `${auth.role}:${auth.user._id}`;
  return <Fragment key={actor}>{children}</Fragment>;
}
export function ClinicalPage({ title, eyebrow = "Clinician workspace", description, actions, children }) {
  return <main className="mp-page mp-clinical-page"><header className="mp-clinical-header"><div><p className="mp-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions && <div className="mp-actions">{actions}</div>}</header>{children}</main>;
}
export function QueueHealth({ resource, online }) {
  return <div className="mp-stack">{!online && <Banner>You are offline. Loaded queue information may be out of date; reconnect before taking action.</Banner>}{resource.error && <Banner action={<Button variant="secondary" onClick={resource.refresh}>Retry queue</Button>}>{resource.error}{resource.data && " Previously loaded records are shown; actions are paused until a successful refresh."}</Banner>}<p className="mp-field-hint">{resource.refreshedAt ? `Last successful refresh ${resource.refreshedAt.toLocaleTimeString()}` : "No successful refresh yet"}{resource.refreshing && resource.data ? " · Refreshing..." : ""}</p></div>;
}
export function QueueStats({ waiting, active, reservations, completed }) {
  return <div className="mp-clinical-stats">{[["Ready queue", waiting, UsersRound], ["Current consultation", active ? "In progress" : "None", Activity], ["Awaiting arrival", reservations, Clock3], ...(completed === undefined ? [] : [["Completed", completed, Stethoscope]])].map(([label, value, Icon]) => <Card key={label}><Icon size={19} aria-hidden="true" /><div><p>{label}</p><strong>{value}</strong></div></Card>)}</div>;
}
export function QueueRefresh({ resource }) { return <Button variant="secondary" onClick={resource.refresh} disabled={resource.loading || resource.refreshing}><RefreshCcw size={16} aria-hidden="true" />Refresh queue</Button>; }
export function SwitchConfirmation({ pending, onClose, onConfirm }) {
  return <Dialog open={pending !== null} onClose={onClose} title="Switch care queue?"><p>Your unsaved consultation draft will be discarded. Save it or remain in this queue before switching.</p><div className="mp-actions"><Button variant="secondary" onClick={onClose} data-autofocus>Keep editing</Button><Button variant="danger" onClick={onConfirm}>Discard draft and switch</Button></div></Dialog>;
}
export function ActiveConsultation({ visit, hospital, disabled, refresh, onDirty, onBusy }) {
  const incoming = notesOf(visit, hospital), [notes, setNotes] = useState(incoming), [saved, setSaved] = useState(incoming), [conflict, setConflict] = useState(false);
  const baseline = useRef(incoming), current = useRef(notes), writeRevision = useRef(Number.isInteger(visit.revision) ? visit.revision : 0); current.current = notes;
  const [soap, setSoap] = useState(visit.soapNote || null), [reviewed, setReviewed] = useState(false);
  const soapSignature = useRef(JSON.stringify(visit.soapNote || null));
  useEffect(() => {
    const revision = Number.isInteger(visit.revision) ? visit.revision : 0;
    if (revision < writeRevision.current) return;
    writeRevision.current = revision;
    const signature = JSON.stringify(visit.soapNote || null);
    if (signature !== soapSignature.current) { soapSignature.current = signature; setSoap(visit.soapNote || null); setReviewed(false); }
  }, [visit.revision, visit.soapNote]);
  const [confirm, setConfirm] = useState(false), [aiPrompt, setAiPrompt] = useState("Suggest focused consultation questions and red flags"), [suggestion, setSuggestion] = useState(""), [contextBrief, setContextBrief] = useState(null);
  const task = useFormTask(), dirty = notes !== saved;
  useEffect(() => { if ((Number.isInteger(visit.revision) ? visit.revision : 0) < writeRevision.current) return; if (incoming !== baseline.current) { if (current.current === baseline.current) setNotes(incoming); else if (current.current !== incoming) setConflict(true); baseline.current = incoming; setSaved(incoming); } }, [incoming, visit.revision]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { onBusy(task.busy); return () => onBusy(false); }, [task.busy, onBusy]);
  useEffect(() => { if (task.feedback?.status === 409) refresh(); }, [task.feedback, refresh]);
  const denied = [401, 403, 404].includes(task.feedback?.status), blocked = disabled || task.busy || !task.online || conflict;
  const send = (method, suffix, body, signal) => axios({ method, url: BACKEND_URL + (hospital ? `/api/opd/tokens/${visit._id}/` : `/appointment/${visit._id}/`) + suffix, data: body, withCredentials: true, signal });
  const acceptedNotes = (response, invalidate = true) => {
    const value = textValue(response.data.doctorNotes);
    if (!Number.isInteger(response.data.revision)) throw new Error("Refresh the visit before continuing.");
    const changed = value !== baseline.current;
    writeRevision.current = response.data.revision; baseline.current = value; setSaved(value); setNotes(value); setReviewed(false);
    if (invalidate || changed) setSoap(previous => previous ? { ...previous, clinicianApproved: false, isDraft: true } : null);
  };
  const finish = () => task.run(async signal => {
    if (hospital) return send("patch", "complete", { notes, revision: visit.revision }, signal);
    if (dirty) acceptedNotes(await send("patch", "notes", { doctorNotes: notes, revision: writeRevision.current }, signal));
    return send("post", "end", { revision: writeRevision.current }, signal);
  }, () => { setConfirm(false); onDirty(false); refresh(); task.setFeedback({ tone: "info", message: "Consultation completion recorded. Refreshing current status..." }); });
  const saveNotes = () => task.run(async signal => { const result = await send("patch", "notes", { doctorNotes: notes, revision: writeRevision.current }, signal); acceptedNotes(result); return result; }, () => { task.setFeedback({ tone: "info", message: "Doctor notes saved." }); refresh(); });
  const generateReceipt = () => task.run(async signal => { const result = await send("post", "receipt", { doctorNotes: notes, revision: writeRevision.current }, signal); acceptedNotes(result, false); return result; }, () => { task.setFeedback({ tone: "info", message: "Consultation document generated. Review its draft text before using it." }); refresh(); });
  const generateSoap = () => task.run(async signal => {
    const result = await axios.post(`${BACKEND_URL}/copilot/${visit._id}/generate-soap`, { doctorNotes: notes, revision: writeRevision.current }, { withCredentials: true, signal });
    if (!Number.isInteger(result.data.revision)) throw new Error("Refresh the visit before continuing.");
    writeRevision.current = result.data.revision; baseline.current = notes; setSaved(notes); setSoap(result.data.soapNote); soapSignature.current = JSON.stringify(result.data.soapNote); setReviewed(false); return result;
  }, () => { refresh(); task.setFeedback({ tone: "info", message: "SOAP draft prepared. Review it before approval." }); });
  const approveSoap = () => task.run(signal => send("post", "soap-note/approve", { revision: writeRevision.current, noteVersion: soap.version }, signal), result => {
    writeRevision.current = result.data.revision; setSoap(result.data.soapNote); soapSignature.current = JSON.stringify(result.data.soapNote); setReviewed(false); refresh(); task.setFeedback({ tone: "info", message: "Clinician review recorded for this SOAP version." });
  });
  const ask = () => task.run(signal => axios.post(BACKEND_URL + (hospital ? `/api/opd-ai/tokens/${visit._id}/copilot` : `/appointment/${visit._id}/copilot`), { prompt: aiPrompt.trim() }, { signal, withCredentials: true }), response => { setSuggestion(textValue(response.data.suggestion)); setContextBrief(response.data.context?.patientBrief || null); task.setFeedback({ tone: "info", message: "Optional draft returned. Review independently before using it." }); });
  if (denied) return <Card><Feedback feedback={task.feedback} /><Button variant="secondary" onClick={refresh}>Refresh access</Button></Card>;
  return <Card className="mp-clinical-active" aria-label="Current consultation"><header className="mp-clinical-visit-heading"><div><p className="mp-eyebrow">Current consultation</p><h2>{clinicalPatientName(visit)}</h2><p>{visit.displayToken || "Appointment"} · {hospital || visit.visitMode === "in_person" ? "Hospital in-person" : "Online consultation"}</p></div><StatusBadge status={visit.status} /></header><p>{hospital || visit.visitMode === "in_person" ? "In-person visit: complete the consultation when care is finished." : "Complete the consultation after care and documentation are finished."}</p>{!confirm && <Feedback feedback={task.feedback} />}<div className="mp-clinical-columns"><div className="mp-stack"><Field as="textarea" label="Doctor notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={12000} disabled={task.busy} hint={hospital ? "Notes are saved when you confirm completion. This draft stays in this open workspace only." : "Save reviewed clinician notes before leaving this workspace."} /><p className="mp-field-hint">{dirty ? "Unsaved draft" : "No unsaved note changes"}</p>{conflict && <Banner action={<Button variant="secondary" onClick={() => { setNotes(saved); setConflict(false); }}>Use latest saved notes</Button>}>Saved notes changed while you were editing. Your draft is retained. Copy any needed text and reconcile it with the latest saved notes before continuing.</Banner>}<div className="mp-actions">{!hospital && <><Button variant="secondary" onClick={saveNotes} disabled={blocked}>Save Notes</Button><Button variant="secondary" onClick={generateReceipt} disabled={blocked}>Generate consultation document</Button></>}<Button onClick={() => setConfirm(true)} disabled={blocked}>Complete consultation</Button></div>{!hospital && <details className="mp-clinical-document"><summary>SOAP draft and clinician review</summary><p>Optional documentation support. Review every field and reconcile it with your own assessment.</p><Button variant="secondary" onClick={generateSoap} disabled={blocked}>Generate SOAP draft</Button>{soap && <div className="mp-stack"><StatusBadge tone={soap.clinicianApproved ? "positive" : "warning"}>{soap.clinicianApproved ? "Clinician reviewed" : "Draft — review needed"}{soap.version ? ` · Version ${soap.version}` : ""}</StatusBadge>{["markdown", "subjective", "objective", "assessment", "plan"].filter(key => typeof soap[key] === "string" && soap[key].trim()).map(key => <section key={key}><h4>{key === "markdown" ? "Draft text" : key}</h4><pre>{soap[key]}</pre></section>)}{!soap.version && <p>This earlier draft needs regeneration before versioned review.</p>}{!soap.clinicianApproved && soap.version && <><label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={blocked || dirty} /> I reviewed this version against the consultation and saved notes.</label><Button onClick={approveSoap} disabled={blocked || dirty || !reviewed}>Approve reviewed SOAP version</Button></>}</div>}</details>}{visit.receiptGeneratedAt && <p className="mp-field-hint">Document recorded {new Date(visit.receiptGeneratedAt).toLocaleString()}</p>}{textValue(visit.receiptText) && <details className="mp-clinical-document"><summary>Review consultation document</summary><pre>{visit.receiptText}</pre></details>}{!hospital && visit.visitMode !== "in_person" && <div className="mp-clinical-video"><CallPanel appointmentId={visit._id} onRefresh={refresh} onRequestEnd={() => setConfirm(true)} patientName={clinicalPatientName(visit)} /></div>}</div><aside className="mp-stack"><h3>Pre-visit draft</h3>{contextBrief || visit.aiTriage?.patientBrief || visit.patientBrief ? <DraftBrief brief={contextBrief || visit.aiTriage?.patientBrief || visit.patientBrief} /> : <p>No pre-visit draft submitted. Continue with your own assessment.</p>}{visit.vitals?.recordedAt && <div className="mp-clinical-vitals"><h3>Recorded vitals</h3><dl>{[["Blood pressure", visit.vitals.bp], ["Temperature", visit.vitals.temperature], ["Pulse", visit.vitals.pulse], ["SpO2", visit.vitals.oxygenSat], ["Weight", visit.vitals.weight]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "Not recorded"}</dd></div>)}</dl></div>}<details className="mp-clinical-copilot"><summary>Optional clinician assistant</summary><p>Generated text is an unconfirmed draft. Care can continue without this assistant.</p><Field as="textarea" label="Assistant prompt" value={aiPrompt} onChange={event => setAiPrompt(event.target.value)} maxLength={2000} disabled={task.busy} /><Button variant="secondary" onClick={ask} disabled={blocked || !aiPrompt.trim()}>Ask Co-Pilot</Button>{suggestion && <div className="mp-clinical-suggestion"><StatusBadge tone="warning">Draft — clinician review needed</StatusBadge><p>{suggestion}</p></div>}</details></aside></div><Dialog open={confirm} title="Complete this consultation?" onClose={() => { if (!task.busy) setConfirm(false); }}><p>Confirm completion for <strong>{clinicalPatientName(visit)}</strong>. {hospital ? "The current clinician notes will be saved with this transition." : "Unsaved clinician notes will be saved before completion."} The server checks the visit’s current revision.</p><Feedback feedback={task.feedback} /><div className="mp-actions"><Button variant="secondary" onClick={() => setConfirm(false)} disabled={task.busy} data-autofocus>Keep consultation open</Button><Button onClick={finish} disabled={blocked}>{task.busy ? "Recording..." : "Confirm completion"}</Button></div></Dialog></Card>;
}
