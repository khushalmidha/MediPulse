/* eslint-disable react/prop-types */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { Activity, AlertTriangle, Clock3, FlaskConical, Pill, Plus, RefreshCcw, Stethoscope, Trash2, UsersRound } from "lucide-react";
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

  // Orders and service departments for hospital consultations
  const [serviceDepts, setServiceDepts] = useState({ lab: [], pharmacy: [] });
  const [catalog, setCatalog] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [catalogError, setCatalogError] = useState("");
  const [inventoryError, setInventoryError] = useState("");
  const [labOrders, setLabOrders] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [criticalOrders, setCriticalOrders] = useState([]);

  // Lab composer state
  const [selectedLabDept, setSelectedLabDept] = useState("");
  const [selectedLabTests, setSelectedLabTests] = useState([]);
  const [labNotes, setLabNotes] = useState("");

  // Prescription composer state
  const [selectedPharmacyDept, setSelectedPharmacyDept] = useState("");
  const [selectedMedCode, setSelectedMedCode] = useState("");
  const [directions, setDirections] = useState("");
  const [duration, setDuration] = useState("5 days");
  const [quantity, setQuantity] = useState(1);
  const [prescriptionItems, setPrescriptionItems] = useState([]);
  const [prescriptionDiagnosis, setPrescriptionDiagnosis] = useState(visit.diagnosis || visit.chiefComplaint || "");

  useEffect(() => {
    const revision = Number.isInteger(visit.revision) ? visit.revision : 0;
    if (revision < writeRevision.current) return;
    writeRevision.current = revision;
    const signature = JSON.stringify(visit.soapNote || null);
    if (signature !== soapSignature.current) { soapSignature.current = signature; setSoap(visit.soapNote || null); setReviewed(false); }
  }, [visit.revision, visit.soapNote]);

  const [confirm, setConfirm] = useState(false), [aiPrompt, setAiPrompt] = useState("Suggest focused consultation questions and red flags"), [suggestion, setSuggestion] = useState(""), [contextBrief, setContextBrief] = useState(null);
  const task = useFormTask(), dirty = notes !== saved;

  const clinicalLoad = useRef({sequence:0,controller:null});
  const loadClinicalData = useCallback(async () => {
    if (!hospital || !visit._id) return;
    clinicalLoad.current.controller?.abort();
    const controller=new AbortController(), sequence=++clinicalLoad.current.sequence;clinicalLoad.current.controller=controller;
    const config={withCredentials:true,signal:controller.signal,timeout:15000};
    try {
      const [deptRes, catRes, invRes, labRes, rxRes, critRes] = await Promise.allSettled([
        axios.get(`${BACKEND_URL}/api/opd/${visit.hospitalId}/service-departments`, config),
        axios.get(`${BACKEND_URL}/api/labs/catalog`, config),
        axios.get(`${BACKEND_URL}/api/pharmacy/inventory`, config),
        axios.get(`${BACKEND_URL}/api/labs/orders?tokenId=${visit._id}`, config),
        axios.get(`${BACKEND_URL}/api/pharmacy/prescriptions?tokenId=${visit._id}`, config),
        axios.get(`${BACKEND_URL}/api/labs/orders?critical=pending`, config),
      ]);
      if(controller.signal.aborted || sequence!==clinicalLoad.current.sequence)return;
      if (deptRes.status === "fulfilled") {
        const sDepts = deptRes.value.data?.serviceDepartments || { lab: [], pharmacy: [] };
        setServiceDepts(sDepts);
        if (sDepts.lab?.length) setSelectedLabDept(previous=>previous || String(sDepts.lab[0]._id));
        if (sDepts.pharmacy?.length) setSelectedPharmacyDept(previous=>previous || String(sDepts.pharmacy[0]._id));
      }
      if (catRes.status === "fulfilled") { setCatalog(catRes.value.data?.catalog || []); setCatalogError(""); }
      else if (catRes.reason?.response?.status === 403) setCatalogError("Access to laboratory catalog is restricted for your role.");
      if (invRes.status === "fulfilled") { setInventory(invRes.value.data?.inventory || []); setInventoryError(""); }
      else if (invRes.reason?.response?.status === 403) setInventoryError("Access to pharmacy inventory is restricted for your role.");
      if (labRes.status === "fulfilled") setLabOrders(labRes.value.data?.orders || []);
      if (rxRes.status === "fulfilled") setPrescriptions(rxRes.value.data?.prescriptions || []);
      if (critRes.status === "fulfilled") setCriticalOrders(critRes.value.data?.orders || []);
    } catch {
      // Ignored
    }
  }, [hospital,visit._id,visit.hospitalId]);

  useEffect(() => { const load=clinicalLoad.current;void loadClinicalData();return()=>load.controller?.abort(); }, [loadClinicalData]);

  useEffect(() => { if ((Number.isInteger(visit.revision) ? visit.revision : 0) < writeRevision.current) return; if (incoming !== baseline.current) { if (current.current === baseline.current) setNotes(incoming); else if (current.current !== incoming) setConflict(true); baseline.current = incoming; setSaved(incoming); } }, [incoming, visit.revision]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { onBusy(task.busy); return () => onBusy(false); }, [task.busy, onBusy]);
  useEffect(() => { if (task.feedback?.status === 409) refresh(); }, [task.feedback, refresh]);
  const denied = [401, 403, 404].includes(task.feedback?.status), blocked = disabled || task.busy || !task.online || conflict;
  const send = (method, suffix, body, signal) => axios({ method, url: BACKEND_URL + (hospital ? `/api/opd/tokens/${visit._id}/` : `/appointment/${visit._id}/`) + suffix, data: body, withCredentials: true, signal });
  const acceptedNotes = (response, invalidate = true) => {
    const value = textValue(response.data.doctorNotes ?? response.data.consultationNotes);
    if (!Number.isInteger(response.data.revision)) throw new Error("Refresh the visit before continuing.");
    const changed = value !== baseline.current;
    writeRevision.current = response.data.revision; baseline.current = value; setSaved(value); setNotes(value); setReviewed(false);
    if (invalidate || changed) setSoap(previous => previous ? { ...previous, clinicianApproved: false, isDraft: true } : null);
  };
  const finish = () => task.run(async signal => {
    if (hospital) {
      return send("patch", "complete", { notes, revision: writeRevision.current }, signal);
    }
    if (dirty) acceptedNotes(await send("patch", "notes", { doctorNotes: notes, revision: writeRevision.current }, signal));
    return send("post", "end", { revision: writeRevision.current }, signal);
  }, () => { setConfirm(false); onDirty(false); refresh(); task.setFeedback({ tone: "info", message: "Consultation completion recorded. Refreshing current status..." }); });

  const saveNotes = () => task.run(async signal => { const result = await send("patch", "notes", { doctorNotes: notes, revision: writeRevision.current }, signal); acceptedNotes(result); return result; }, () => { task.setFeedback({ tone: "info", message: "Doctor notes saved." }); refresh(); });
  const generateReceipt = () => task.run(async signal => { const result = await send("post", "receipt", { doctorNotes: notes, revision: writeRevision.current }, signal); acceptedNotes(result, false); return result; }, () => { task.setFeedback({ tone: "info", message: "Consultation document generated. Review its draft text before using it." }); refresh(); });

  const generateSoap = () => task.run(async signal => {
    const result = hospital
      ? await send("post", "generate-soap", { doctorNotes: notes, revision: writeRevision.current }, signal)
      : await axios.post(`${BACKEND_URL}/api/copilot/${visit._id}/generate-soap`, { doctorNotes: notes, revision: writeRevision.current }, { withCredentials: true, signal });
    if (!Number.isInteger(result.data.revision)) throw new Error("Refresh the visit before continuing.");
    writeRevision.current = result.data.revision; baseline.current = notes; setSaved(notes); setSoap(result.data.soapNote); soapSignature.current = JSON.stringify(result.data.soapNote); setReviewed(false); return result;
  }, () => { refresh(); task.setFeedback({ tone: "info", message: "SOAP draft prepared. Review it before approval." }); });

  const approveSoap = () => task.run(signal => send("post", "soap-note/approve", { revision: writeRevision.current, noteVersion: soap.version }, signal), result => {
    writeRevision.current = result.data.revision; setSoap(result.data.soapNote); soapSignature.current = JSON.stringify(result.data.soapNote); setReviewed(false); refresh(); task.setFeedback({ tone: "info", message: "Clinician review recorded for this SOAP version." });
  });

  const ask = () => task.run(signal => axios.post(BACKEND_URL + (hospital ? `/api/opd-ai/tokens/${visit._id}/copilot` : `/appointment/${visit._id}/copilot`), { prompt: aiPrompt.trim() }, { signal, withCredentials: true }), response => { setSuggestion(textValue(response.data.suggestion)); setContextBrief(response.data.context?.patientBrief || null); task.setFeedback({ tone: "info", message: "Optional draft returned. Review independently before using it." }); });

  const placeLabOrder = () => task.run(async signal => {
    if (!selectedLabDept) throw new Error("A target laboratory service department is required.");
    if (!selectedLabTests.length) throw new Error("Select at least one laboratory test to order.");
    const keyStorageKey = `mp_lab_key_${visit._id}`;
    let creationKey = sessionStorage.getItem(keyStorageKey);
    if (!creationKey) {
      creationKey = `lab-${visit._id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem(keyStorageKey, creationKey);
    }
    const payload = {
      tokenId: visit._id,
      encounterJourneyId: visit.encounterJourneyId,
      departmentId: visit.departmentId,
      serviceDepartmentId: selectedLabDept,
      tests: selectedLabTests.map(catalogId => ({ catalogId })),
      clinicalNotes: labNotes.trim(),
      creationKey,
    };
    const res = await axios.post(`${BACKEND_URL}/api/labs/orders`, payload, {
      withCredentials: true,
      headers: { "Idempotency-Key": creationKey },
      signal,
    });
    sessionStorage.removeItem(keyStorageKey);
    setSelectedLabTests([]);
    setLabNotes("");
    return res;
  }, response => {
    loadClinicalData();
    const msg = response?.data?.replayed ? "Laboratory order recovered from prior submission." : "Laboratory order placed.";
    task.setFeedback({ tone: "info", message: msg });
  });

  const addPrescriptionItem = () => {
    if (!selectedMedCode) return;
    const med = inventory.find(m => m.medicationCode === selectedMedCode);
    if (!med) return;
    setPrescriptionItems(prev => [
      ...prev,
      {
        inventoryId: med._id,
        medicationCode: med.medicationCode,
        medicationName: med.medicationName,
        dosageForm: med.dosageForm || "tablet",
        strength: med.strength || "",
        directions: directions.trim() || "As directed",
        duration: duration.trim() || "5 days",
        durationDays: parseInt(duration, 10) || 5,
        quantityPrescribed: Number(quantity) || 1,
      },
    ]);
    setSelectedMedCode("");
    setDirections("");
    setDuration("5 days");
    setQuantity(1);
  };

  const removePrescriptionItem = index => {
    setPrescriptionItems(prev => prev.filter((_, i) => i !== index));
  };

  const placePrescription = () => task.run(async signal => {
    if (!selectedPharmacyDept) throw new Error("A target pharmacy service department is required.");
    if (!prescriptionItems.length) throw new Error("Add at least one medication to the prescription.");
    const keyStorageKey = `mp_rx_key_${visit._id}`;
    let creationKey = sessionStorage.getItem(keyStorageKey);
    if (!creationKey) {
      creationKey = `rx-${visit._id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem(keyStorageKey, creationKey);
    }
    const payload = {
      tokenId: visit._id,
      encounterJourneyId: visit.encounterJourneyId,
      departmentId: visit.departmentId,
      serviceDepartmentId: selectedPharmacyDept,
      diagnosis: (prescriptionDiagnosis || visit.diagnosis || visit.chiefComplaint || "").trim(),
      items: prescriptionItems.map(item => ({
        inventoryId: item.inventoryId,
        directions: item.directions,
        durationDays: item.durationDays || 5,
        quantityPrescribed: item.quantityPrescribed,
      })),
      creationKey,
    };
    const res = await axios.post(`${BACKEND_URL}/api/pharmacy/prescriptions`, payload, {
      withCredentials: true,
      headers: { "Idempotency-Key": creationKey },
      signal,
    });
    sessionStorage.removeItem(keyStorageKey);
    setPrescriptionItems([]);
    return res;
  }, response => {
    loadClinicalData();
    const msg = response?.data?.replayed ? "Prescription recovered from prior submission." : "Prescription approved by clinician.";
    task.setFeedback({ tone: "info", message: msg });
  });

  const acknowledgeCritical = order => task.run(async signal => {
    const reportVersion = order.reportVersion || order.reportVersions?.[order.reportVersions.length - 1]?.version || 1;
    const res = await axios.post(`${BACKEND_URL}/api/labs/orders/${order._id}/acknowledge-critical`, {
      expectedRevision: order.workflowRevision,
      reportVersion,
    }, {
      withCredentials: true,
      headers: { "Idempotency-Key": `crit-ack-${order._id}-${reportVersion}-${Date.now()}` },
      signal,
    });
    return res;
  }, () => {
    loadClinicalData();
    task.setFeedback({ tone: "info", message: "Critical lab alert acknowledged." });
  });

  if (denied) return <Card><Feedback feedback={task.feedback} /><Button variant="secondary" onClick={refresh}>Refresh access</Button></Card>;

  // Detect any critical alerts for current visit or assigned to this clinician
  const visitCriticalOrders = labOrders.filter(o => o.reportVersions?.some(r => r.criticalTask?.createdAt && !r.criticalTask?.acknowledgedAt));
  const activeCriticalAlerts = [...visitCriticalOrders, ...criticalOrders.filter(co => !visitCriticalOrders.some(vo => vo._id === co._id))];

  return <Card className="mp-clinical-active" aria-label="Current consultation"><header className="mp-clinical-visit-heading"><div><p className="mp-eyebrow">Current consultation</p><h2>{clinicalPatientName(visit)}</h2><p>{visit.displayToken || "Appointment"} · {hospital || visit.visitMode === "in_person" ? "Hospital in-person" : "Online consultation"}</p></div><StatusBadge status={visit.status} /></header><p>{hospital || visit.visitMode === "in_person" ? "In-person visit: complete the consultation when care is finished." : "Complete the consultation after care and documentation are finished."}</p>{!confirm && <Feedback feedback={task.feedback} />}

    {activeCriticalAlerts.length > 0 && <div className="mp-critical-alert" role="alert"><h4><AlertTriangle size={18} aria-hidden="true" /> Critical Laboratory Value Alerts ({activeCriticalAlerts.length})</h4><p>Urgent test findings require immediate clinician review and version-bound acknowledgement.</p>{activeCriticalAlerts.map(order => <div key={order._id} className="mp-order-card" style={{ marginTop: 8 }}><div><strong>Order {order.accessionBarcode || order._id}</strong><p>Status: {order.orderStatus} · Report Version {order.reportVersion || 1}</p>{order.results?.filter(r => r.isCritical).map(r => <p key={r.parameterCode} style={{ color: "#b91c1c" }}><strong>{r.parameterName}:</strong> {r.value} {r.unit} (Critical {r.flag})</p>)}</div><Button variant="danger" onClick={() => acknowledgeCritical(order)} disabled={blocked}>Acknowledge Critical Alert</Button></div>)}</div>}

    <div className="mp-clinical-columns"><div className="mp-stack"><Field as="textarea" label="Doctor notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={12000} disabled={task.busy} hint={hospital ? "Notes are saved when you click Save Notes or complete the consultation." : "Save reviewed clinician notes before leaving this workspace."} /><p className="mp-field-hint">{dirty ? "Unsaved draft" : "No unsaved note changes"}</p>{conflict && <Banner action={<Button variant="secondary" onClick={() => { setNotes(saved); setConflict(false); }}>Use latest saved notes</Button>}>Saved notes changed while you were editing. Your draft is retained. Copy any needed text and reconcile it with the latest saved notes before continuing.</Banner>}<div className="mp-actions"><Button variant="secondary" onClick={saveNotes} disabled={blocked}>Save Notes</Button>{!hospital && <Button variant="secondary" onClick={generateReceipt} disabled={blocked}>Generate consultation document</Button>}<Button onClick={() => setConfirm(true)} disabled={blocked}>Complete consultation</Button></div>

    <details className="mp-clinical-document"><summary>SOAP draft and clinician review</summary><p>Documentation support. Review every field and reconcile it with your own assessment before approving.</p><Button variant="secondary" onClick={generateSoap} disabled={blocked}>Generate SOAP draft</Button>{soap && <div className="mp-stack"><StatusBadge tone={soap.clinicianApproved ? "positive" : "warning"}>{soap.clinicianApproved ? "Clinician reviewed" : "Draft — review needed"}{soap.version ? ` · Version ${soap.version}` : ""}</StatusBadge>{["markdown", "subjective", "objective", "assessment", "plan"].filter(key => typeof soap[key] === "string" && soap[key].trim()).map(key => <section key={key}><h4>{key === "markdown" ? "Draft text" : key}</h4><pre>{soap[key]}</pre></section>)}{!soap.version && <p>This earlier draft needs regeneration before versioned review.</p>}{!soap.clinicianApproved && soap.version && <><label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={blocked || dirty} /> I reviewed this version against the consultation and saved notes.</label><Button onClick={approveSoap} disabled={blocked || dirty || !reviewed}>Approve reviewed SOAP version</Button></>}</div>}</details>

    {visit.receiptGeneratedAt && <p className="mp-field-hint">Document recorded {new Date(visit.receiptGeneratedAt).toLocaleString()}</p>}{textValue(visit.receiptText) && <details className="mp-clinical-document"><summary>Review consultation document</summary><pre>{visit.receiptText}</pre></details>}

    {hospital && <div className="mp-clinical-orders"><h3>Clinical Orders & Prescriptions</h3>
      <details className="mp-clinical-composer"><summary><FlaskConical size={18} aria-hidden="true" /> Lab Order Composer</summary>
        {catalogError ? <Banner tone="warning">{catalogError}</Banner> : serviceDepts.lab.length === 0 ? <Banner tone="warning">No active laboratory service department with assigned technicians found in this hospital.</Banner> : <div className="mp-stack">
          <Field as="select" label="Target service department" value={selectedLabDept} onChange={e => setSelectedLabDept(e.target.value)} disabled={blocked}>
            {serviceDepts.lab.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}
          </Field>
          <fieldset style={{ border: "1px solid var(--mp-border)", borderRadius: "var(--mp-radius)", padding: 12 }}><legend style={{ fontWeight: 600 }}>Select Catalog Tests</legend>
            {catalog.length === 0 ? <p className="mp-field-hint">No active lab tests in catalog.</p> : catalog.map(item => (
              <label key={item._id} style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={selectedLabTests.includes(item._id)} onChange={e => {
                  if (e.target.checked) setSelectedLabTests(prev => [...prev, item._id]);
                  else setSelectedLabTests(prev => prev.filter(c => c !== item._id));
                }} disabled={blocked} />
                <span><strong>{item.name}</strong> ({item.code}) · ₹{(item.priceMinor || 0) / 100}</span>
              </label>
            ))}
          </fieldset>
          <Field as="textarea" label="Clinical indication & notes" value={labNotes} onChange={e => setLabNotes(e.target.value)} maxLength={2000} disabled={blocked} placeholder="Clinical indications, provisional diagnosis or specimen requirements..." />
          <Button onClick={placeLabOrder} disabled={blocked || !selectedLabDept || selectedLabTests.length === 0}>Place Laboratory Order</Button>
        </div>}
      </details>

      <details className="mp-clinical-composer"><summary><Pill size={18} aria-hidden="true" /> Prescription Composer</summary>
        {inventoryError ? <Banner tone="warning">{inventoryError}</Banner> : serviceDepts.pharmacy.length === 0 ? <Banner tone="warning">No active pharmacy service department with assigned pharmacists found in this hospital.</Banner> : <div className="mp-stack">
          <Field as="select" label="Target pharmacy department" value={selectedPharmacyDept} onChange={e => setSelectedPharmacyDept(e.target.value)} disabled={blocked}>
            {serviceDepts.pharmacy.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}
          </Field>
          <Field label="Prescription diagnosis" value={prescriptionDiagnosis} onChange={e => setPrescriptionDiagnosis(e.target.value)} maxLength={500} disabled={blocked} placeholder="Diagnosis or indication..." />
          <div style={{ background: "var(--mp-surface)", border: "1px solid var(--mp-border)", borderRadius: "var(--mp-radius)", padding: 12 }}>
            <h4>Add Medication</h4>
            <div style={{ display: "grid", gap: 8 }}>
              <Field as="select" label="Select medication" value={selectedMedCode} onChange={e => setSelectedMedCode(e.target.value)} disabled={blocked}>
                <option value="">-- Choose medication from inventory --</option>
                {inventory.map(item => <option key={item.medicationCode} value={item.medicationCode}>{item.medicationName} {item.strength} ({item.dosageForm}) - Stock: {item.totalStock}</option>)}
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                <Field label="Directions" value={directions} onChange={e => setDirections(e.target.value)} placeholder="e.g. 1 tab twice daily" disabled={blocked} />
                <Field label="Duration" value={duration} onChange={e => setDuration(e.target.value)} placeholder="e.g. 5 days" disabled={blocked} />
                <Field label="Quantity" type="number" min={1} value={quantity} onChange={e => setQuantity(e.target.value)} disabled={blocked} />
              </div>
              <Button variant="secondary" onClick={addPrescriptionItem} disabled={blocked || !selectedMedCode}><Plus size={16} aria-hidden="true" /> Add to Prescription</Button>
            </div>
          </div>

          {prescriptionItems.length > 0 && <div className="mp-stack">
            <h4>Prescription Items ({prescriptionItems.length})</h4>
            {prescriptionItems.map((item, idx) => (
              <div key={idx} className="mp-order-card">
                <div>
                  <strong>{item.medicationName}</strong> ({item.strength}) - Qty: {item.quantityPrescribed}
                  <p>{item.directions} · {item.duration}</p>
                </div>
                <Button variant="secondary" onClick={() => removePrescriptionItem(idx)} disabled={blocked}><Trash2 size={16} aria-hidden="true" /></Button>
              </div>
            ))}
            <Button onClick={placePrescription} disabled={blocked || !selectedPharmacyDept || prescriptionItems.length === 0}>Approve & Create Prescription</Button>
          </div>}
        </div>}
      </details>

      <div className="mp-stack" style={{ marginTop: 12 }}>
        <h4>Ordered Work for this Visit</h4>
        {labOrders.length === 0 && prescriptions.length === 0 ? <p className="mp-field-hint">No lab orders or prescriptions placed for this consultation yet.</p> : <>
          {labOrders.map(order => (
            <div key={order._id} className="mp-order-card">
              <div>
                <p className="mp-eyebrow">Lab Order · {order.accessionBarcode || order._id}</p>
                <strong>{order.tests?.map(t => t.testName || t.testCode).join(", ")}</strong>
                <p>Status: <StatusBadge status={order.orderStatus} /></p>
                {order.clinicalNotes && <p className="mp-field-hint">Notes: {order.clinicalNotes}</p>}
              </div>
            </div>
          ))}
          {prescriptions.map(rx => (
            <div key={rx._id} className="mp-order-card">
              <div>
                <p className="mp-eyebrow">Prescription · {rx.prescriptionNumber || rx._id}</p>
                <strong>{rx.items?.map(i => `${i.medicationName} (${i.quantityPrescribed})`).join(", ")}</strong>
                <p>Status: <StatusBadge status={rx.status} /></p>
                {rx.diagnosis && <p className="mp-field-hint">Diagnosis: {rx.diagnosis}</p>}
              </div>
            </div>
          ))}
        </>}
      </div>
    </div>}

    {!hospital && visit.visitMode !== "in_person" && <div className="mp-clinical-video"><CallPanel appointmentId={visit._id} onRefresh={refresh} onRequestEnd={() => setConfirm(true)} patientName={clinicalPatientName(visit)} /></div>}</div>

    <aside className="mp-stack"><h3>Pre-visit draft</h3>{contextBrief || visit.aiTriage?.patientBrief || visit.patientBrief ? <DraftBrief brief={contextBrief || visit.aiTriage?.patientBrief || visit.patientBrief} /> : <p>No pre-visit draft submitted. Continue with your own assessment.</p>}{visit.vitals?.recordedAt && <div className="mp-clinical-vitals"><h3>Recorded vitals</h3><dl>{[["Blood pressure", visit.vitals.bp], ["Temperature", visit.vitals.temperature], ["Pulse", visit.vitals.pulse], ["SpO2", visit.vitals.oxygenSat], ["Weight", visit.vitals.weight]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "Not recorded"}</dd></div>)}</dl></div>}<details className="mp-clinical-copilot"><summary>Optional clinician assistant</summary><p>Generated text is an unconfirmed draft. Care can continue without this assistant.</p><Field as="textarea" label="Assistant prompt" value={aiPrompt} onChange={event => setAiPrompt(event.target.value)} maxLength={2000} disabled={task.busy} /><Button variant="secondary" onClick={ask} disabled={blocked || !aiPrompt.trim()}>Ask Co-Pilot</Button>{suggestion && <div className="mp-clinical-suggestion"><StatusBadge tone="warning">Draft — clinician review needed</StatusBadge><p>{suggestion}</p></div>}</details></aside></div>

    <Dialog open={confirm} title="Complete this consultation?" onClose={() => { if (!task.busy) setConfirm(false); }}><p>Confirm completion for <strong>{clinicalPatientName(visit)}</strong>. {hospital ? "The current clinician notes will be saved with this transition." : "Unsaved clinician notes will be saved before completion."} The server checks the visit’s current revision.</p><Feedback feedback={task.feedback} /><div className="mp-actions"><Button variant="secondary" onClick={() => setConfirm(false)} disabled={task.busy} data-autofocus>Keep consultation open</Button><Button onClick={finish} disabled={blocked}>{task.busy ? "Recording..." : "Confirm completion"}</Button></div></Dialog></Card>;
}
