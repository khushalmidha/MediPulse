/* eslint-disable react/prop-types */
import { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import {
  Siren,
  Clock,
  AlertCircle,
  Plus,
  RefreshCw,
  CheckCircle2,
  Calendar,
  Scissors,
  CheckSquare,
  Activity,
} from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { useAuth } from "../../context/AuthContext";
import { Banner, Button, Card, Dialog, EmptyState, Field, LoadingState, StatusBadge } from "../../components/ui";

const TRIAGE_LEVELS = {
  1: { level: 1, code: "RESUSCITATION", name: "Immediate Resuscitation", maxWait: "0 min", tone: "danger", bg: "#FEF2F2", border: "#F87171" },
  2: { level: 2, code: "EMERGENT", name: "Very Urgent", maxWait: "10 min", tone: "warning", bg: "#FFF7ED", border: "#FB923C" },
  3: { level: 3, code: "URGENT", name: "Urgent", maxWait: "30 min", tone: "warning", bg: "#FEFCE8", border: "#FACC15" },
  4: { level: 4, code: "LESS_URGENT", name: "Less Urgent", maxWait: "60 min", tone: "positive", bg: "#F0FDF4", border: "#4ADE80" },
  5: { level: 5, code: "NON_URGENT", name: "Non-Urgent", maxWait: "120 min", tone: "info", bg: "var(--mp-accent-soft)", border: "#60A5FA" },
};

const STATUS_TONES = {
  triaged: "info",
  in_treatment: "warning",
  admitted_ipd: "positive",
  transferred_out: "neutral",
  discharged: "neutral",
  deceased: "danger",
  scheduled: "info",
  in_progress: "warning",
  completed: "positive",
  cancelled: "danger",
};

export default function EmergencyTheatreConsole({ initialTab = "emergency" }) {
  const { staffUser, isStaffAuth } = useAuth();
  if (!isStaffAuth) {
    return (
      <main className="mp-page mp-enterprise">
        <Card>
          <h1>Hospital Staff Authentication Required</h1>
          <p>Please sign in with your hospital staff account to access Emergency Department and Theatre operations.</p>
        </Card>
      </main>
    );
  }
  return <EmergencyTheatreWorkspace key={`${staffUser?._id || staffUser?.id}:${staffUser?.hospitalId}:${staffUser?.role}:${Boolean(staffUser?.adminAccess)}`} initialTab={initialTab} />;
}

function EmergencyTheatreWorkspace({ initialTab = "emergency" }) {
  const { staffUser } = useAuth();
  const isAdmin = staffUser?.role === "HOSPITAL_ADMIN" || Boolean(staffUser?.adminAccess);
  const isDoctor = staffUser?.role === "DOCTOR" || isAdmin;

  const [activeTab, setActiveTab] = useState(initialTab);
  const [feedback, setFeedback] = useState(null);

  // ED state
  const [registrations, setRegistrations] = useState([]);
  const [edLoading, setEdLoading] = useState(false);
  const [edStatusFilter, setEdStatusFilter] = useState("all");
  const [triageFilter, setTriageFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [intakeModalOpen, setIntakeModalOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [selectedReg, setSelectedReg] = useState(null);

  // OT state
  const [theatres, setTheatres] = useState([]);
  const [otSchedules, setOtSchedules] = useState([]);
  const [otLoading, setOtLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedTheatreFilter, setSelectedTheatreFilter] = useState("all");
  const [otStatusFilter, setOtStatusFilter] = useState("all");
  const [bookModalOpen, setBookModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [createTheatreModalOpen, setCreateTheatreModalOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);

  // WHO Checklist & PACU state
  const [activeChecklistBookingId, setActiveChecklistBookingId] = useState("");

  const authHeaders = useMemo(() => {
    return {
      withCredentials: true,
      headers: staffUser?.token ? { Authorization: `Bearer ${staffUser.token}` } : {},
    };
  }, [staffUser]);

  // Load ED Registrations
  const loadRegistrations = useCallback(async () => {
    setEdLoading(true);
    try {
      const params = new URLSearchParams();
      if (edStatusFilter !== "all") params.set("status", edStatusFilter);
      if (triageFilter !== "all") params.set("triageLevel", triageFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      const res = await axios.get(`${BACKEND_URL}/api/emergency/registrations?${params.toString()}`, authHeaders);
      setRegistrations(res.data?.registrations || []);
    } catch (err) {
      setFeedback({ tone: "danger", message: err.response?.data?.error || "Failed to load emergency registrations" });
    } finally {
      setEdLoading(false);
    }
  }, [authHeaders, edStatusFilter, triageFilter, searchQuery]);

  // Load Theatres
  const loadTheatres = useCallback(async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/api/emergency/theatres`, authHeaders);
      setTheatres(res.data?.rooms || []);
    } catch {
      // Non-blocking
    }
  }, [authHeaders]);

  // Load OT Schedules
  const loadOtSchedules = useCallback(async () => {
    setOtLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedDate) params.set("date", selectedDate);
      if (selectedTheatreFilter !== "all") params.set("theatreRoomId", selectedTheatreFilter);
      if (otStatusFilter !== "all") params.set("status", otStatusFilter);
      const res = await axios.get(`${BACKEND_URL}/api/emergency/bookings?${params.toString()}`, authHeaders);
      const list = res.data?.schedules || [];
      setOtSchedules(list);
      if (!activeChecklistBookingId && list.length > 0) {
        setActiveChecklistBookingId(list[0]._id);
      }
    } catch (err) {
      setFeedback({ tone: "danger", message: err.response?.data?.error || "Failed to load operation theatre schedules" });
    } finally {
      setOtLoading(false);
    }
  }, [authHeaders, selectedDate, selectedTheatreFilter, otStatusFilter, activeChecklistBookingId]);

  useEffect(() => {
    loadRegistrations();
    loadTheatres();
    loadOtSchedules();
  }, [loadRegistrations, loadTheatres, loadOtSchedules]);

  // ED Stats
  const edStats = useMemo(() => {
    const total = registrations.length;
    const l1 = registrations.filter((r) => r.triageLevel === 1 && ["triaged", "in_treatment"].includes(r.status)).length;
    const l2 = registrations.filter((r) => r.triageLevel === 2 && ["triaged", "in_treatment"].includes(r.status)).length;
    const l3 = registrations.filter((r) => r.triageLevel === 3 && ["triaged", "in_treatment"].includes(r.status)).length;
    const inTreatment = registrations.filter((r) => r.status === "in_treatment").length;
    const admittedIpd = registrations.filter((r) => r.status === "admitted_ipd").length;
    return { total, l1, l2, l3, inTreatment, admittedIpd };
  }, [registrations]);

  // OT Stats
  const otStats = useMemo(() => {
    const total = otSchedules.length;
    const scheduled = otSchedules.filter((s) => s.status === "scheduled").length;
    const inProgress = otSchedules.filter((s) => s.status === "in_progress").length;
    const completed = otSchedules.filter((s) => s.status === "completed").length;
    return { total, scheduled, inProgress, completed };
  }, [otSchedules]);

  const activeChecklistBooking = useMemo(() => {
    return otSchedules.find((s) => s._id === activeChecklistBookingId) || null;
  }, [otSchedules, activeChecklistBookingId]);

  const openStatusModal = (reg) => {
    setSelectedReg(reg);
    setStatusModalOpen(true);
  };

  const openChecklistForBooking = (bookingId) => {
    setActiveChecklistBookingId(bookingId);
    setActiveTab("checklist");
  };

  const openCancelModal = (booking) => {
    setSelectedBooking(booking);
    setCancelModalOpen(true);
  };

  return (
    <main className="mp-page mp-enterprise" style={{ maxWidth: 1400, margin: "0 auto", padding: "1.5rem" }}>
      {/* Header */}
      <header style={{ marginBottom: "1.5rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.875rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Siren style={{ color: "#DC2626" }} /> Emergency & Operation Theatre Console
          </h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--mp-muted)" }}>
            5-Level Emergency Triage Intake, Resuscitation Bay Tracking & WHO Surgical Safety Checklist Workflows
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <StatusBadge tone={isAdmin ? "positive" : isDoctor ? "info" : "neutral"}>
            {staffUser?.role} • {staffUser?.name || "Staff"}
          </StatusBadge>
          <Button
            variant="outline"
            onClick={() => {
              loadRegistrations();
              loadOtSchedules();
            }}
          >
            <RefreshCw size={16} /> Refresh
          </Button>
        </div>
      </header>

      {feedback && (
        <div style={{ marginBottom: "1rem" }}>
          <Banner tone={feedback.tone} onDismiss={() => setFeedback(null)}>
            {feedback.message}
          </Banner>
        </div>
      )}

      {/* Tabs */}
      <nav className="mp-enterprise-tabs" style={{ display: "flex", gap: "0.5rem", borderBottom: "2px solid var(--mp-border)", marginBottom: "1.5rem" }}>
        <button
          type="button"
          onClick={() => setActiveTab("emergency")}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            border: "none",
            background: "none",
            borderBottom: activeTab === "emergency" ? "3px solid #DC2626" : "3px solid transparent",
            color: activeTab === "emergency" ? "#DC2626" : "var(--mp-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <Siren size={18} /> Emergency & Triage (ED)
          {edStats.l1 > 0 && <span style={{ background: "#DC2626", color: "#FFF", borderRadius: "999px", padding: "0.1rem 0.4rem", fontSize: "0.75rem" }}>{edStats.l1} L1</span>}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("theatre")}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            border: "none",
            background: "none",
            borderBottom: activeTab === "theatre" ? "3px solid #0D9488" : "3px solid transparent",
            color: activeTab === "theatre" ? "#0D9488" : "var(--mp-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <Scissors size={18} /> Theatre Schedules (OT)
          {otStats.inProgress > 0 && <span style={{ background: "#EA580C", color: "#FFF", borderRadius: "999px", padding: "0.1rem 0.4rem", fontSize: "0.75rem" }}>{otStats.inProgress} Live</span>}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("checklist")}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            border: "none",
            background: "none",
            borderBottom: activeTab === "checklist" ? "3px solid var(--mp-primary)" : "3px solid transparent",
            color: activeTab === "checklist" ? "var(--mp-primary)" : "var(--mp-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <CheckSquare size={18} /> WHO Checklist & PACU Recovery
        </button>
      </nav>

      {/* TAB 1: EMERGENCY & TRIAGE */}
      {activeTab === "emergency" && (
        <section>
          {/* Metrics bar */}
          <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
            <Card style={{ borderLeft: "4px solid #DC2626" }}>
              <div style={{ fontSize: "0.875rem", color: "var(--mp-muted)", fontWeight: 600 }}>Level 1: Resuscitation</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#DC2626" }}>{edStats.l1}</div>
              <div style={{ fontSize: "0.75rem", color: "#94A3B8" }}>Immediate care (0m wait)</div>
            </Card>
            <Card style={{ borderLeft: "4px solid #EA580C" }}>
              <div style={{ fontSize: "0.875rem", color: "var(--mp-muted)", fontWeight: 600 }}>Level 2: Emergent</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#EA580C" }}>{edStats.l2}</div>
              <div style={{ fontSize: "0.75rem", color: "#94A3B8" }}>Within 10 min</div>
            </Card>
            <Card style={{ borderLeft: "4px solid #EAB308" }}>
              <div style={{ fontSize: "0.875rem", color: "var(--mp-muted)", fontWeight: 600 }}>Level 3: Urgent</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#CA8A04" }}>{edStats.l3}</div>
              <div style={{ fontSize: "0.75rem", color: "#94A3B8" }}>Within 30 min</div>
            </Card>
            <Card style={{ borderLeft: "4px solid #0D9488" }}>
              <div style={{ fontSize: "0.875rem", color: "var(--mp-muted)", fontWeight: 600 }}>In Treatment</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#0D9488" }}>{edStats.inTreatment}</div>
              <div style={{ fontSize: "0.75rem", color: "#94A3B8" }}>Active acute care</div>
            </Card>
            <Card style={{ borderLeft: "4px solid #3B82F6" }}>
              <div style={{ fontSize: "0.875rem", color: "var(--mp-muted)", fontWeight: 600 }}>Admitted to IPD</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#3B82F6" }}>{edStats.admittedIpd}</div>
              <div style={{ fontSize: "0.75rem", color: "#94A3B8" }}>Transferred to ward</div>
            </Card>
          </div>

          {/* Action & Filter bar */}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <label style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                Status:
                <select
                  value={edStatusFilter}
                  onChange={(e) => setEdStatusFilter(e.target.value)}
                  style={{ marginLeft: "0.5rem", padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
                >
                  <option value="all">All Statuses</option>
                  <option value="triaged">Triaged (Waiting)</option>
                  <option value="in_treatment">In Treatment</option>
                  <option value="admitted_ipd">Admitted to IPD</option>
                  <option value="transferred_out">Transferred Out</option>
                  <option value="discharged">Discharged</option>
                </select>
              </label>

              <label style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                Triage:
                <select
                  value={triageFilter}
                  onChange={(e) => setTriageFilter(e.target.value)}
                  style={{ marginLeft: "0.5rem", padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
                >
                  <option value="all">All Triage Levels</option>
                  <option value="1">Level 1: Resuscitation (0m)</option>
                  <option value="2">Level 2: Emergent (10m)</option>
                  <option value="3">Level 3: Urgent (30m)</option>
                  <option value="4">Level 4: Less Urgent (60m)</option>
                  <option value="5">Level 5: Non-Urgent (120m)</option>
                </select>
              </label>

              <input
                type="text"
                placeholder="Search patient, complaint, moniker..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ padding: "0.4rem 0.8rem", borderRadius: "6px", border: "1px solid #CBD5E1", minWidth: 220 }}
              />
            </div>

            <Button variant="primary" onClick={() => setIntakeModalOpen(true)}>
              <Plus size={16} /> Triage Intake (New Patient)
            </Button>
          </div>

          {/* Table */}
          {edLoading ? (
            <LoadingState label="Loading emergency department patients..." />
          ) : registrations.length === 0 ? (
            <EmptyState
              title="No Emergency Patients"
              description="No emergency registrations found matching your filter criteria."
              action={<Button variant="outline" onClick={() => setIntakeModalOpen(true)}>Register Emergency Patient</Button>}
            />
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid var(--mp-border)", borderRadius: "8px", background: "#FFF" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "var(--mp-surface-subtle)", borderBottom: "2px solid var(--mp-border)" }}>
                    <th style={{ padding: "0.75rem 1rem" }}>Acuity / Triage</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Patient / Trauma Moniker</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Arrival & Bay</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Chief Complaint</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Attending Doctor</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Status</th>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {registrations.map((r) => {
                    const triage = TRIAGE_LEVELS[r.triageLevel] || TRIAGE_LEVELS[3];
                    return (
                      <tr key={r._id} style={{ borderBottom: "1px solid var(--mp-surface-muted)" }}>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div
                            style={{
                              display: "inline-block",
                              padding: "0.3rem 0.6rem",
                              borderRadius: "6px",
                              backgroundColor: triage.bg,
                              border: `1px solid ${triage.border}`,
                              fontWeight: 700,
                              fontSize: "0.75rem",
                              color: triage.border,
                            }}
                          >
                            L{r.triageLevel} • {triage.code}
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "var(--mp-muted)", marginTop: "2px" }}>
                            Max wait: {triage.maxWait}
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div style={{ fontWeight: 600, color: "var(--mp-text)" }}>{r.patientName}</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>
                            {r.emergencyNumber} • {r.age ? `${r.age}y` : "Age unk"} • {r.gender}
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontWeight: 500 }}>
                            {r.arrivalMode === "ambulance" && <Siren size={14} color="#DC2626" />}
                            <span style={{ textTransform: "capitalize" }}>{r.arrivalMode.replace("_", " ")}</span>
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "#0D9488", fontWeight: 600 }}>
                            {r.assignedBay || "Unassigned"}
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "#94A3B8" }}>
                            {new Date(r.arrivalTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem 1rem", maxWidth: 280 }}>
                          <div style={{ color: "var(--mp-text)", fontWeight: 500 }}>{r.chiefComplaint}</div>
                          {r.outcomeNotes && (
                            <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)", fontStyle: "italic", marginTop: "2px" }}>
                              Note: {r.outcomeNotes}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          {r.attendingDoctorId ? (
                            <div>
                              <div style={{ fontWeight: 500 }}>Dr. {r.attendingDoctorId.firstName} {r.attendingDoctorId.lastName}</div>
                              <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>{r.attendingDoctorId.specialization}</div>
                            </div>
                          ) : (
                            <span style={{ color: "#94A3B8", fontStyle: "italic" }}>Pending doctor</span>
                          )}
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <StatusBadge tone={STATUS_TONES[r.status] || "neutral"}>
                            {r.status.replace("_", " ").toUpperCase()}
                          </StatusBadge>
                        </td>
                        <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                            <Button size="small" variant="outline" onClick={() => openStatusModal(r)}>
                              Update Status
                            </Button>
                            {isDoctor && (
                              <Button
                                size="small"
                                variant="outline"
                                onClick={() => {
                                  setSelectedReg(r);
                                  setBookModalOpen(true);
                                }}
                              >
                                Book OT
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 2: THEATRE SCHEDULES */}
      {activeTab === "theatre" && (
        <section>
          {/* OT Metrics */}
          <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
            <Card style={{ borderLeft: "4px solid #0D9488" }}>
              <div style={{ fontSize: "0.875rem", color: "var(--mp-muted)", fontWeight: 600 }}>Total Cases Today</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#0D9488" }}>{otStats.total}</div>
            </Card>
            <Card style={{ borderLeft: "4px solid #3B82F6" }}>
              <div style={{ fontSize: "0.875rem", color: "var(--mp-muted)", fontWeight: 600 }}>Scheduled (Upcoming)</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#3B82F6" }}>{otStats.scheduled}</div>
            </Card>
            <Card style={{ borderLeft: "4px solid #EA580C" }}>
              <div style={{ fontSize: "0.875rem", color: "var(--mp-muted)", fontWeight: 600 }}>In Surgery Now</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#EA580C" }}>{otStats.inProgress}</div>
            </Card>
            <Card style={{ borderLeft: "4px solid #16A34A" }}>
              <div style={{ fontSize: "0.875rem", color: "var(--mp-muted)", fontWeight: 600 }}>Completed / In PACU</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#16A34A" }}>{otStats.completed}</div>
            </Card>
          </div>

          {/* Action & Filter Bar */}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <label style={{ fontSize: "0.875rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <Calendar size={16} /> Date:
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{ marginLeft: "0.25rem", padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
                />
              </label>

              <label style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                Theatre Suite:
                <select
                  value={selectedTheatreFilter}
                  onChange={(e) => setSelectedTheatreFilter(e.target.value)}
                  style={{ marginLeft: "0.5rem", padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
                >
                  <option value="all">All Suites</option>
                  {theatres.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.theatreCode} ({t.theatreName})
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                Status:
                <select
                  value={otStatusFilter}
                  onChange={(e) => setOtStatusFilter(e.target.value)}
                  style={{ marginLeft: "0.5rem", padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
                >
                  <option value="all">All Statuses</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              {isAdmin && (
                <Button variant="outline" onClick={() => setCreateTheatreModalOpen(true)}>
                  <Plus size={16} /> New Theatre Suite
                </Button>
              )}
              {isDoctor && (
                <Button variant="primary" onClick={() => setBookModalOpen(true)}>
                  <Plus size={16} /> Book Surgery Case
                </Button>
              )}
            </div>
          </div>

          {/* Schedules Table */}
          {otLoading ? (
            <LoadingState label="Loading theatre schedules..." />
          ) : otSchedules.length === 0 ? (
            <EmptyState
              title="No Theatre Cases Scheduled"
              description="No surgical cases booked for the selected date and filters."
              action={
                isDoctor ? (
                  <Button variant="outline" onClick={() => setBookModalOpen(true)}>
                    Book Theatre Case
                  </Button>
                ) : null
              }
            />
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid var(--mp-border)", borderRadius: "8px", background: "#FFF" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "var(--mp-surface-subtle)", borderBottom: "2px solid var(--mp-border)" }}>
                    <th style={{ padding: "0.75rem 1rem" }}>Booking / Urgency</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Theatre Suite</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Scheduled Window</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Procedure & Patient</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Surgical Team</th>
                    <th style={{ padding: "0.75rem 1rem" }}>WHO Checklist</th>
                    <th style={{ padding: "0.75rem 1rem" }}>Status</th>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {otSchedules.map((s) => {
                    const startStr = new Date(s.scheduledStartTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    const endStr = new Date(s.scheduledEndTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    const signInOk = s.whoChecklist?.signIn?.completed;
                    const timeOutOk = s.whoChecklist?.timeOut?.completed;
                    const signOutOk = s.whoChecklist?.signOut?.completed;

                    return (
                      <tr key={s._id} style={{ borderBottom: "1px solid var(--mp-surface-muted)" }}>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div style={{ fontWeight: 600, color: "var(--mp-text)" }}>{s.bookingNumber}</div>
                          <StatusBadge tone={s.urgency === "emergency_stat" ? "danger" : s.urgency === "urgent" ? "warning" : "neutral"}>
                            {s.urgency.replace("_", " ").toUpperCase()}
                          </StatusBadge>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div style={{ fontWeight: 600 }}>{s.theatreRoomId?.theatreCode || "OT"}</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>{s.theatreRoomId?.theatreName}</div>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div style={{ fontWeight: 600 }}>{startStr} – {endStr}</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>
                            {new Date(s.scheduledStartTime).toLocaleDateString()}
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem 1rem", maxWidth: 220 }}>
                          <div style={{ fontWeight: 600, color: "#0F766E" }}>{s.procedureName}</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>
                            Patient: {s.patientId ? `${s.patientId.firstName} ${s.patientId.lastName}` : "Registered Patient"}
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div style={{ fontSize: "0.8rem" }}>
                            <strong>Surgeon:</strong> Dr. {s.leadSurgeonDoctorId?.firstName} {s.leadSurgeonDoctorId?.lastName}
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "var(--mp-muted)" }}>
                            <strong>Anesth:</strong> Dr. {s.anesthetistDoctorId?.firstName} {s.anesthetistDoctorId?.lastName}
                          </div>
                          {s.scrubNurseStaffId && (
                            <div style={{ fontSize: "0.75rem", color: "#94A3B8" }}>
                              Nurse: {s.scrubNurseStaffId.name}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                            <span title="Sign In" style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem", borderRadius: "4px", background: signInOk ? "#DCFCE7" : "var(--mp-surface-muted)", color: signInOk ? "#16A34A" : "#94A3B8", fontWeight: 700 }}>
                              In: {signInOk ? "✓" : "—"}
                            </span>
                            <span title="Time Out" style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem", borderRadius: "4px", background: timeOutOk ? "#DCFCE7" : "var(--mp-surface-muted)", color: timeOutOk ? "#16A34A" : "#94A3B8", fontWeight: 700 }}>
                              TO: {timeOutOk ? "✓" : "—"}
                            </span>
                            <span title="Sign Out" style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem", borderRadius: "4px", background: signOutOk ? "#DCFCE7" : "var(--mp-surface-muted)", color: signOutOk ? "#16A34A" : "#94A3B8", fontWeight: 700 }}>
                              Out: {signOutOk ? "✓" : "—"}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <StatusBadge tone={STATUS_TONES[s.status] || "neutral"}>
                            {s.status.toUpperCase()}
                          </StatusBadge>
                        </td>
                        <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                            <Button size="small" variant="primary" onClick={() => openChecklistForBooking(s._id)}>
                              Checklist
                            </Button>
                            {s.status === "scheduled" && isDoctor && (
                              <Button size="small" variant="outline" onClick={() => openCancelModal(s)}>
                                Cancel
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 3: WHO CHECKLIST & PACU RECOVERY */}
      {activeTab === "checklist" && (
        <section>
          {/* Active surgery selector */}
          <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <label style={{ fontWeight: 600 }}>
              Select Active Surgery Case:
              <select
                value={activeChecklistBookingId}
                onChange={(e) => setActiveChecklistBookingId(e.target.value)}
                style={{ marginLeft: "0.5rem", padding: "0.5rem 0.8rem", borderRadius: "6px", border: "1px solid #CBD5E1", minWidth: 320 }}
              >
                <option value="">-- Choose Surgery Case --</option>
                {otSchedules.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.bookingNumber} • {s.procedureName} ({s.theatreRoomId?.theatreCode || "OT"}) - {s.status.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline" onClick={loadOtSchedules}>
              <RefreshCw size={16} /> Refresh
            </Button>
          </div>

          {!activeChecklistBooking ? (
            <EmptyState
              title="No Surgery Selected"
              description="Please select a surgery case from the dropdown above to view and record WHO checklist stages or PACU recovery scores."
            />
          ) : (
            <WhoChecklistWorkstation
              booking={activeChecklistBooking}
              authHeaders={authHeaders}
              isDoctor={isDoctor}
              onUpdate={() => loadOtSchedules()}
              setFeedback={setFeedback}
            />
          )}
        </section>
      )}

      {/* INTAKE MODAL */}
      {intakeModalOpen && (
        <TriageIntakeModal
          open={intakeModalOpen}
          onClose={() => setIntakeModalOpen(false)}
          authHeaders={authHeaders}
          onSuccess={() => {
            setIntakeModalOpen(false);
            setFeedback({ tone: "positive", message: "Emergency patient triaged and registered successfully." });
            loadRegistrations();
          }}
        />
      )}

      {/* UPDATE STATUS MODAL */}
      {statusModalOpen && selectedReg && (
        <UpdateStatusModal
          open={statusModalOpen}
          registration={selectedReg}
          onClose={() => {
            setStatusModalOpen(false);
            setSelectedReg(null);
          }}
          authHeaders={authHeaders}
          onSuccess={() => {
            setStatusModalOpen(false);
            setSelectedReg(null);
            setFeedback({ tone: "positive", message: "Emergency status & disposition updated." });
            loadRegistrations();
          }}
        />
      )}

      {/* BOOK OT MODAL */}
      {bookModalOpen && (
        <BookTheatreModal
          open={bookModalOpen}
          onClose={() => {
            setBookModalOpen(false);
            setSelectedReg(null);
          }}
          prefilledReg={selectedReg}
          theatres={theatres}
          authHeaders={authHeaders}
          onSuccess={() => {
            setBookModalOpen(false);
            setSelectedReg(null);
            setFeedback({ tone: "positive", message: "Surgery booked successfully with conflict checks cleared." });
            loadOtSchedules();
          }}
        />
      )}

      {/* CANCEL OT MODAL */}
      {cancelModalOpen && selectedBooking && (
        <CancelTheatreModal
          open={cancelModalOpen}
          booking={selectedBooking}
          onClose={() => {
            setCancelModalOpen(false);
            setSelectedBooking(null);
          }}
          authHeaders={authHeaders}
          onSuccess={() => {
            setCancelModalOpen(false);
            setSelectedBooking(null);
            setFeedback({ tone: "positive", message: "Surgery booking cancelled and theatre slot immediately released." });
            loadOtSchedules();
          }}
        />
      )}

      {/* CREATE THEATRE SUITE MODAL */}
      {createTheatreModalOpen && (
        <CreateTheatreRoomModal
          open={createTheatreModalOpen}
          onClose={() => setCreateTheatreModalOpen(false)}
          authHeaders={authHeaders}
          onSuccess={() => {
            setCreateTheatreModalOpen(false);
            setFeedback({ tone: "positive", message: "New Operation Theatre Suite created successfully." });
            loadTheatres();
          }}
        />
      )}
    </main>
  );
}

// -------------------------------------------------------------
// WHO CHECKLIST & PACU WORKSTATION
// -------------------------------------------------------------
function WhoChecklistWorkstation({ booking, authHeaders, isDoctor, onUpdate, setFeedback }) {
  const [submitting, setSubmitting] = useState(false);

  // Sign In Checkpoints state (7 mandatory)
  const [signInChecks, setSignInChecks] = useState({
    patient_identity_confirmed: true,
    surgical_site_marked: true,
    anesthesia_safety_check_complete: true,
    pulse_oximeter_operating: true,
    allergy_status_verified: true,
    airway_aspiration_risk_evaluated: true,
    blood_loss_risk_prepared: true,
  });

  // Time Out Checkpoints state (7 mandatory)
  const [timeOutChecks, setTimeOutChecks] = useState({
    team_introductions_complete: true,
    patient_procedure_site_confirmed: true,
    surgeon_critical_events_reviewed: true,
    anesthetist_concerns_reviewed: true,
    nursing_sterility_confirmed: true,
    antibiotic_prophylaxis_administered_within_60m: true,
    essential_imaging_displayed: true,
  });

  // Sign Out Checkpoints state (5 mandatory)
  const [signOutChecks, setSignOutChecks] = useState({
    procedure_name_recorded: true,
    instrument_sponge_needle_counts_correct: true,
    surgical_specimen_labeled: true,
    equipment_issues_recorded: true,
    surgeon_anesthetist_nurse_recovery_plan_agreed: true,
  });

  // PACU state
  const [aldreteScore, setAldreteScore] = useState(booking.pacu?.aldreteScore ?? 8);
  const dischargedToWard = Boolean(booking.pacu?.dischargedToWard);

  const signInDone = Boolean(booking.whoChecklist?.signIn?.completed);
  const timeOutDone = Boolean(booking.whoChecklist?.timeOut?.completed);
  const signOutDone = Boolean(booking.whoChecklist?.signOut?.completed);

  // Submit Sign In
  const submitSignIn = async () => {
    setSubmitting(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/emergency/bookings/${booking._id}/who-checklist`,
        { stage: "signIn", checkpoints: signInChecks },
        authHeaders
      );
      setFeedback({ tone: "positive", message: "Sign In stage verified. Surgery is now IN PROGRESS." });
      onUpdate();
    } catch (err) {
      setFeedback({ tone: "danger", message: err.response?.data?.error || "Failed to record Sign In stage" });
    } finally {
      setSubmitting(false);
    }
  };

  // Submit Time Out (Surgeon)
  const submitTimeOut = async () => {
    if (!isDoctor) {
      setFeedback({ tone: "danger", message: "Time Out checklist must be verified by an operating surgeon (DOCTOR role)" });
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/emergency/bookings/${booking._id}/who-checklist`,
        { stage: "timeOut", checkpoints: timeOutChecks },
        authHeaders
      );
      setFeedback({ tone: "positive", message: "Time Out verified by Operating Surgeon. Safe incision authorized." });
      onUpdate();
    } catch (err) {
      setFeedback({ tone: "danger", message: err.response?.data?.error || "Failed to record Time Out stage" });
    } finally {
      setSubmitting(false);
    }
  };

  // Submit Sign Out
  const submitSignOut = async () => {
    setSubmitting(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/emergency/bookings/${booking._id}/who-checklist`,
        { stage: "signOut", checkpoints: signOutChecks },
        authHeaders
      );
      setFeedback({ tone: "positive", message: "Sign Out verified. Surgery is COMPLETED. Patient transferred to PACU." });
      onUpdate();
    } catch (err) {
      setFeedback({ tone: "danger", message: err.response?.data?.error || "Failed to record Sign Out stage" });
    } finally {
      setSubmitting(false);
    }
  };

  // Submit PACU Recovery
  const submitPacu = async (dischargeWard) => {
    setSubmitting(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/emergency/bookings/${booking._id}/pacu`,
        { aldreteScore: Number(aldreteScore), dischargedToWard: dischargeWard },
        authHeaders
      );
      setFeedback({
        tone: "positive",
        message: dischargeWard
          ? "PACU recovery score verified (>= 8). Ward transfer authorized and recorded."
          : "Aldrete recovery score recorded. Patient remains monitored in PACU.",
      });
      onUpdate();
    } catch (err) {
      setFeedback({ tone: "danger", message: err.response?.data?.error || "Failed to record PACU recovery" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "1.5rem" }}>
      {/* Case Overview Card */}
      <Card style={{ gridColumn: "1 / -1", background: "var(--mp-surface-subtle)", border: "1px solid var(--mp-border)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0F766E" }}>{booking.procedureName}</div>
            <div style={{ fontSize: "0.875rem", color: "var(--mp-muted)" }}>
              Booking: <strong>{booking.bookingNumber}</strong> • Theatre: <strong>{booking.theatreRoomId?.theatreCode} ({booking.theatreRoomId?.theatreName})</strong>
            </div>
            <div style={{ fontSize: "0.875rem", color: "var(--mp-text)", marginTop: "0.25rem" }}>
              Surgeon: <strong>Dr. {booking.leadSurgeonDoctorId?.firstName} {booking.leadSurgeonDoctorId?.lastName}</strong> • Anesthetist: <strong>Dr. {booking.anesthetistDoctorId?.firstName} {booking.anesthetistDoctorId?.lastName}</strong>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <StatusBadge tone={STATUS_TONES[booking.status] || "neutral"}>{booking.status.toUpperCase()}</StatusBadge>
            <div style={{ fontSize: "0.8rem", color: "var(--mp-muted)", marginTop: "0.25rem" }}>
              {new Date(booking.scheduledStartTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – {new Date(booking.scheduledEndTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>
      </Card>

      {/* PHASE 1: SIGN IN */}
      <Card style={{ borderTop: signInDone ? "4px solid #16A34A" : "4px solid #0D9488" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <CheckCircle2 size={18} color={signInDone ? "#16A34A" : "#0D9488"} /> 1. Sign In (Before Induction)
          </h3>
          <StatusBadge tone={signInDone ? "positive" : "warning"}>{signInDone ? "COMPLETED" : "PENDING"}</StatusBadge>
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--mp-muted)", margin: "0 0 1rem" }}>
          Circulating nurse verifies with patient and anesthetist before anesthesia induction.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
          {[
            ["patient_identity_confirmed", "Patient identity, site, procedure & consent confirmed"],
            ["surgical_site_marked", "Surgical site marked (or not applicable)"],
            ["anesthesia_safety_check_complete", "Anesthesia safety check complete & medication checked"],
            ["pulse_oximeter_operating", "Pulse oximeter on patient and operating"],
            ["allergy_status_verified", "Known allergy status verified"],
            ["airway_aspiration_risk_evaluated", "Difficult airway / aspiration risk evaluated"],
            ["blood_loss_risk_prepared", "Risk of >500ml blood loss assessed & fluids prepared"],
          ].map(([key, label]) => (
            <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: signInDone ? "default" : "pointer" }}>
              <input
                type="checkbox"
                disabled={signInDone}
                checked={Boolean(signInChecks[key])}
                onChange={(e) => setSignInChecks({ ...signInChecks, [key]: e.target.checked })}
                style={{ marginTop: "3px" }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        {!signInDone && (
          <div style={{ marginTop: "1rem" }}>
            <Button variant="primary" style={{ width: "100%" }} onClick={submitSignIn} disabled={submitting}>
              Verify Sign In Checklist
            </Button>
          </div>
        )}
      </Card>

      {/* PHASE 2: TIME OUT */}
      <Card style={{ borderTop: timeOutDone ? "4px solid #16A34A" : timeOutDone ? "4px solid #0D9488" : "4px solid #CBD5E1", opacity: !signInDone ? 0.7 : 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Clock size={18} color={timeOutDone ? "#16A34A" : "#EA580C"} /> 2. Time Out (Before Incision)
          </h3>
          <StatusBadge tone={timeOutDone ? "positive" : !signInDone ? "neutral" : "warning"}>
            {timeOutDone ? "COMPLETED" : !signInDone ? "LOCKED" : "READY"}
          </StatusBadge>
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--mp-muted)", margin: "0 0 1rem" }}>
          Operating Surgeon strictly leads and verifies verbal pause immediately before skin incision.
        </p>

        {!signInDone ? (
          <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--mp-muted)", background: "var(--mp-surface-subtle)", borderRadius: "6px" }}>
            <AlertCircle size={24} style={{ margin: "0 auto 0.5rem", color: "#94A3B8" }} />
            <div>Sign In checklist must be completed before Time Out can begin.</div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
              {[
                ["team_introductions_complete", "All team members introduced by name and role"],
                ["patient_procedure_site_confirmed", "Surgeon, anesthetist & nurse confirm patient & site"],
                ["surgeon_critical_events_reviewed", "Surgeon reviews critical steps, operative duration, blood loss"],
                ["anesthetist_concerns_reviewed", "Anesthetist reviews patient-specific concerns & airway"],
                ["nursing_sterility_confirmed", "Nursing team confirms sterility & indicator results"],
                ["antibiotic_prophylaxis_administered_within_60m", "Antibiotic prophylaxis given within last 60 minutes"],
                ["essential_imaging_displayed", "Essential diagnostic imaging displayed in OR"],
              ].map(([key, label]) => (
                <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: timeOutDone ? "default" : "pointer" }}>
                  <input
                    type="checkbox"
                    disabled={timeOutDone}
                    checked={Boolean(timeOutChecks[key])}
                    onChange={(e) => setTimeOutChecks({ ...timeOutChecks, [key]: e.target.checked })}
                    style={{ marginTop: "3px" }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            {!timeOutDone && (
              <div style={{ marginTop: "1rem" }}>
                <Button variant="primary" style={{ width: "100%", background: "#EA580C", borderColor: "#EA580C" }} onClick={submitTimeOut} disabled={submitting}>
                  Operating Surgeon: Verify Time Out
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {/* PHASE 3: SIGN OUT */}
      <Card style={{ borderTop: signOutDone ? "4px solid #16A34A" : "4px solid #CBD5E1", opacity: !timeOutDone ? 0.7 : 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <CheckSquare size={18} color={signOutDone ? "#16A34A" : "var(--mp-primary)"} /> 3. Sign Out (Before Leaving OR)
          </h3>
          <StatusBadge tone={signOutDone ? "positive" : !timeOutDone ? "neutral" : "warning"}>
            {signOutDone ? "COMPLETED" : !timeOutDone ? "LOCKED" : "READY"}
          </StatusBadge>
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--mp-muted)", margin: "0 0 1rem" }}>
          Circulating nurse verifies counts and specimens before patient leaves operating room.
        </p>

        {!timeOutDone ? (
          <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--mp-muted)", background: "var(--mp-surface-subtle)", borderRadius: "6px" }}>
            <AlertCircle size={24} style={{ margin: "0 auto 0.5rem", color: "#94A3B8" }} />
            <div>Time Out checklist must be completed before Sign Out.</div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
              {[
                ["procedure_name_recorded", "Nurse verbally confirms name of procedure recorded"],
                ["instrument_sponge_needle_counts_correct", "Instrument, sponge and needle counts are correct"],
                ["surgical_specimen_labeled", "Specimen labeled with patient name and identifiers"],
                ["equipment_issues_recorded", "Any equipment issues or malfunction noted"],
                ["surgeon_anesthetist_nurse_recovery_plan_agreed", "Surgeon, anesthetist & nurse review post-op recovery plan"],
              ].map(([key, label]) => (
                <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: signOutDone ? "default" : "pointer" }}>
                  <input
                    type="checkbox"
                    disabled={signOutDone}
                    checked={Boolean(signOutChecks[key])}
                    onChange={(e) => setSignOutChecks({ ...signOutChecks, [key]: e.target.checked })}
                    style={{ marginTop: "3px" }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            {!signOutDone && (
              <div style={{ marginTop: "1rem" }}>
                <Button variant="primary" style={{ width: "100%" }} onClick={submitSignOut} disabled={submitting}>
                  Verify Sign Out Checklist
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {/* PHASE 4: PACU RECOVERY & ALDRETE SCORE */}
      <Card style={{ gridColumn: "1 / -1", borderTop: "4px solid #8B5CF6" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Activity size={20} color="#8B5CF6" /> 4. Post-Anesthesia Care Unit (PACU) & Aldrete Recovery Scoring Gate
          </h3>
          <StatusBadge tone={dischargedToWard ? "positive" : aldreteScore >= 8 ? "info" : "warning"}>
            {dischargedToWard ? "DISCHARGED TO WARD" : aldreteScore >= 8 ? "SAFE TO DISCHARGE (>=8)" : "PACU MONITORING (<8)"}
          </StatusBadge>
        </div>

        <p style={{ fontSize: "0.875rem", color: "var(--mp-muted)", margin: "0 0 1rem" }}>
          Clinical safety gate: Aldrete Score evaluates activity, respiration, circulation, consciousness, and O2 saturation. <strong>Minimum score of 8 required for safe discharge to inpatient ward.</strong>
        </p>

        <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem", alignItems: "center" }}>
          <div>
            <Field label="Aldrete Recovery Score (0 to 10)" required>
              <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={aldreteScore}
                  onChange={(e) => setAldreteScore(Number(e.target.value))}
                  style={{ flex: 1, accentColor: "#8B5CF6" }}
                />
                <span
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    padding: "0.25rem 0.75rem",
                    borderRadius: "6px",
                    background: aldreteScore >= 8 ? "#DCFCE7" : "#FEF3C7",
                    color: aldreteScore >= 8 ? "#16A34A" : "#D97706",
                  }}
                >
                  {aldreteScore} / 10
                </span>
              </div>
            </Field>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ fontSize: "0.8rem", color: aldreteScore >= 8 ? "#16A34A" : "#D97706", fontWeight: 600 }}>
              {aldreteScore >= 8 ? "✓ Clinical safety threshold met: Patient alert, stable vitals, safe for transfer." : "⚠ Safety warning: Score < 8. Patient must remain in PACU under active recovery monitoring."}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Button variant="outline" onClick={() => submitPacu(false)} disabled={submitting}>
                Record Score (Keep in PACU)
              </Button>
              <Button
                variant="primary"
                onClick={() => submitPacu(true)}
                disabled={submitting || aldreteScore < 8}
                style={{ background: aldreteScore >= 8 ? "#16A34A" : undefined, borderColor: aldreteScore >= 8 ? "#16A34A" : undefined }}
              >
                Authorize & Transfer to Ward
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// -------------------------------------------------------------
// MODALS
// -------------------------------------------------------------

function TriageIntakeModal({ open, onClose, authHeaders, onSuccess }) {
  const [patientName, setPatientName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("unknown");
  const [arrivalMode, setArrivalMode] = useState("ambulance");
  const [triageLevel, setTriageLevel] = useState(1);
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [assignedBay, setAssignedBay] = useState("RESUSCITATION-BAY-1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleTriageSelect = (lvl) => {
    setTriageLevel(lvl);
    if (lvl === 1) setAssignedBay("RESUSCITATION-BAY-1");
    else if (lvl === 2) setAssignedBay("ACUTE-BAY-1");
    else if (lvl === 3) setAssignedBay("ACUTE-BAY-3");
    else setAssignedBay("MINOR-BAY-1");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!patientName.trim()) {
      setError("Patient identification or trauma moniker is required");
      return;
    }
    if (!chiefComplaint.trim()) {
      setError("Chief complaint is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await axios.post(
        `${BACKEND_URL}/api/emergency/registrations`,
        {
          patientName: patientName.trim(),
          age: age ? Number(age) : null,
          gender,
          arrivalMode,
          triageLevel: Number(triageLevel),
          chiefComplaint: chiefComplaint.trim(),
          assignedBay: assignedBay.trim(),
        },
        authHeaders
      );
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to register emergency patient");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Emergency Department Triage Intake">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {error && <Banner tone="danger">{error}</Banner>}

        <Field label="Patient Name or Temporary Trauma Moniker" required>
          <input
            type="text"
            required
            placeholder="e.g. John Doe / Trauma Code Blue #902"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
          />
        </Field>

        <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
          <Field label="Age">
            <input
              type="number"
              placeholder="Years"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
            />
          </Field>
          <Field label="Gender">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>
          <Field label="Arrival Mode">
            <select
              value={arrivalMode}
              onChange={(e) => setArrivalMode(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
            >
              <option value="ambulance">Ambulance (108/ALS)</option>
              <option value="walk_in">Walk-In</option>
              <option value="police">Police / Trauma Patrol</option>
              <option value="internal_transfer">Hospital Transfer</option>
            </select>
          </Field>
        </div>

        {/* 5-Level Triage Selector */}
        <div>
          <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            5-Level Emergency Triage Classification (ESI 1–5) *
          </label>
          <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.5rem" }}>
            {[1, 2, 3, 4, 5].map((lvl) => {
              const cfg = TRIAGE_LEVELS[lvl];
              const isSelected = triageLevel === lvl;
              return (
                <div
                  key={lvl}
                  onClick={() => handleTriageSelect(lvl)}
                  style={{
                    padding: "0.6rem",
                    borderRadius: "6px",
                    border: isSelected ? `2px solid ${cfg.border}` : "1px solid #CBD5E1",
                    backgroundColor: isSelected ? cfg.bg : "#FFF",
                    cursor: "pointer",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontWeight: 700, color: cfg.border }}>Level {lvl}</div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600 }}>{cfg.code}</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--mp-muted)" }}>Max: {cfg.maxWait}</div>
                </div>
              );
            })}
          </div>
        </div>

        <Field label="Assigned Resuscitation / Acute Bay">
          <input
            type="text"
            value={assignedBay}
            onChange={(e) => setAssignedBay(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
          />
        </Field>

        <Field label="Chief Emergency Complaint" required>
          <textarea
            required
            rows={3}
            placeholder="Describe presenting symptoms, trauma injury mechanism, initial vitals..."
            value={chiefComplaint}
            onChange={(e) => setChiefComplaint(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
          />
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Triaging..." : "Complete Triage Intake"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function UpdateStatusModal({ open, registration, onClose, authHeaders, onSuccess }) {
  const [status, setStatus] = useState(registration.status || "in_treatment");
  const [assignedBay, setAssignedBay] = useState(registration.assignedBay || "");
  const [outcomeNotes, setOutcomeNotes] = useState(registration.outcomeNotes || "");
  const [linkedAdmissionId, setLinkedAdmissionId] = useState(registration.linkedAdmissionId?._id || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await axios.patch(
        `${BACKEND_URL}/api/emergency/registrations/${registration._id}/status`,
        {
          status,
          assignedBay: assignedBay.trim(),
          outcomeNotes: outcomeNotes.trim(),
          linkedAdmissionId: linkedAdmissionId.trim() || undefined,
        },
        authHeaders
      );
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update emergency status");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Update Status: ${registration.patientName}`}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {error && <Banner tone="danger">{error}</Banner>}

        <Field label="Target Emergency Status" required>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
          >
            <option value="triaged">Triaged (Waiting for Bay/Doctor)</option>
            <option value="in_treatment">In Treatment (Active Emergency Care)</option>
            <option value="admitted_ipd">Admitted to Inpatient Ward (IPD)</option>
            <option value="transferred_out">Transferred to External Tertiary Center</option>
            <option value="discharged">Discharged Home (Stable)</option>
            <option value="deceased">Deceased (Clinical Expiry)</option>
          </select>
        </Field>

        <Field label="Assigned Bay / Room">
          <input
            type="text"
            value={assignedBay}
            onChange={(e) => setAssignedBay(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
          />
        </Field>

        {status === "admitted_ipd" && (
          <Field label="Linked Inpatient Admission ID (Optional)">
            <input
              type="text"
              placeholder="e.g. Mongo ObjectId or Admission Number"
              value={linkedAdmissionId}
              onChange={(e) => setLinkedAdmissionId(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
            />
          </Field>
        )}

        <Field label="Clinical Outcome / Disposition Notes">
          <textarea
            rows={3}
            placeholder="Record disposition justification, stabilization summary, discharge instructions..."
            value={outcomeNotes}
            onChange={(e) => setOutcomeNotes(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
          />
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Update Disposition"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function BookTheatreModal({ open, prefilledReg, theatres, onClose, authHeaders, onSuccess }) {
  const [theatreRoomId, setTheatreRoomId] = useState(theatres[0]?._id || "");
  const [patientId, setPatientId] = useState(prefilledReg?.patientId?._id || prefilledReg?.patientId || "");
  const [procedureName, setProcedureName] = useState(prefilledReg ? `Emergency Surgery for ${prefilledReg.chiefComplaint}` : "");
  const [urgency, setUrgency] = useState(prefilledReg ? "emergency_stat" : "elective");
  const [leadSurgeonDoctorId, setLeadSurgeonDoctorId] = useState("");
  const [anesthetistDoctorId, setAnesthetistDoctorId] = useState("");
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(Date.now() + 30 * 60 * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [endTime, setEndTime] = useState(() => {
    const d = new Date(Date.now() + 150 * 60 * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [doctors, setDoctors] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Fetch doctors for lead surgeon and anesthetist selection
    axios
      .get(`${BACKEND_URL}/doctor`, authHeaders)
      .then((res) => {
        const docs = res.data?.doctors || res.data || [];
        setDoctors(docs);
        if (docs.length > 0) {
          setLeadSurgeonDoctorId(docs[0]._id);
          setAnesthetistDoctorId(docs[1]?._id || docs[0]._id);
        }
      })
      .catch(() => {});
  }, [authHeaders]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!theatreRoomId) {
      setError("Please select a Theatre Suite");
      return;
    }
    if (!procedureName.trim()) {
      setError("Procedure name is required");
      return;
    }
    if (!leadSurgeonDoctorId || !anesthetistDoctorId) {
      setError("Lead Surgeon and Anesthesiologist are required");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await axios.post(
        `${BACKEND_URL}/api/emergency/bookings`,
        {
          theatreRoomId,
          patientId: patientId || undefined,
          emergencyRegistrationId: prefilledReg?._id || undefined,
          procedureName: procedureName.trim(),
          urgency,
          leadSurgeonDoctorId,
          anesthetistDoctorId,
          scheduledStartTime: new Date(startTime).toISOString(),
          scheduledEndTime: new Date(endTime).toISOString(),
        },
        authHeaders
      );
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || "Failed to book theatre surgery case");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Book Operation Theatre Case">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {error && <Banner tone="danger">{error}</Banner>}

        <Field label="Theatre Room Suite" required>
          <select
            value={theatreRoomId}
            onChange={(e) => setTheatreRoomId(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
          >
            {theatres.map((t) => (
              <option key={t._id} value={t._id}>
                {t.theatreCode} — {t.theatreName} ({t.theatreType.toUpperCase()})
              </option>
            ))}
          </select>
        </Field>

        <Field label="Surgical Procedure Name" required>
          <input
            type="text"
            required
            placeholder="e.g. Exploratory Laparotomy / Laparoscopic Cholecystectomy"
            value={procedureName}
            onChange={(e) => setProcedureName(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
          />
        </Field>

        <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <Field label="Urgency Classification" required>
            <select
              value={urgency}
              onChange={(e) => setUrgency(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
            >
              <option value="elective">Elective (Planned Case)</option>
              <option value="urgent">Urgent (Within 6–24 hours)</option>
              <option value="emergency_stat">Emergency STAT (Immediate Life/Limb Threat)</option>
            </select>
          </Field>

          <Field label="Patient ID / Linked Case">
            <input
              type="text"
              placeholder={prefilledReg ? prefilledReg.patientName : "Patient User ID"}
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
            />
          </Field>
        </div>

        <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <Field label="Lead Operating Surgeon" required>
            <select
              value={leadSurgeonDoctorId}
              onChange={(e) => setLeadSurgeonDoctorId(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
            >
              {doctors.map((d) => (
                <option key={d._id} value={d._id}>
                  Dr. {d.firstName} {d.lastName} ({d.specialization})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Attending Anesthesiologist" required>
            <select
              value={anesthetistDoctorId}
              onChange={(e) => setAnesthetistDoctorId(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
            >
              {doctors.map((d) => (
                <option key={d._id} value={d._id}>
                  Dr. {d.firstName} {d.lastName} ({d.specialization})
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <Field label="Scheduled Start Time" required>
            <input
              type="datetime-local"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
            />
          </Field>
          <Field label="Scheduled End Time" required>
            <input
              type="datetime-local"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
            />
          </Field>
        </div>

        <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)", background: "var(--mp-surface-subtle)", padding: "0.5rem", borderRadius: "4px" }}>
          * Automatic triple-conflict check verifies that theatre room, lead surgeon, and anesthesiologist have zero overlapping surgery reservations during this window.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Checking Conflicts..." : "Confirm Theatre Booking"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CancelTheatreModal({ open, booking, onClose, authHeaders, onSuccess }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Cancellation reason is mandatory");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await axios.post(
        `${BACKEND_URL}/api/emergency/bookings/${booking._id}/cancel`,
        { reason: reason.trim() },
        authHeaders
      );
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to cancel theatre booking");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Cancel Surgery: ${booking.bookingNumber}`}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {error && <Banner tone="danger">{error}</Banner>}

        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--mp-muted)" }}>
          Cancelling will immediately release the theatre room, surgeon, and anesthesiologist slots for emergency reallocation.
        </p>

        <Field label="Cancellation Reason" required>
          <textarea
            required
            rows={3}
            placeholder="e.g. Patient acute contraindication, rescheduled per family request..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
          />
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <Button variant="outline" type="button" onClick={onClose}>
            Close
          </Button>
          <Button variant="danger" type="submit" disabled={submitting}>
            {submitting ? "Cancelling..." : "Confirm Cancellation"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CreateTheatreRoomModal({ open, onClose, authHeaders, onSuccess }) {
  const [theatreCode, setTheatreCode] = useState("");
  const [theatreName, setTheatreName] = useState("");
  const [theatreType, setTheatreType] = useState("major");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!theatreCode.trim() || !theatreName.trim()) {
      setError("Theatre code and name are required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await axios.post(
        `${BACKEND_URL}/api/emergency/theatres`,
        { theatreCode: theatreCode.trim().toUpperCase(), theatreName: theatreName.trim(), theatreType },
        authHeaders
      );
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create theatre room");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Create Operation Theatre Suite">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {error && <Banner tone="danger">{error}</Banner>}

        <Field label="Theatre Code (Unique, e.g. OT-03, OT-CARD-1)" required>
          <input
            type="text"
            required
            placeholder="e.g. OT-03"
            value={theatreCode}
            onChange={(e) => setTheatreCode(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
          />
        </Field>

        <Field label="Theatre Suite Name" required>
          <input
            type="text"
            required
            placeholder="e.g. Robotic & Laparoscopic Suite 3"
            value={theatreName}
            onChange={(e) => setTheatreName(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
          />
        </Field>

        <Field label="Theatre Type">
          <select
            value={theatreType}
            onChange={(e) => setTheatreType(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
          >
            <option value="major">Major Surgery Suite</option>
            <option value="minor">Minor OT / Daycare</option>
            <option value="emergency">Emergency Trauma OR</option>
            <option value="cardiac">Cardiac & Vascular OR</option>
            <option value="ortho">Orthopedic & Joint Replacement OR</option>
            <option value="neuro">Neurosurgical Suite</option>
          </select>
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create Suite"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
