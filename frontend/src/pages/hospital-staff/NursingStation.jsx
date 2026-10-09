import { useAuth } from "../../context/AuthContext";
import { Banner, Button, Card, DataTable, Dialog, EmptyState, Field, LoadingState, StatusBadge } from "../../components/ui";
import { validateWalkIn } from "../../utils/visualSystem";
import { createSnapshotGuard } from "../../utils/queueSnapshot";
import { bookingRequestKey, clearBookingRequest } from "../../utils/bookingRequest";
import { useEffect, useMemo, useState, useRef } from "react";
import axios from "axios";
import { ClipboardPlus, RefreshCcw, Save, UserRound, ArrowRight } from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { getSocket } from "../../socket";

const NursingStation = () => {
  const { staffUser: staff, staffHospital: hospital, loader, isStaffAuth } = useAuth();
  const hospitalId = staff?.hospitalId || hospital?._id;
  const [formErrors, setFormErrors] = useState({}), [vitalsErrors, setVitalsErrors] = useState({});
  const [directoryLoading, setDirectoryLoading] = useState(true), [queueLoading, setQueueLoading] = useState(true), [queueError, setQueueError] = useState("");
  const [savingVitals, setSavingVitals] = useState(false), [arrivalPending, setArrivalPending] = useState(null);
  const [doctorId, setDoctorId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [directory, setDirectory] = useState({ departments: [], staff: [] });
  const [sessionId, setSessionId] = useState("");
  const [queue, setQueue] = useState({ waiting: [], currentlyServing: null });
  const [issuing, setIssuing] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("info");
  const showError = text => { setMessage(text); setMessageTone("error"); };
  const [selectedToken, setSelectedToken] = useState(null);
  const [vitals, setVitals] = useState({ bp: "", temperature: "", pulse: "", oxygenSat: "", weight: "", height: "", chiefComplaint: "" });
  const [newToken, setNewToken] = useState({ name: "", phone: "", age: "", gender: "", chiefComplaint: "" });

  const snapshotGuard = useRef(createSnapshotGuard());
  const loadQueue = async () => {
    const ticket = snapshotGuard.current.begin(`${hospitalId}:${doctorId}:${sessionId}`);
    if (!hospitalId || !doctorId) return;
    const response = await axios.get(`${BACKEND_URL}/api/opd/${hospitalId}/${doctorId}/queue`, { params: { sessionId: sessionId || undefined }, withCredentials: true });
    if (snapshotGuard.current.accept(ticket, response.data)) { setQueue(response.data); setQueueLoading(false); setQueueError(""); }
  };

  const loadDirectory = async () => {
    if (!hospitalId) return;
    const response = await axios.get(`${BACKEND_URL}/api/staff-messages/directory`, { withCredentials: true });
    const nextDirectory = response.data || { departments: [], staff: [] };
    setDirectory(nextDirectory);
    if (!departmentId) setDepartmentId(staff?.departmentIds?.[0] || nextDirectory.departments?.[0]?._id || "");
  };

  useEffect(() => {
    loadDirectory().catch((error) => showError(error.response?.data?.message || "Unable to load staff directory")).finally(() => setDirectoryLoading(false));
  }, [hospitalId]);

  useEffect(() => {
    const doctors = directory.staff.filter((member) => member.role === "DOCTOR" && (!departmentId || member.departmentIds?.some((id) => String(id) === String(departmentId))));
    if (!doctorId && doctors[0]?._id) setDoctorId(doctors[0]._id);
  }, [departmentId, directory.staff, doctorId]);

  useEffect(() => {
    loadQueue().catch(() => { setQueueError("Unable to refresh the OPD queue. Try refreshing again."); setQueueLoading(false); });
  }, [doctorId, sessionId]);

  useEffect(() => {
    if (!isStaffAuth || !hospitalId) return undefined;
    const socket = getSocket("staff");
    if (!socket.connected) socket.connect();
    const refresh = () => loadQueue().catch(() => setQueueError("Unable to refresh the OPD queue. Displayed details may be out of date."));
    socket.on("connect", refresh);
    socket.on("opd:queue-changed", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    socket.on("opd:checked-in", refresh);
    socket.on("opd:token-issued", refresh);
    socket.on("opd:vitals-ready", refresh);
    socket.on("opd:consultation-started", refresh);
    socket.on("opd:no-show", refresh);
    const interval = window.setInterval(refresh, 10000);
    return () => {
      clearInterval(interval);
      socket.off("connect", refresh);
      socket.off("opd:queue-changed", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      socket.off("opd:checked-in", refresh);
      socket.off("opd:token-issued", refresh);
      socket.off("opd:vitals-ready", refresh);
      socket.off("opd:consultation-started", refresh);
      socket.off("opd:no-show", refresh);
    };
  }, [hospitalId, doctorId, sessionId, isStaffAuth]);

  const issueToken = async (event) => {
    event.preventDefault();
    if (issuing) return;
    const errors = validateWalkIn(newToken); setFormErrors(errors);
    if (Object.keys(errors).length) { document.getElementById("walkin-" + Object.keys(errors)[0])?.focus(); return; }
    const scope = `walkin:${staff?._id}:${hospitalId}:${departmentId}:${doctorId}`;
    setIssuing(true);
    setMessage(""); setMessageTone("info");
    try {
      const requestKey = await bookingRequestKey(scope, newToken);
      const response = await axios.post(
        `${BACKEND_URL}/api/opd/${hospitalId}/${departmentId}/token`,
        {
          doctorId, sessionId: sessionId || queue.sessionId,
          patientInfo: { ...newToken, isWalkIn: true },
          chiefComplaint: newToken.chiefComplaint,
        },
        { withCredentials: true, headers: { "Idempotency-Key": requestKey } },
      );
      if (response.status === 202) { setMessage(response.data.message); return; }
      clearBookingRequest(scope);
      setNewToken({ name: "", phone: "", age: "", gender: "", chiefComplaint: "" });
      await loadQueue();
      setMessage("Walk-in token issued.");
    } catch (error) {
      showError(error.response?.data?.message || "Could not issue token");
    } finally { setIssuing(false); }
  };

  const checkIn = async (token) => {
    if (arrivalPending) return;
    setArrivalPending(token._id);
    try {
      await axios.patch(`${BACKEND_URL}/api/opd/tokens/${token._id}/check-in`, { revision: token.revision }, { withCredentials: true });
      await loadQueue();
    } catch (error) { showError(error.response?.data?.message || "Check-in failed"); }
    finally { setArrivalPending(null); }
  };

  const saveVitals = async (event) => {
    event.preventDefault();
    if (!selectedToken || savingVitals) return;
    const errors = {};
    for (const field of ["temperature", "pulse", "oxygenSat", "weight", "height"]) if (vitals[field] !== "" && !Number.isFinite(Number(vitals[field]))) errors[field] = "Enter a valid number.";
    setVitalsErrors(errors);
    if (Object.keys(errors).length) return;
    setSavingVitals(true);
    setMessage(""); setMessageTone("info");
    try {
      await axios.patch(`${BACKEND_URL}/api/opd/tokens/${selectedToken._id}/vitals`, Object.fromEntries(Object.entries(vitals).filter(([, value]) => value !== "")), { withCredentials: true });
      setSelectedToken(null);
      setVitals({ bp: "", temperature: "", pulse: "", oxygenSat: "", weight: "", height: "", chiefComplaint: "" });
      await loadQueue();
    } catch (error) {
      showError(error.response?.data?.message || "Could not save vitals");
    } finally { setSavingVitals(false); }
  };

  const markNoShow = async (tokenId) => {
    try {
      await axios.patch(`${BACKEND_URL}/api/opd/tokens/${tokenId}/no-show`, {}, { withCredentials: true });
      await loadQueue();
    } catch (error) {
      showError(error.response?.data?.message || "Could not mark no-show");
    }
  };

  const doctors = useMemo(() => directory.staff.filter(member => member.role === "DOCTOR" && (!departmentId || member.departmentIds?.some(id => String(id._id || id) === String(departmentId)))), [directory.staff, departmentId]);
  const resetQueue = () => { snapshotGuard.current.reset(); setQueue({ waiting: [], reservations: [], currentlyServing: null }); setQueueLoading(true); };
  const waiting = queue.waiting?.filter(token => token.status === "waiting") || [];
  const prepared = queue.waiting?.filter(token => token.status === "vitals_done") || [];
  if (loader) return <main className="mp-page"><LoadingState>Loading staff workspace...</LoadingState></main>;
  if (!hospitalId || !isStaffAuth) return <main className="mp-page"><Card><EmptyState title="Sign in to your hospital workspace" action={<Button to="/hospital/login">Staff sign in <ArrowRight size={16} /></Button>}>Use the staff account issued by your hospital to operate its OPD queue.</EmptyState></Card></main>;
  return <main className="mp-page"><div className="mp-section-heading"><div><p className="mp-eyebrow">{hospital?.name || "Hospital OPD"}</p><h1>Nursing Station</h1><p>Coordinate arrivals, prepare vitals and keep the next step in care moving.</p></div><Button variant="secondary" onClick={() => loadQueue().catch(() => setQueueError("Unable to refresh the OPD queue."))} disabled={!doctorId}><RefreshCcw size={16} />Refresh queue</Button></div>
    {message && <Banner tone={messageTone}>{message}</Banner>}{queueError && <Banner>{queueError}</Banner>}
    <Card aria-label="Care context"><div className="mp-filter-grid" style={{ margin: 0 }}><Field as="select" label="Department" value={departmentId} onChange={event => { resetQueue(); setDepartmentId(event.target.value); setDoctorId(""); }}><option value="">Select department</option>{directory.departments.map(department => <option key={department._id} value={department._id}>{department.name}</option>)}</Field><Field as="select" label="Doctor" value={doctorId} onChange={event => { resetQueue(); setDoctorId(event.target.value); }}><option value="">Select doctor</option>{doctors.map(doctor => <option key={doctor._id} value={doctor._id}>{doctor.name}</option>)}</Field><Field as="select" label="Care session" value={sessionId || queue.sessionId || "day"} onChange={event => { resetQueue(); setSessionId(event.target.value); }}>{(queue.sessionIds || [queue.sessionId || "day"]).map(id => <option key={id} value={id}>{id}</option>)}</Field></div></Card>
    <div className="mp-summary-grid"><div className="mp-summary"><span>Awaiting arrival</span><strong>{queueLoading ? "—" : queue.reservations?.length || 0}</strong></div><div className="mp-summary"><span>Waiting for vitals</span><strong>{queueLoading ? "—" : waiting.length}</strong></div><div className="mp-summary"><span>Ready for doctor</span><strong>{queueLoading ? "—" : prepared.length}</strong></div></div>
    <div className="mp-workspace-grid"><div className="mp-stack">
      <Card aria-label="Reserved visits awaiting arrival"><div className="mp-card-heading"><h2>Reserved visits awaiting arrival</h2><StatusBadge tone="info">Check-in required</StatusBadge></div>{directoryLoading || (queueLoading && doctorId) ? <LoadingState>Loading reservations...</LoadingState> : !doctorId ? <EmptyState title="Select a doctor to view the queue." /> : <DataTable caption="Reservation check-in" empty="No visits awaiting check-in." rows={queue.reservations || []} columns={[{ key: "displayToken", label: "Token" }, { key: "patient", label: "Patient", render: token => token.patientInfo?.name || "Patient" }, { key: "arrival", label: "Arrival", render: token => <Button size="small" disabled={Boolean(arrivalPending)} onClick={() => checkIn(token)}>Confirm arrival</Button> }]} />}</Card>
      <Card><div className="mp-card-heading"><h2>Waiting for Vitals</h2><UserRound size={20} /></div>{queueLoading && doctorId ? <LoadingState>Loading the care queue...</LoadingState> : !waiting.length ? <EmptyState title="No patients waiting for vitals.">Arrived patients appear here when reception confirms their arrival.</EmptyState> : <div className="mp-stack">{waiting.map(token => <div key={token._id}><div className="mp-card-heading"><div className="mp-queue-person"><span className="mp-avatar"><UserRound size={17} /></span><div><strong>{token.displayToken}</strong><p className="mp-field-hint">{token.patientInfo?.name || "Patient"}</p></div></div><Button size="small" onClick={() => { setVitalsErrors({}); setSelectedToken(token); setVitals({ bp: "", temperature: "", pulse: "", oxygenSat: "", weight: "", height: "", chiefComplaint: token.chiefComplaint || "" }); }}>Record Vitals</Button></div><Button variant="danger" size="small" onClick={() => markNoShow(token._id)}>Mark no-show</Button></div>)}</div>}</Card>
      <Card><div className="mp-card-heading"><h2>Vitals Done</h2><StatusBadge tone="positive">Ready for doctor</StatusBadge></div>{!prepared.length ? <EmptyState title="No completed vitals yet." /> : <DataTable caption="Patients ready for consultation" rows={prepared} columns={[{ key: "displayToken", label: "Token" }, { key: "patient", label: "Patient", render: token => token.patientInfo?.name || "Patient" }, { key: "status", label: "Status", render: token => <StatusBadge status={token.status} /> }]} />}</Card>
    </div><Card as="form" onSubmit={issueToken} noValidate><div className="mp-card-heading"><h2>Issue Walk-in Token</h2><ClipboardPlus size={21} /></div><p className="mp-field-hint" style={{ marginBottom: 22 }}>For a patient already at the hospital. Confirm the care context before issuing a token.</p><div className="mp-form-grid"><Field id="walkin-name" label="Patient name" required error={formErrors.name} value={newToken.name} autoComplete="off" maxLength={120} onChange={event => setNewToken({ ...newToken, name: event.target.value })} /><Field id="walkin-phone" label="Phone" type="tel" error={formErrors.phone} value={newToken.phone} onChange={event => setNewToken({ ...newToken, phone: event.target.value })} /><div className="mp-form-row"><Field id="walkin-age" label="Age" type="number" error={formErrors.age} min="0" max="130" value={newToken.age} onChange={event => setNewToken({ ...newToken, age: event.target.value })} /><Field as="select" label="Gender" value={newToken.gender} onChange={event => setNewToken({ ...newToken, gender: event.target.value })}><option value="">Not supplied</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Field></div><Field as="textarea" label="Chief complaint" value={newToken.chiefComplaint} onChange={event => setNewToken({ ...newToken, chiefComplaint: event.target.value })} /><Button type="submit" disabled={issuing || !doctorId || !departmentId}>{issuing ? "Issuing token..." : "Issue Token"}</Button></div></Card></div>
    <Dialog open={Boolean(selectedToken)} onClose={() => setSelectedToken(null)} title={"Record Vitals: " + (selectedToken?.displayToken || "")}><form onSubmit={saveVitals} noValidate><div className="mp-form-grid"><Field label="Blood pressure" data-autofocus placeholder="e.g. 120/80" value={vitals.bp} onChange={event => setVitals({ ...vitals, bp: event.target.value })} /><div className="mp-form-row">{[["temperature", "Temperature (°F)"], ["pulse", "Pulse (bpm)"], ["oxygenSat", "SpO2 (%)"], ["weight", "Weight (kg)"], ["height", "Height (cm)"]].map(([field, label]) => <Field key={field} label={label} type="number" step="any" error={vitalsErrors[field]} value={vitals[field]} onChange={event => setVitals({ ...vitals, [field]: event.target.value })} />)}</div><Field as="textarea" label="Chief complaint" value={vitals.chiefComplaint} onChange={event => setVitals({ ...vitals, chiefComplaint: event.target.value })} /></div><div className="mp-actions"><Button variant="secondary" onClick={() => setSelectedToken(null)}>Cancel</Button><Button type="submit" disabled={savingVitals}><Save size={16} />{savingVitals ? "Saving..." : "Save Vitals"}</Button></div></form></Dialog>
  </main>;
};
export default NursingStation;
