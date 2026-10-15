import { formatDoctorName } from "../utils/appointments";
import { useState } from "react";
import axios from "axios";
import { ArrowUpRight, Compass } from "lucide-react";
import { Banner, Button, Card, EmptyState, Field, StatusBadge } from "../components/ui";
import { PatientAccess, PatientPage, PrivateNote } from "../components/patient/PatientUI";
import { Feedback } from "../components/account/AccountUI";
import useFormTask from "../hooks/useFormTask";
import { feeText } from "../utils/appointments";
import { BACKEND_URL } from "../utils";
export default function SmartBooking() { return <PatientAccess><SymptomGuide /></PatientAccess>; }
function SymptomGuide() {
  const task = useFormTask(), [symptoms, setSymptoms] = useState(""), [result, setResult] = useState(null);
  const submit = event => {
    event.preventDefault(); if (!symptoms.trim()) return;
    void task.run(async signal => {
      try {
        return await axios.post(BACKEND_URL + "/api/triage/smart-booking", { symptoms: symptoms.trim() }, { signal, withCredentials: true, timeout: 15000 });
      } catch (error) {
        if (["ECONNABORTED", "ETIMEDOUT"].includes(error.code)) error.response = { status: 503, data: {
          message: "The symptom guide timed out. No urgency assessment was completed. Retry or browse doctors directly; booking remains available.",
        } };
        throw error;
      }
    }, response => setResult(response.data));
  };
  const urgent = result && (["EMERGENCY", "HIGH"].includes(result.severity) || Number(result.esi_level) > 0 && Number(result.esi_level) <= 2);
  const denied = [401, 403].includes(task.feedback?.status);
  return <PatientPage eyebrow="Explore your next step" title="Symptom guide" description="Organize what you are feeling and explore doctor profiles returned by the care-routing tool. Its suggestions are drafts; they do not confirm a diagnosis, clinician suitability or appointment." aside={<><Compass size={29} aria-hidden="true" /><h2>You choose your care</h2><p>Review a profile and its actual booking options before making a reservation.</p><PrivateNote /></>}>
    {denied ? <Card><EmptyState title="Patient access is unavailable" action={<Button to="/login?returnTo=%2Fsmart-booking">Patient sign in</Button>}>Sign in again to continue. Previous symptoms and results are hidden.</EmptyState></Card> : <div className="mp-stack"><Feedback feedback={task.feedback} />{!task.online && <Banner>You are offline. Reconnect to request a routing result.</Banner>}{!result ? <Card as="form" className="mp-stack" onSubmit={submit}><h2>What would you like to discuss?</h2><Field as="textarea" label="Symptoms and concerns" rows={6} value={symptoms} required maxLength={4000} disabled={task.busy} onChange={event => setSymptoms(event.target.value)} hint="Share what you want the clinician to know. Nothing is saved by this form to browser storage." /><div className="mp-actions"><Button type="submit" disabled={!symptoms.trim() || task.busy || !task.online}>{task.busy ? "Requesting suggestions..." : "Explore care options"}</Button><Button to="/doctors" variant="secondary">Browse doctors directly</Button></div></Card> : <><Card className="mp-stack"><StatusBadge tone="warning">Draft — clinician review needed</StatusBadge><h2>Routing result</h2>{result.disclaimer && <Banner tone={urgent ? "error" : "info"}>{result.disclaimer}</Banner>}{urgent && <p>Booking through MediPulse does not provide emergency care.</p>}<dl className="mp-details"><div><dt>Model suggestion</dt><dd>{result.disease || "Not returned"}</dd></div><div><dt>Suggested specialty</dt><dd>{result.specialty || "Not returned"}</dd></div><div><dt>Model urgency flag</dt><dd>{result.severity || "Not returned"}{result.esi_level ? " · level " + result.esi_level : ""}</dd></div></dl><div className="mp-actions"><Button variant="secondary" onClick={() => { setResult(null); task.setFeedback(null); }}>Edit my symptoms</Button><Button variant="ghost" onClick={() => { setResult(null); setSymptoms(""); task.setFeedback(null); }}>Start over</Button></div></Card>{!urgent && <section aria-labelledby="routing-profiles-title"><div className="mp-patient-section-heading"><div><h2 id="routing-profiles-title">Doctor profiles returned</h2><p>Compare the recorded specialty and profile. A listed profile does not mean an appointment is available.</p></div></div>{result.ranked_doctors?.length ? <div className="mp-doctor-grid">{result.ranked_doctors.map(doctor => <Card key={doctor._id} className="mp-stack"><div className="mp-doctor-summary mp-doctor-summary--compact"><span className="mp-doctor-avatar" aria-hidden="true">{doctor.profilePicture ? <img src={doctor.profilePicture} alt="" /> : <Compass size={24} />}</span><div><h3>{formatDoctorName(doctor.name, "Name not returned")}</h3><p>{doctor.specialty || "Specialty not returned"}</p>{Number.isFinite(doctor.experience) && <p>{doctor.experience} years of recorded experience</p>}{doctor.clinic?.name && <p>{doctor.clinic.name}</p>}</div></div><div className="mp-fee-row"><span>Listed fee in demo credits</span><strong>{typeof doctor.fee === "number" && Number.isFinite(doctor.fee) ? feeText({ amountMinor: Math.round(doctor.fee * 100), currency: "INR" }) : "Fee not returned"}</strong></div><div className="mp-actions"><Button to={"/appointment/book/" + doctor._id}>See availability<ArrowUpRight size={16} aria-hidden="true" /></Button><Button variant="secondary" to={"/doctorsProfile/" + doctor._id}>View profile</Button></div></Card>)}</div> : <Card><EmptyState title="No doctor profiles were returned" action={<Button to="/doctors" variant="secondary">Browse doctors</Button>}>This result does not confirm that no care is available.</EmptyState></Card>}</section>}</> }</div>}
  </PatientPage>;
}
