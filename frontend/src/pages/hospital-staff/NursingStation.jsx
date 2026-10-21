import { useAuth } from "../../context/AuthContext";
import { formatDoctorName } from "../../utils/appointments";
import { Banner, Button, Card, DataTable, Dialog, EmptyState, Field, LoadingState, StatusBadge } from "../../components/ui";
import { validateWalkIn } from "../../utils/visualSystem";
import { createSnapshotGuard } from "../../utils/queueSnapshot";
import { bookingRequestKey, clearBookingRequest } from "../../utils/bookingRequest";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import axios from "axios";
import { ClipboardPlus, RefreshCcw, Save, UserRound, ArrowRight, FileText, Send, CheckCircle2, XCircle } from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { getSocket } from "../../socket";

const NursingStation = () => {
  const { staffUser: staff, staffHospital: hospital, loader, isStaffAuth } = useAuth();
  const hospitalId = staff?.hospitalId || hospital?._id;
  const staffId = staff?._id || staff?.id;
  const isReceptionist = staff?.role === "RECEPTIONIST";

  const [formErrors, setFormErrors] = useState({});
  const [vitalsErrors, setVitalsErrors] = useState({});
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState("");
  const [savingVitals, setSavingVitals] = useState(false);
  const [arrivalPending, setArrivalPending] = useState(null);
  const [markingNoShow, setMarkingNoShow] = useState(false);
  const [doctorId, setDoctorId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [directory, setDirectory] = useState({ departments: [], staff: [] });
  const [sessionId, setSessionId] = useState("");
  const [queue, setQueue] = useState({ waiting: [], reservations: [], currentlyServing: null });
  const [queueSearch, setQueueSearch] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("info");
  const showError = (text) => { setMessage(text); setMessageTone("error"); };

  const [selectedToken, setSelectedToken] = useState(null);
  const [noShowConfirmToken, setNoShowConfirmToken] = useState(null);
  const [vitals, setVitals] = useState({ bp: "", temperature: "", pulse: "", oxygenSat: "", weight: "", height: "", chiefComplaint: "" });
  const [newToken, setNewToken] = useState({ name: "", phone: "", age: "", gender: "", chiefComplaint: "" });

  // Physical file custody worklist state
  const [custodyWorklist, setCustodyWorklist] = useState({ incoming: [], outgoing: [], held: [] });
  const [custodyLoading, setCustodyLoading] = useState(false);
  const [handoffModal, setHandoffModal] = useState(null);
  const [refuseModal, setRefuseModal] = useState(null);
  const [selectedRecipientId, setSelectedRecipientId] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [handoffReason, setHandoffReason] = useState("");
  const [refusalReason, setRefusalReason] = useState("");
  const [submittingCustody, setSubmittingCustody] = useState(false);
  const [hospitalLocations, setHospitalLocations] = useState([]);

  // Clean disposal on account or hospital switch
  const currentIdentity = `${hospitalId || ""}:${staffId || ""}`;
  const prevIdentityRef = useRef(currentIdentity);
  useEffect(() => {
    if (prevIdentityRef.current !== currentIdentity) {
      prevIdentityRef.current = currentIdentity;
      setQueue({ waiting: [], reservations: [], currentlyServing: null });
      setDirectory({ departments: [], staff: [] });
      setCustodyWorklist({ incoming: [], outgoing: [], held: [] });
      setHandoffModal(null);
      setRefuseModal(null);
      setSelectedToken(null);
      setNoShowConfirmToken(null);
      setMessage("");
      setQueueError("");
      setDoctorId("");
      setDepartmentId("");
      setQueueSearch("");
    }
  }, [currentIdentity]);

  const snapshotGuard = useRef(createSnapshotGuard());
  const loadQueue = useCallback(async () => {
    const ticket = snapshotGuard.current.begin(`${hospitalId}:${doctorId}:${sessionId}`);
    if (!hospitalId || !doctorId) return;
    const response = await axios.get(`${BACKEND_URL}/api/opd/${hospitalId}/${doctorId}/queue`, { params: { sessionId: sessionId || undefined }, withCredentials: true });
    if (snapshotGuard.current.accept(ticket, response.data)) {
      setQueue(response.data);
      setQueueLoading(false);
      setQueueError("");
    }
  }, [hospitalId, doctorId, sessionId]);

  const loadDirectory = useCallback(async () => {
    if (!hospitalId) return;
    const response = await axios.get(`${BACKEND_URL}/api/staff-messages/directory`, { withCredentials: true });
    const nextDirectory = response.data || { departments: [], staff: [] };
    setDirectory(nextDirectory);
    if (!departmentId) setDepartmentId(staff?.departmentIds?.[0] || nextDirectory.departments?.[0]?._id || "");
  }, [departmentId, hospitalId, staff?.departmentIds]);

  useEffect(() => {
    loadDirectory().catch((error) => showError(error.response?.data?.message || "Unable to load staff directory")).finally(() => setDirectoryLoading(false));
  }, [loadDirectory]);

  useEffect(() => {
    const doctors = directory.staff.filter((member) => member.role === "DOCTOR" && (!departmentId || member.departmentIds?.some((id) => String(id) === String(departmentId))));
    if (!doctorId && doctors[0]?._id) setDoctorId(doctors[0]._id);
  }, [departmentId, directory.staff, doctorId]);

  useEffect(() => {
    loadQueue().catch(() => { setQueueError("Unable to refresh the OPD queue. Try refreshing again."); setQueueLoading(false); });
  }, [loadQueue]);

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
  }, [hospitalId, isStaffAuth, loadQueue]);

  const issueToken = async (event) => {
    event.preventDefault();
    if (issuing) return;
    const errors = validateWalkIn(newToken);
    setFormErrors(errors);
    if (Object.keys(errors).length) {
      document.getElementById("walkin-" + Object.keys(errors)[0])?.focus();
      return;
    }
    const scope = `walkin:${staff?._id}:${hospitalId}:${departmentId}:${doctorId}`;
    setIssuing(true);
    setMessage("");
    setMessageTone("info");
    try {
      const requestKey = await bookingRequestKey(scope, newToken);
      const response = await axios.post(
        `${BACKEND_URL}/api/opd/${hospitalId}/${departmentId}/token`,
        {
          doctorId,
          sessionId: sessionId || queue.sessionId,
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
    } catch (error) {
      showError(error.response?.data?.message || "Check-in failed");
    } finally { setArrivalPending(null); }
  };

  const saveVitals = async (event) => {
    event.preventDefault();
    if (!selectedToken || savingVitals) return;
    const errors = {};
    for (const field of ["temperature", "pulse", "oxygenSat", "weight", "height"]) {
      if (vitals[field] !== "" && !Number.isFinite(Number(vitals[field]))) errors[field] = "Enter a valid number.";
    }
    setVitalsErrors(errors);
    if (Object.keys(errors).length) return;
    setSavingVitals(true);
    setMessage("");
    setMessageTone("info");
    try {
      await axios.patch(`${BACKEND_URL}/api/opd/tokens/${selectedToken._id}/vitals`, Object.fromEntries(Object.entries(vitals).filter(([, value]) => value !== "")), { withCredentials: true });
      setSelectedToken(null);
      setVitals({ bp: "", temperature: "", pulse: "", oxygenSat: "", weight: "", height: "", chiefComplaint: "" });
      await loadQueue();
    } catch (error) {
      showError(error.response?.data?.message || "Could not save vitals");
    } finally { setSavingVitals(false); }
  };

  const confirmNoShow = async () => {
    if (!noShowConfirmToken || markingNoShow) return;
    setMarkingNoShow(true);
    try {
      await axios.patch(`${BACKEND_URL}/api/opd/tokens/${noShowConfirmToken._id}/no-show`, {}, { withCredentials: true });
      setNoShowConfirmToken(null);
      await loadQueue();
    } catch (error) {
      showError(error.response?.data?.message || "Could not mark no-show");
    } finally {
      setMarkingNoShow(false);
    }
  };

  const loadCustodyWorklist = useCallback(async () => {
    if (!hospitalId || !isStaffAuth) return;
    setCustodyLoading(true);
    try {
      const res = await axios.get(`${BACKEND_URL}/api/encounters/custody/worklist`, { withCredentials: true });
      setCustodyWorklist(res.data.worklist || { incoming: [], outgoing: [], held: [] });
    } catch {
      // ignore
    } finally {
      setCustodyLoading(false);
    }
  }, [hospitalId, isStaffAuth]);

  const loadLocations = useCallback(async () => {
    if (!hospitalId || !isStaffAuth) return;
    try {
      const res = await axios.get(`${BACKEND_URL}/api/hospitals/${hospitalId}/locations`, { withCredentials: true });
      setHospitalLocations(res.data.locations || []);
    } catch {
      // ignore
    }
  }, [hospitalId, isStaffAuth]);

  useEffect(() => {
    loadCustodyWorklist();
    loadLocations();
  }, [loadCustodyWorklist, loadLocations]);

  const acceptHandoff = async (item) => {
    try {
      await axios.post(
        `${BACKEND_URL}/api/encounters/${item.encounterId}/accept-handoff`,
        { expectedRevision: item.revision },
        { withCredentials: true }
      );
      setMessage(`Accepted physical file for ticket ${item.ticketNumber}`);
      setMessageTone("positive");
      await loadCustodyWorklist();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to accept physical file");
    }
  };

  const submitRefusal = async () => {
    if (!refuseModal || !refusalReason.trim() || submittingCustody) return;
    setSubmittingCustody(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/encounters/${refuseModal.encounterId}/refuse`,
        { expectedRevision: refuseModal.revision, reason: refusalReason.trim() },
        { withCredentials: true }
      );
      setMessage(`Refused handoff for ticket ${refuseModal.ticketNumber}`);
      setMessageTone("info");
      setRefuseModal(null);
      setRefusalReason("");
      await loadCustodyWorklist();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to refuse file handoff");
    } finally {
      setSubmittingCustody(false);
    }
  };

  const submitHandoff = async () => {
    if (!handoffModal || !selectedRecipientId || submittingCustody) return;
    setSubmittingCustody(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/encounters/${handoffModal.encounterId}/handoff`,
        {
          expectedRevision: handoffModal.revision,
          toActorId: selectedRecipientId,
          locationId: selectedLocationId || undefined,
          reason: handoffReason.trim() || undefined,
        },
        { withCredentials: true }
      );
      setMessage(`Initiated handoff for ticket ${handoffModal.ticketNumber}`);
      setMessageTone("positive");
      setHandoffModal(null);
      setSelectedRecipientId("");
      setSelectedLocationId("");
      setHandoffReason("");
      await loadCustodyWorklist();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to initiate file handoff");
    } finally {
      setSubmittingCustody(false);
    }
  };

  const doctors = useMemo(() => directory.staff.filter((member) => member.role === "DOCTOR" && (!departmentId || member.departmentIds?.some((id) => String(id._id || id) === String(departmentId)))), [directory.staff, departmentId]);
  const resetQueue = () => { snapshotGuard.current.reset(); setQueue({ waiting: [], reservations: [], currentlyServing: null }); setQueueLoading(true); };

  const matchesFilter = useCallback((token) => {
    if (!queueSearch.trim()) return true;
    const q = queueSearch.trim().toLowerCase();
    const tokenNum = String(token.displayToken || token.tokenNumber || "").toLowerCase();
    const name = String(token.patientInfo?.name || "").toLowerCase();
    const phone = String(token.patientInfo?.phone || "").toLowerCase();
    return tokenNum.includes(q) || name.includes(q) || phone.includes(q);
  }, [queueSearch]);

  const waiting = useMemo(() => (queue.waiting?.filter((token) => token.status === "waiting") || []).filter(matchesFilter), [queue.waiting, matchesFilter]);
  const prepared = useMemo(() => (queue.waiting?.filter((token) => token.status === "vitals_done") || []).filter(matchesFilter), [queue.waiting, matchesFilter]);
  const reservations = useMemo(() => (queue.reservations || []).filter(matchesFilter), [queue.reservations, matchesFilter]);

  const rawWaitingCount = useMemo(() => (queue.waiting?.filter((token) => token.status === "waiting") || []).length, [queue.waiting]);
  const rawPreparedCount = useMemo(() => (queue.waiting?.filter((token) => token.status === "vitals_done") || []).length, [queue.waiting]);
  const rawReservationsCount = queue.reservations?.length || 0;

  if (loader) return <main className="mp-page"><LoadingState>Loading staff workspace...</LoadingState></main>;
  if (!hospitalId || !isStaffAuth) return <main className="mp-page"><Card><EmptyState title="Sign in to your hospital workspace" action={<Button to="/hospital/login">Staff sign in <ArrowRight size={16} /></Button>}>Use the staff account issued by your hospital to operate its OPD queue.</EmptyState></Card></main>;

  return (
    <main className="mp-page">
      <div className="mp-section-heading">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <p className="mp-eyebrow" style={{ margin: 0 }}>{hospital?.name || "Hospital OPD"}</p>
            <StatusBadge tone="info">{isReceptionist ? "Reception Desk" : "Nursing Station"}</StatusBadge>
          </div>
          <h1>Nursing Station</h1>
          <p>Coordinate arrivals, prepare vitals and keep the next step in care moving.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => loadQueue().catch(() => setQueueError("Unable to refresh the OPD queue."))}
          disabled={!doctorId}
        >
          <RefreshCcw size={16} />Refresh queue
        </Button>
      </div>

      {message && <Banner tone={messageTone}>{message}</Banner>}
      {queueError && <Banner>{queueError}</Banner>}

      <Card aria-label="Care context">
        <div className="mp-filter-grid" style={{ margin: 0 }}>
          <Field as="select" label="Department" value={departmentId} onChange={(event) => { resetQueue(); setDepartmentId(event.target.value); setDoctorId(""); }}>
            <option value="">Select department</option>
            {directory.departments.map((department) => <option key={department._id} value={department._id}>{department.name}</option>)}
          </Field>
          <Field as="select" label="Doctor" value={doctorId} onChange={(event) => { resetQueue(); setDoctorId(event.target.value); }}>
            <option value="">Select doctor</option>
            {doctors.map((doctor) => <option key={doctor._id} value={doctor._id}>{formatDoctorName(doctor)}</option>)}
          </Field>
          <Field as="select" label="Care session" value={sessionId || queue.sessionId || "day"} onChange={(event) => { resetQueue(); setSessionId(event.target.value); }}>
            {(queue.sessionIds || [queue.sessionId || "day"]).map((id) => <option key={id} value={id}>{id}</option>)}
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field
            label="Filter queue"
            placeholder="Search by token number, patient name, or phone..."
            value={queueSearch}
            onChange={(e) => setQueueSearch(e.target.value)}
          />
        </div>
      </Card>

      <div className="mp-summary-grid">
        <div className="mp-summary">
          <span>Awaiting arrival</span>
          <strong>{queueLoading ? "—" : rawReservationsCount}</strong>
        </div>
        <div className="mp-summary">
          <span>Waiting for vitals</span>
          <strong>{queueLoading ? "—" : rawWaitingCount}</strong>
        </div>
        <div className="mp-summary">
          <span>Ready for doctor</span>
          <strong>{queueLoading ? "—" : rawPreparedCount}</strong>
        </div>
      </div>

      <div className="mp-workspace-grid">
        <div className="mp-stack">
          {/* Reserved visits awaiting arrival */}
          <Card aria-label="Reserved visits awaiting arrival">
            <div className="mp-card-heading">
              <h2>Reserved visits awaiting arrival</h2>
              <StatusBadge tone="info">Check-in required</StatusBadge>
            </div>
            {directoryLoading || (queueLoading && doctorId) ? (
              <LoadingState>Loading reservations...</LoadingState>
            ) : !doctorId ? (
              <EmptyState title="Select a doctor to view the queue." />
            ) : (
              <DataTable
                caption="Reservation check-in"
                empty="No visits awaiting check-in."
                rows={reservations}
                columns={[
                  { key: "displayToken", label: "Token" },
                  { key: "patient", label: "Patient", render: (token) => token.patientInfo?.name || "Patient" },
                  {
                    key: "arrival",
                    label: "Arrival",
                    render: (token) => (
                      <Button size="small" disabled={Boolean(arrivalPending)} onClick={() => checkIn(token)}>
                        Confirm arrival
                      </Button>
                    ),
                  },
                ]}
              />
            )}
          </Card>

          {/* Waiting for Vitals */}
          <Card>
            <div className="mp-card-heading">
              <h2>Waiting for Vitals</h2>
              <UserRound size={20} />
            </div>
            {queueLoading && doctorId ? (
              <LoadingState>Loading the care queue...</LoadingState>
            ) : !waiting.length ? (
              <EmptyState title="No patients waiting for vitals.">
                Arrived patients appear here when reception confirms their arrival.
              </EmptyState>
            ) : (
              <div className="mp-stack">
                {waiting.map((token) => (
                  <div key={token._id}>
                    <div className="mp-card-heading">
                      <div className="mp-queue-person">
                        <span className="mp-avatar"><UserRound size={17} /></span>
                        <div>
                          <strong>{token.displayToken}</strong>
                          <p className="mp-field-hint">{token.patientInfo?.name || "Patient"}</p>
                        </div>
                      </div>
                      {isReceptionist ? (
                        <span className="mp-field-hint">Vitals recorded at nursing station</span>
                      ) : (
                        <Button
                          size="small"
                          onClick={() => {
                            setVitalsErrors({});
                            setSelectedToken(token);
                            setVitals({
                              bp: "",
                              temperature: "",
                              pulse: "",
                              oxygenSat: "",
                              weight: "",
                              height: "",
                              chiefComplaint: token.chiefComplaint || "",
                            });
                          }}
                        >
                          Record Vitals
                        </Button>
                      )}
                    </div>
                    <Button variant="danger" size="small" onClick={() => setNoShowConfirmToken(token)}>
                      Mark no-show
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Vitals Done */}
          <Card>
            <div className="mp-card-heading">
              <h2>Vitals Done</h2>
              <StatusBadge tone="positive">Ready for doctor</StatusBadge>
            </div>
            {!prepared.length ? (
              <EmptyState title="No completed vitals yet." />
            ) : (
              <DataTable
                caption="Patients ready for consultation"
                rows={prepared}
                columns={[
                  { key: "displayToken", label: "Token" },
                  { key: "patient", label: "Patient", render: (token) => token.patientInfo?.name || "Patient" },
                  { key: "status", label: "Status", render: (token) => <StatusBadge status={token.status} /> },
                ]}
              />
            )}
          </Card>

          {/* Physical File Custody Worklist */}
          <Card aria-label="Physical File Custody">
            <div className="mp-card-heading">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <FileText size={20} style={{ color: "var(--mp-primary)" }} />
                <h2>Physical File Custody</h2>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {custodyWorklist.incoming.length > 0 && (
                  <StatusBadge tone="warning">
                    {custodyWorklist.incoming.length} incoming transfer{custodyWorklist.incoming.length > 1 ? "s" : ""}
                  </StatusBadge>
                )}
                <Button size="small" variant="secondary" onClick={loadCustodyWorklist} disabled={custodyLoading}>
                  <RefreshCcw size={14} /> Refresh
                </Button>
              </div>
            </div>

            {/* Incoming Handoffs Awaiting Recipient Acknowledgement */}
            {custodyWorklist.incoming.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: "0.95rem", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <Send size={15} style={{ color: "var(--mp-warning)" }} /> Incoming Transfers Awaiting Your Acceptance
                </h3>
                <DataTable
                  caption="Incoming physical file handoffs"
                  rows={custodyWorklist.incoming}
                  columns={[
                    { key: "ticketNumber", label: "Ticket / File", render: (item) => <strong>{item.ticketNumber} · {item.fileBarcode || "No barcode"}</strong> },
                    { key: "from", label: "From", render: (item) => `${item.fromActorName} (${item.fromActorRole})` },
                    { key: "location", label: "Location", render: (item) => item.toLocationName || "not recorded" },
                    { key: "reason", label: "Reason", render: (item) => item.reason || "—" },
                    {
                      key: "actions",
                      label: "Actions",
                      render: (item) => (
                        <div style={{ display: "flex", gap: 6 }}>
                          <Button size="small" onClick={() => acceptHandoff(item)}>
                            <CheckCircle2 size={14} /> Accept
                          </Button>
                          <Button size="small" variant="secondary" onClick={() => { setRefuseModal(item); setRefusalReason(""); }}>
                            <XCircle size={14} /> Refuse
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            )}

            {/* Files currently in staff's custody */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: "0.95rem", marginBottom: 8 }}>
                Files in Your Custody ({custodyWorklist.held.length})
              </h3>
              {!custodyWorklist.held.length ? (
                <EmptyState title="No physical files currently in your custody." />
              ) : (
                <DataTable
                  caption="Files held in your physical custody"
                  rows={custodyWorklist.held}
                  columns={[
                    { key: "ticketNumber", label: "Ticket", render: (item) => <strong>{item.ticketNumber}</strong> },
                    { key: "fileBarcode", label: "Barcode", render: (item) => item.fileBarcode || "—" },
                    { key: "locationName", label: "Desk / Location", render: (item) => item.locationName || "not recorded" },
                    {
                      key: "transfer",
                      label: "Handoff",
                      render: (item) => item.hasPendingOutgoing ? (
                        <StatusBadge tone="info">Transfer Pending</StatusBadge>
                      ) : (
                        <Button size="small" variant="secondary" onClick={() => { setHandoffModal(item); setSelectedRecipientId(""); setSelectedLocationId(""); setHandoffReason(""); }}>
                          <Send size={14} /> Transfer File
                        </Button>
                      ),
                    },
                  ]}
                />
              )}
            </div>

            {/* Outgoing Transfers pending recipient */}
            {custodyWorklist.outgoing.length > 0 && (
              <div>
                <h3 style={{ fontSize: "0.95rem", marginBottom: 8 }}>
                  Outgoing Transfers Pending Acknowledgement ({custodyWorklist.outgoing.length})
                </h3>
                <DataTable
                  caption="Pending outgoing handoffs"
                  rows={custodyWorklist.outgoing}
                  columns={[
                    { key: "ticketNumber", label: "Ticket / Barcode", render: (item) => `${item.ticketNumber} · ${item.fileBarcode || "—"}` },
                    { key: "to", label: "Recipient", render: (item) => `${item.toActorName} (${item.toActorRole})` },
                    { key: "status", label: "Status", render: () => <StatusBadge tone="warning">Awaiting Recipient</StatusBadge> },
                  ]}
                />
              </div>
            )}
          </Card>
        </div>

        {/* Issue Walk-in Token form */}
        <Card as="form" onSubmit={issueToken} noValidate>
          <div className="mp-card-heading">
            <h2>Issue Walk-in Token</h2>
            <ClipboardPlus size={21} />
          </div>
          <p className="mp-field-hint" style={{ marginBottom: 22 }}>
            For a patient already at the hospital. Confirm the care context before issuing a token.
          </p>
          <div className="mp-form-grid">
            <Field
              id="walkin-name"
              label="Patient name"
              required
              error={formErrors.name}
              value={newToken.name}
              autoComplete="off"
              maxLength={120}
              onChange={(event) => setNewToken({ ...newToken, name: event.target.value })}
            />
            <Field
              id="walkin-phone"
              label="Phone"
              type="tel"
              error={formErrors.phone}
              value={newToken.phone}
              onChange={(event) => setNewToken({ ...newToken, phone: event.target.value })}
            />
            <div className="mp-form-row">
              <Field
                id="walkin-age"
                label="Age"
                type="number"
                error={formErrors.age}
                min="0"
                max="130"
                value={newToken.age}
                onChange={(event) => setNewToken({ ...newToken, age: event.target.value })}
              />
              <Field
                as="select"
                label="Gender"
                value={newToken.gender}
                onChange={(event) => setNewToken({ ...newToken, gender: event.target.value })}
              >
                <option value="">Not supplied</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </Field>
            </div>
            <Field
              as="textarea"
              label="Chief complaint"
              value={newToken.chiefComplaint}
              onChange={(event) => setNewToken({ ...newToken, chiefComplaint: event.target.value })}
            />
            <Button type="submit" disabled={issuing || !doctorId || !departmentId}>
              {issuing ? "Issuing token..." : "Issue Token"}
            </Button>
          </div>
        </Card>
      </div>

      {/* Record Vitals Dialog */}
      <Dialog
        open={Boolean(selectedToken)}
        onClose={() => setSelectedToken(null)}
        title={"Record Vitals: " + (selectedToken?.displayToken || "")}
      >
        <form onSubmit={saveVitals} noValidate>
          <div className="mp-form-grid">
            <Field
              label="Blood pressure"
              data-autofocus
              placeholder="e.g. 120/80"
              value={vitals.bp}
              onChange={(event) => setVitals({ ...vitals, bp: event.target.value })}
            />
            <div className="mp-form-row">
              {[
                ["temperature", "Temperature (°F)"],
                ["pulse", "Pulse (bpm)"],
                ["oxygenSat", "SpO2 (%)"],
                ["weight", "Weight (kg)"],
                ["height", "Height (cm)"],
              ].map(([field, label]) => (
                <Field
                  key={field}
                  label={label}
                  type="number"
                  step="any"
                  error={vitalsErrors[field]}
                  value={vitals[field]}
                  onChange={(event) => setVitals({ ...vitals, [field]: event.target.value })}
                />
              ))}
            </div>
            <Field
              as="textarea"
              label="Chief complaint"
              value={vitals.chiefComplaint}
              onChange={(event) => setVitals({ ...vitals, chiefComplaint: event.target.value })}
            />
          </div>
          <div className="mp-actions">
            <Button variant="secondary" onClick={() => setSelectedToken(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={savingVitals}>
              <Save size={16} />
              {savingVitals ? "Saving..." : "Save Vitals"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* No-show Confirmation Dialog */}
      <Dialog
        open={Boolean(noShowConfirmToken)}
        onClose={() => setNoShowConfirmToken(null)}
        title={`Confirm No-Show: ${noShowConfirmToken?.displayToken || ""}`}
      >
        <div className="mp-stack">
          <p>
            Are you sure you want to mark token <strong>{noShowConfirmToken?.displayToken}</strong> (
            {noShowConfirmToken?.patientInfo?.name || "Patient"}) as a no-show?
          </p>
          <p className="mp-field-hint">
            This will remove the patient from the active waiting queue and cancel their turn.
          </p>
          <div className="mp-actions">
            <Button variant="secondary" onClick={() => setNoShowConfirmToken(null)} disabled={markingNoShow}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmNoShow} disabled={markingNoShow}>
              {markingNoShow ? "Marking..." : "Confirm No-Show"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Transfer Physical File Dialog */}
      <Dialog
        open={Boolean(handoffModal)}
        onClose={() => setHandoffModal(null)}
        title={`Transfer Physical File: ${handoffModal?.ticketNumber || ""}`}
      >
        <div className="mp-stack">
          <p className="mp-field-hint">
            Select the recipient staff member. File custody remains with you until the recipient explicitly accepts it.
          </p>
          <Field
            as="select"
            label="Recipient Staff Member"
            required
            value={selectedRecipientId}
            onChange={(e) => setSelectedRecipientId(e.target.value)}
          >
            <option value="">Select recipient...</option>
            {directory.staff
              .filter((m) => String(m._id) !== String(staffId) && m.isActive)
              .map((member) => (
                <option key={member._id} value={member._id}>
                  {member.name} ({member.role})
                </option>
              ))}
          </Field>
          <Field
            as="select"
            label="Destination Desk / Room (Optional)"
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
          >
            <option value="">Select destination location...</option>
            {hospitalLocations
              .filter((loc) => loc.status === "active")
              .map((loc) => (
                <option key={loc._id} value={loc._id}>
                  {loc.name} {loc.roomNumber ? `(${loc.roomNumber})` : ""}
                </option>
              ))}
          </Field>
          <Field
            label="Handoff reason or notes"
            placeholder="e.g. Sent for doctor consultation"
            value={handoffReason}
            onChange={(e) => setHandoffReason(e.target.value)}
          />
          <div className="mp-actions">
            <Button variant="secondary" onClick={() => setHandoffModal(null)} disabled={submittingCustody}>
              Cancel
            </Button>
            <Button onClick={submitHandoff} disabled={!selectedRecipientId || submittingCustody}>
              <Send size={16} />
              {submittingCustody ? "Initiating..." : "Initiate Handoff"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Refuse Handoff Dialog */}
      <Dialog
        open={Boolean(refuseModal)}
        onClose={() => setRefuseModal(null)}
        title={`Refuse Physical File Handoff: ${refuseModal?.ticketNumber || ""}`}
      >
        <div className="mp-stack">
          <p>
            Refuse physical file transfer from <strong>{refuseModal?.fromActorName}</strong> ({refuseModal?.fromActorRole}).
          </p>
          <p className="mp-field-hint">
            Custody will remain with the sender. An audit reason is required for safety.
          </p>
          <Field
            as="textarea"
            label="Refusal reason"
            required
            placeholder="e.g. Patient not yet in examination room, or sent to wrong clinician"
            value={refusalReason}
            onChange={(e) => setRefusalReason(e.target.value)}
          />
          <div className="mp-actions">
            <Button variant="secondary" onClick={() => setRefuseModal(null)} disabled={submittingCustody}>
              Cancel
            </Button>
            <Button variant="danger" onClick={submitRefusal} disabled={!refusalReason.trim() || submittingCustody}>
              <XCircle size={16} />
              {submittingCustody ? "Submitting..." : "Confirm Refusal"}
            </Button>
          </div>
        </div>
      </Dialog>
    </main>
  );
};

export default NursingStation;
