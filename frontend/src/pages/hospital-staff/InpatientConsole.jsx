import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import {
  BedDouble,
  RefreshCw,
  Plus,
  ArrowRightLeft,
  CheckCircle2,
  FileText,
  LogOut,
} from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { useAuth } from "../../context/AuthContext";
import { Banner, Button, Card, Dialog, EmptyState, Field, LoadingState, StatusBadge } from "../../components/ui";

const bedStatusTones = {
  available: "positive",
  occupied: "info",
  cleaning: "warning",
  maintenance: "danger",
  reserved: "neutral",
};

export default function InpatientConsole() {
  const { staffUser, isStaffAuth } = useAuth();
  if (!isStaffAuth) {
    return (
      <main className="mp-page">
        <Card>
          <h1>Hospital Staff Authentication Required</h1>
          <p>Please sign in with your hospital staff account to access inpatient bed management.</p>
        </Card>
      </main>
    );
  }
  return <InpatientWorkspace key={`${staffUser?._id || staffUser?.id}:${staffUser?.hospitalId}`} />;
}

function InpatientWorkspace() {
  const { staffUser } = useAuth();
  const isAdmin = staffUser?.role === "HOSPITAL_ADMIN" || Boolean(staffUser?.adminAccess);
  const isDoctor = staffUser?.role === "DOCTOR" || isAdmin;
  const isNurse = staffUser?.role === "NURSE" || isAdmin;
  const isPharmacist = staffUser?.role === "PHARMACIST" || isAdmin;
  const isReception = staffUser?.role === "RECEPTIONIST" || isAdmin;

  const [wards, setWards] = useState([]);
  const [selectedWardId, setSelectedWardId] = useState("");
  const [rooms, setRooms] = useState([]);
  const [beds, setBeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Dialog states
  const [admitModalBed, setAdmitModalBed] = useState(null);
  const [transferModalBed, setTransferModalBed] = useState(null);
  const [clearanceModalBed, setClearanceModalBed] = useState(null);
  const [dischargeModalBed, setDischargeModalBed] = useState(null);
  const [timelineModalAdmissionId, setTimelineModalAdmissionId] = useState(null);
  const [statusModalBed, setStatusModalBed] = useState(null);
  const [newWardModal, setNewWardModal] = useState(false);
  const [newRoomModal, setNewRoomModal] = useState(false);
  const [newBedModal, setNewBedModal] = useState(false);

  // Form states
  const [admitForm, setAdmitForm] = useState({
    patientId: "",
    admittingDiagnosis: "",
    departmentId: "",
    admittingDoctorId: "",
    advanceDepositMinor: 0,
    estimatedLengthOfStayDays: 3,
  });
  const [transferForm, setTransferForm] = useState({
    targetBedId: "",
    transferReason: "",
  });
  const [dischargeForm, setDischargeForm] = useState({
    summaryText: "",
    dischargeCondition: "improved",
    followUpPlan: "",
  });
  const [timelineData, setTimelineData] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Administration forms
  const [wardForm, setWardForm] = useState({ name: "", code: "", floor: "1", building: "Main", genderPolicy: "all" });
  const [roomForm, setRoomForm] = useState({ wardId: "", roomNumber: "", roomType: "general", dailyTariffMinor: 100000 });
  const [bedForm, setBedForm] = useState({ wardId: "", roomId: "", bedNumber: "" });
  const [statusUpdateForm, setStatusUpdateForm] = useState({ targetStatus: "cleaning", reason: "" });

  const [submitting, setSubmitting] = useState(false);

  const fetchWardsAndBeds = useCallback(async () => {
    setLoading(true);
    try {
      const wardsRes = await axios.get(`${BACKEND_URL}/api/inpatient/wards`, { withCredentials: true });
      const loadedWards = wardsRes.data.wards || [];
      setWards(loadedWards);

      const targetWard = selectedWardId || (loadedWards[0]?._id ? String(loadedWards[0]._id) : "");
      if (!selectedWardId && targetWard) setSelectedWardId(targetWard);

      const [roomsRes, bedsRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/inpatient/rooms`, {
          params: targetWard ? { wardId: targetWard } : {},
          withCredentials: true,
        }),
        axios.get(`${BACKEND_URL}/api/inpatient/beds`, {
          params: targetWard ? { wardId: targetWard } : {},
          withCredentials: true,
        }),
      ]);
      setRooms(roomsRes.data.rooms || []);
      setBeds(bedsRes.data.beds || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load inpatient ward and bed data");
    } finally {
      setLoading(false);
    }
  }, [selectedWardId]);

  useEffect(() => {
    fetchWardsAndBeds();
  }, [fetchWardsAndBeds]);

  // Handle Admission
  const handleAdmit = async (e) => {
    e.preventDefault();
    if (!admitModalBed) return;
    setSubmitting(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/inpatient/admit`,
        {
          bedId: admitModalBed._id,
          patientId: admitForm.patientId,
          admittingDoctorId: admitForm.admittingDoctorId || staffUser?._id || staffUser?.id,
          departmentId: admitForm.departmentId || staffUser?.departmentIds?.[0],
          admittingDiagnosis: admitForm.admittingDiagnosis,
          advanceDepositMinor: Number(admitForm.advanceDepositMinor) || 0,
          estimatedLengthOfStayDays: Number(admitForm.estimatedLengthOfStayDays) || 3,
        },
        { withCredentials: true }
      );
      setFeedback(`Patient successfully admitted to Bed ${admitModalBed.bedNumber}`);
      setAdmitModalBed(null);
      setAdmitForm({ patientId: "", admittingDiagnosis: "", departmentId: "", admittingDoctorId: "", advanceDepositMinor: 0, estimatedLengthOfStayDays: 3 });
      await fetchWardsAndBeds();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to admit patient");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Transfer
  const handleTransfer = async (e) => {
    e.preventDefault();
    if (!transferModalBed?.currentAdmissionId) return;
    setSubmitting(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/inpatient/admissions/${transferModalBed.currentAdmissionId}/transfer`,
        {
          targetBedId: transferForm.targetBedId,
          transferReason: transferForm.transferReason,
        },
        { withCredentials: true }
      );
      setFeedback(`Bed transfer completed successfully`);
      setTransferModalBed(null);
      setTransferForm({ targetBedId: "", transferReason: "" });
      await fetchWardsAndBeds();
    } catch (err) {
      setError(err.response?.data?.message || "Bed transfer failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Clearance
  const handleRecordClearance = async (clearanceType) => {
    if (!clearanceModalBed?.currentAdmissionId) return;
    setSubmitting(true);
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/inpatient/admissions/${clearanceModalBed.currentAdmissionId}/clearance`,
        { clearanceType },
        { withCredentials: true }
      );
      setFeedback(`${clearanceType.toUpperCase()} clearance recorded successfully`);
      // Update modal bed status with returned clearance
      setClearanceModalBed((prev) => ({
        ...prev,
        dischargeClearance: res.data.dischargeClearance,
      }));
      await fetchWardsAndBeds();
    } catch (err) {
      setError(err.response?.data?.message || `Failed to record ${clearanceType} clearance`);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Finalize Discharge
  const handleFinalizeDischarge = async (e) => {
    e.preventDefault();
    if (!dischargeModalBed?.currentAdmissionId) return;
    setSubmitting(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/inpatient/admissions/${dischargeModalBed.currentAdmissionId}/discharge`,
        {
          dischargeSummary: dischargeForm,
        },
        { withCredentials: true }
      );
      setFeedback(`Discharge finalized. Bed released to cleaning.`);
      setDischargeModalBed(null);
      setDischargeForm({ summaryText: "", dischargeCondition: "improved", followUpPlan: "" });
      await fetchWardsAndBeds();
    } catch (err) {
      setError(err.response?.data?.message || "Discharge finalization failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Bed Status Update
  const handleBedStatusUpdate = async (e) => {
    e.preventDefault();
    if (!statusModalBed) return;
    setSubmitting(true);
    try {
      await axios.patch(
        `${BACKEND_URL}/api/inpatient/beds/${statusModalBed._id}/status`,
        {
          targetStatus: statusUpdateForm.targetStatus,
          reason: statusUpdateForm.reason,
        },
        { withCredentials: true }
      );
      setFeedback(`Bed ${statusModalBed.bedNumber} status updated to ${statusUpdateForm.targetStatus}`);
      setStatusModalBed(null);
      setStatusUpdateForm({ targetStatus: "cleaning", reason: "" });
      await fetchWardsAndBeds();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update bed status");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Timeline View
  const openTimeline = async (admissionId) => {
    setTimelineModalAdmissionId(admissionId);
    setTimelineLoading(true);
    try {
      const res = await axios.get(`${BACKEND_URL}/api/inpatient/admissions/${admissionId}/timeline`, {
        withCredentials: true,
      });
      setTimelineData(res.data.timeline);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load admission timeline");
    } finally {
      setTimelineLoading(false);
    }
  };

  // Stats calculation
  const totalBeds = beds.length;
  const availableBeds = beds.filter((b) => b.status === "available").length;
  const occupiedBeds = beds.filter((b) => b.status === "occupied").length;
  const cleaningBeds = beds.filter((b) => b.status === "cleaning").length;
  const maintenanceBeds = beds.filter((b) => b.status === "maintenance").length;
  const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  const filteredBeds = beds.filter((b) => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    return true;
  });

  return (
    <main className="mp-page">
      <header className="mp-page-header" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
              <BedDouble aria-hidden="true" size={28} />
              Inpatient ADT & Bed Board
            </h1>
            <p className="mp-muted" style={{ margin: "0.25rem 0 0 0" }}>
              Enterprise admission, transfer, bed state lifecycle, and multi-department clearance gates
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button variant="secondary" onClick={fetchWardsAndBeds} disabled={loading}>
              <RefreshCw size={16} className={loading ? "mp-spin" : ""} /> Refresh
            </Button>
            {isAdmin && (
              <>
                <Button variant="secondary" onClick={() => setNewWardModal(true)}>
                  <Plus size={16} /> New Ward
                </Button>
                <Button variant="secondary" onClick={() => setNewRoomModal(true)}>
                  <Plus size={16} /> New Room
                </Button>
                <Button variant="primary" onClick={() => setNewBedModal(true)}>
                  <Plus size={16} /> Add Bed
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {error && (
        <Banner tone="error" style={{ marginBottom: "1rem" }} action={<Button variant="ghost" onClick={() => setError("")}>Dismiss</Button>}>
          {error}
        </Banner>
      )}

      {feedback && (
        <Banner tone="positive" style={{ marginBottom: "1rem" }} action={<Button variant="ghost" onClick={() => setFeedback("")}>Dismiss</Button>}>
          {feedback}
        </Banner>
      )}

      {/* Metrics Bar */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <Card style={{ padding: "1rem", textAlign: "center" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--mp-muted)" }}>Total Beds</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{totalBeds}</div>
        </Card>
        <Card style={{ padding: "1rem", textAlign: "center", borderTop: "3px solid #10b981" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--mp-muted)" }}>Available</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#10b981" }}>{availableBeds}</div>
        </Card>
        <Card style={{ padding: "1rem", textAlign: "center", borderTop: "3px solid #3b82f6" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--mp-muted)" }}>Occupied</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#3b82f6" }}>{occupiedBeds}</div>
        </Card>
        <Card style={{ padding: "1rem", textAlign: "center", borderTop: "3px solid #f59e0b" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--mp-muted)" }}>Cleaning</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#f59e0b" }}>{cleaningBeds}</div>
        </Card>
        <Card style={{ padding: "1rem", textAlign: "center", borderTop: "3px solid #ef4444" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--mp-muted)" }}>Maintenance</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#ef4444" }}>{maintenanceBeds}</div>
        </Card>
        <Card style={{ padding: "1rem", textAlign: "center" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--mp-muted)" }}>Occupancy</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{occupancyRate}%</div>
        </Card>
      </section>

      {/* Ward & Status Filter Controls */}
      <Card style={{ padding: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <label htmlFor="ward-select" style={{ fontWeight: 600 }}>Ward:</label>
            <select
              id="ward-select"
              className="mp-input"
              value={selectedWardId}
              onChange={(e) => setSelectedWardId(e.target.value)}
              style={{ minWidth: 200 }}
            >
              {wards.map((w) => (
                <option key={w._id} value={w._id}>
                  {w.name} ({w.code}) - Floor {w.floor}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>Status:</span>
            {["all", "available", "occupied", "cleaning", "maintenance"].map((st) => (
              <button
                key={st}
                type="button"
                className={`mp-button mp-button--${statusFilter === st ? "primary" : "secondary"} mp-button--small`}
                onClick={() => setStatusFilter(st)}
              >
                {st.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Bed Board Grid */}
      {loading ? (
        <LoadingState>Loading bed allocations...</LoadingState>
      ) : filteredBeds.length === 0 ? (
        <EmptyState title="No Beds Found">
          {wards.length === 0 ? "No wards configured yet. Add a ward to begin bed management." : "No beds matching the filter in this ward."}
        </EmptyState>
      ) : (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1.25rem" }}>
          {filteredBeds.map((bed) => {
            const tone = bedStatusTones[bed.status] || "neutral";
            const room = rooms.find((r) => String(r._id) === String(bed.roomId));

            return (
              <Card
                key={bed._id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  padding: "1.25rem",
                  borderLeft: `4px solid var(--mp-${tone === "positive" ? "success" : tone === "danger" ? "error" : tone === "warning" ? "warning" : "primary"}, #3b82f6)`,
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>{bed.bedNumber}</h3>
                      <div className="mp-muted" style={{ fontSize: "0.85rem" }}>
                        Room {room?.roomNumber || "—"} ({room?.roomType || "Standard"})
                      </div>
                    </div>
                    <StatusBadge status={bed.status} tone={tone} />
                  </div>

                  {bed.currentAdmissionId ? (
                    <div style={{ background: "var(--mp-surface-subtle, #f8fafc)", padding: "0.75rem", borderRadius: "6px", margin: "0.75rem 0", fontSize: "0.85rem" }}>
                      <div style={{ fontWeight: 600, color: "#1e293b" }}>Patient Active Admission</div>
                      <div className="mp-muted" style={{ fontSize: "0.75rem" }}>ID: {String(bed.currentAdmissionId).substring(0, 10)}...</div>
                    </div>
                  ) : bed.maintenanceNote ? (
                    <div style={{ background: "#fffbeb", padding: "0.5rem 0.75rem", borderRadius: "6px", margin: "0.75rem 0", fontSize: "0.82rem", color: "#b45309" }}>
                      Note: {bed.maintenanceNote}
                    </div>
                  ) : (
                    <div style={{ padding: "0.75rem 0", fontSize: "0.85rem", color: "var(--mp-muted)" }}>
                      Bed is clean, disinfected, and ready for patient admission.
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--mp-border, #e2e8f0)" }}>
                  {bed.status === "available" && (
                    <Button variant="primary" size="small" onClick={() => setAdmitModalBed(bed)}>
                      Admit Patient
                    </Button>
                  )}

                  {bed.status === "occupied" && (
                    <>
                      <Button variant="secondary" size="small" onClick={() => openTimeline(bed.currentAdmissionId)}>
                        <FileText size={14} /> Timeline
                      </Button>
                      <Button variant="secondary" size="small" onClick={() => setTransferModalBed(bed)}>
                        <ArrowRightLeft size={14} /> Transfer
                      </Button>
                      <Button variant="secondary" size="small" onClick={() => setClearanceModalBed(bed)}>
                        <CheckCircle2 size={14} /> Clearance
                      </Button>
                      {isDoctor && (
                        <Button variant="primary" size="small" onClick={() => setDischargeModalBed(bed)}>
                          <LogOut size={14} /> Discharge
                        </Button>
                      )}
                    </>
                  )}

                  {(bed.status === "cleaning" || bed.status === "maintenance") && isNurse && (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => {
                        setStatusModalBed(bed);
                        setStatusUpdateForm({ targetStatus: "available", reason: "Cleaned and inspected" });
                      }}
                    >
                      Mark Available
                    </Button>
                  )}

                  {isNurse && bed.status !== "occupied" && (
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        setStatusModalBed(bed);
                        setStatusUpdateForm({ targetStatus: bed.status === "maintenance" ? "cleaning" : "maintenance", reason: "" });
                      }}
                    >
                      Status...
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </section>
      )}

      {/* Modal 1: Admit Patient */}
      <Dialog open={Boolean(admitModalBed)} onClose={() => setAdmitModalBed(null)} title={`Admit Patient to Bed ${admitModalBed?.bedNumber || ""}`}>
        <form onSubmit={handleAdmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
          <Field
            label="Patient ID or Token Identifier"
            required
            value={admitForm.patientId}
            onChange={(e) => setAdmitForm({ ...admitForm, patientId: e.target.value })}
            placeholder="e.g. 64f1234567890abcdef12345"
            hint="Enter registered patient user ObjectId"
          />
          <Field
            label="Admitting Diagnosis"
            required
            as="textarea"
            rows={2}
            value={admitForm.admittingDiagnosis}
            onChange={(e) => setAdmitForm({ ...admitForm, admittingDiagnosis: e.target.value })}
            placeholder="Clinical diagnosis for inpatient admission..."
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <Field
              label="Advance Deposit (Minor units/cents)"
              type="number"
              min={0}
              value={admitForm.advanceDepositMinor}
              onChange={(e) => setAdmitForm({ ...admitForm, advanceDepositMinor: e.target.value })}
            />
            <Field
              label="Est. Length of Stay (Days)"
              type="number"
              min={1}
              value={admitForm.estimatedLengthOfStayDays}
              onChange={(e) => setAdmitForm({ ...admitForm, estimatedLengthOfStayDays: e.target.value })}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="secondary" onClick={() => setAdmitModalBed(null)} disabled={submitting}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? "Admitting..." : "Confirm Admission"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal 2: Bed Transfer */}
      <Dialog open={Boolean(transferModalBed)} onClose={() => setTransferModalBed(null)} title={`Transfer Patient from Bed ${transferModalBed?.bedNumber || ""}`}>
        <form onSubmit={handleTransfer} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
          <div className="mp-field">
            <label htmlFor="target-bed-select" style={{ fontWeight: 600 }}>Target Bed (Must be Available): *</label>
            <select
              id="target-bed-select"
              className="mp-input"
              required
              value={transferForm.targetBedId}
              onChange={(e) => setTransferForm({ ...transferForm, targetBedId: e.target.value })}
            >
              <option value="">-- Select Available Bed --</option>
              {beds
                .filter((b) => b.status === "available" && String(b._id) !== String(transferModalBed?._id))
                .map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.bedNumber} (Room {rooms.find((r) => String(r._id) === String(b.roomId))?.roomNumber || "—"})
                  </option>
                ))}
            </select>
          </div>
          <Field
            label="Reason for Bed Transfer"
            required
            as="textarea"
            rows={2}
            value={transferForm.transferReason}
            onChange={(e) => setTransferForm({ ...transferForm, transferReason: e.target.value })}
            placeholder="e.g. Patient condition requires telemetry monitoring..."
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="secondary" onClick={() => setTransferModalBed(null)} disabled={submitting}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? "Transferring..." : "Execute Transfer"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal 3: Multi-Department Discharge Clearance Gate */}
      <Dialog open={Boolean(clearanceModalBed)} onClose={() => setClearanceModalBed(null)} title="Multi-Department Discharge Clearance Gate">
        <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p className="mp-muted" style={{ margin: 0 }}>
            Hospital safety policy requires sign-offs from Medical, Pharmacy, and Finance departments before inpatient discharge can be finalized.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
            {/* Medical Clearance */}
            <Card style={{ padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>1. Medical Clinical Clearance</strong>
                <div className="mp-muted" style={{ fontSize: "0.8rem" }}>Attending physician or hospital medical director sign-off</div>
              </div>
              <Button
                variant={clearanceModalBed?.dischargeClearance?.medicalClearance?.cleared ? "secondary" : "primary"}
                size="small"
                disabled={clearanceModalBed?.dischargeClearance?.medicalClearance?.cleared || (!isDoctor && !isAdmin) || submitting}
                onClick={() => handleRecordClearance("medical")}
              >
                {clearanceModalBed?.dischargeClearance?.medicalClearance?.cleared ? "✓ Medical Cleared" : "Sign Medical Clearance"}
              </Button>
            </Card>

            {/* Pharmacy Clearance */}
            <Card style={{ padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>2. Pharmacy & Medication Return Clearance</strong>
                <div className="mp-muted" style={{ fontSize: "0.8rem" }}>Verify returned unused medications and discharge prescriptions</div>
              </div>
              <Button
                variant={clearanceModalBed?.dischargeClearance?.pharmacyClearance?.cleared ? "secondary" : "primary"}
                size="small"
                disabled={clearanceModalBed?.dischargeClearance?.pharmacyClearance?.cleared || (!isPharmacist && !isAdmin) || submitting}
                onClick={() => handleRecordClearance("pharmacy")}
              >
                {clearanceModalBed?.dischargeClearance?.pharmacyClearance?.cleared ? "✓ Pharmacy Cleared" : "Sign Pharmacy Clearance"}
              </Button>
            </Card>

            {/* Finance Clearance */}
            <Card style={{ padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>3. Finance & Settlement Clearance</strong>
                <div className="mp-muted" style={{ fontSize: "0.8rem" }}>Final billing reconciliation, advance deposit offset, and payment</div>
              </div>
              <Button
                variant={clearanceModalBed?.dischargeClearance?.financeClearance?.cleared ? "secondary" : "primary"}
                size="small"
                disabled={clearanceModalBed?.dischargeClearance?.financeClearance?.cleared || (!isReception && !isAdmin) || submitting}
                onClick={() => handleRecordClearance("finance")}
              >
                {clearanceModalBed?.dischargeClearance?.financeClearance?.cleared ? "✓ Finance Cleared" : "Sign Finance Clearance"}
              </Button>
            </Card>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
            <Button variant="secondary" onClick={() => setClearanceModalBed(null)}>Close</Button>
          </div>
        </div>
      </Dialog>

      {/* Modal 4: Finalize Discharge */}
      <Dialog open={Boolean(dischargeModalBed)} onClose={() => setDischargeModalBed(null)} title="Finalize Inpatient Discharge">
        <form onSubmit={handleFinalizeDischarge} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
          <Field
            label="Clinical Discharge Summary Text"
            required
            as="textarea"
            rows={4}
            value={dischargeForm.summaryText}
            onChange={(e) => setDischargeForm({ ...dischargeForm, summaryText: e.target.value })}
            placeholder="Clinical course during hospital stay, treatments administered, status at discharge..."
          />
          <div className="mp-field">
            <label htmlFor="discharge-condition" style={{ fontWeight: 600 }}>Discharge Condition: *</label>
            <select
              id="discharge-condition"
              className="mp-input"
              value={dischargeForm.dischargeCondition}
              onChange={(e) => setDischargeForm({ ...dischargeForm, dischargeCondition: e.target.value })}
            >
              <option value="cured">Cured</option>
              <option value="improved">Improved</option>
              <option value="stable">Stable</option>
              <option value="referred">Referred to Higher Centre</option>
              <option value="lama">Left Against Medical Advice (LAMA)</option>
            </select>
          </div>
          <Field
            label="Follow-up Plan & Advice"
            as="textarea"
            rows={2}
            value={dischargeForm.followUpPlan}
            onChange={(e) => setDischargeForm({ ...dischargeForm, followUpPlan: e.target.value })}
            placeholder="Medications to continue, review OPD date, red-flag symptoms..."
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="secondary" onClick={() => setDischargeModalBed(null)} disabled={submitting}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? "Finalizing..." : "Sign & Finalize Discharge"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal 5: Bed Status Transition */}
      <Dialog open={Boolean(statusModalBed)} onClose={() => setStatusModalBed(null)} title={`Update Bed ${statusModalBed?.bedNumber || ""} Status`}>
        <form onSubmit={handleBedStatusUpdate} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
          <div className="mp-field">
            <label htmlFor="new-status-select" style={{ fontWeight: 600 }}>Target Status: *</label>
            <select
              id="new-status-select"
              className="mp-input"
              value={statusUpdateForm.targetStatus}
              onChange={(e) => setStatusUpdateForm({ ...statusUpdateForm, targetStatus: e.target.value })}
            >
              <option value="available">Available (Clean & Inspected)</option>
              <option value="cleaning">Cleaning / Housekeeping Required</option>
              <option value="maintenance">Maintenance / Repair</option>
              <option value="reserved">Reserved</option>
            </select>
          </div>
          <Field
            label="Maintenance Note / Reason"
            value={statusUpdateForm.reason}
            onChange={(e) => setStatusUpdateForm({ ...statusUpdateForm, reason: e.target.value })}
            placeholder="e.g. Bio-cleaning complete, motor repaired..."
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="secondary" onClick={() => setStatusModalBed(null)} disabled={submitting}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? "Updating..." : "Update Status"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal 6: Inpatient Timeline */}
      <Dialog open={Boolean(timelineModalAdmissionId)} onClose={() => setTimelineModalAdmissionId(null)} title="Inpatient Care Timeline & Audit Trail">
        <div style={{ padding: "1rem", maxHeight: "65vh", overflowY: "auto" }}>
          {timelineLoading ? (
            <LoadingState>Loading admission timeline...</LoadingState>
          ) : !timelineData ? (
            <EmptyState title="Timeline Unavailable" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <Card style={{ padding: "1rem" }}>
                <h3 style={{ margin: "0 0 0.5rem 0" }}>Admission #{timelineData.admission?.admissionNumber}</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.85rem" }}>
                  <div><strong>Patient:</strong> {timelineData.admission?.patientId?.name || "Patient Record"}</div>
                  <div><strong>Diagnosis:</strong> {timelineData.admission?.admittingDiagnosis}</div>
                  <div><strong>Status:</strong> <StatusBadge status={timelineData.admission?.status} /></div>
                  <div><strong>Admitted At:</strong> {new Date(timelineData.admission?.admissionDate).toLocaleString()}</div>
                </div>
              </Card>

              <h4>Location & Transfer History</h4>
              {timelineData.transfers?.length === 0 ? (
                <p className="mp-muted" style={{ fontSize: "0.85rem" }}>No bed transfers recorded. Patient has remained in initial assigned bed.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {timelineData.transfers?.map((tr) => (
                    <Card key={tr._id} style={{ padding: "0.75rem", fontSize: "0.85rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong>Transfer to Bed {tr.toBedId?.bedNumber || "Target"}</strong>
                        <span className="mp-muted" style={{ fontSize: "0.75rem" }}>{new Date(tr.transferTimestamp).toLocaleString()}</span>
                      </div>
                      <div style={{ margin: "0.25rem 0" }}>Reason: {tr.transferReason}</div>
                      <div className="mp-muted" style={{ fontSize: "0.75rem" }}>Authorized By: {tr.transferredBy?.name || "Staff"} ({tr.transferredBy?.role || "NURSE"})</div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
            <Button variant="secondary" onClick={() => setTimelineModalAdmissionId(null)}>Close</Button>
          </div>
        </div>
      </Dialog>

      {/* Admin Modals: Create Ward */}
      {isAdmin && (
        <>
          <Dialog open={newWardModal} onClose={() => setNewWardModal(false)} title="Create Inpatient Ward">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSubmitting(true);
                try {
                  await axios.post(`${BACKEND_URL}/api/inpatient/wards`, wardForm, { withCredentials: true });
                  setFeedback(`Ward ${wardForm.name} created successfully`);
                  setNewWardModal(false);
                  setWardForm({ name: "", code: "", floor: "1", building: "Main", genderPolicy: "all" });
                  await fetchWardsAndBeds();
                } catch (err) {
                  setError(err.response?.data?.message || "Failed to create ward");
                } finally {
                  setSubmitting(false);
                }
              }}
              style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}
            >
              <Field label="Ward Name" required value={wardForm.name} onChange={(e) => setWardForm({ ...wardForm, name: e.target.value })} placeholder="e.g. Male Medical Ward" />
              <Field label="Ward Code" required value={wardForm.code} onChange={(e) => setWardForm({ ...wardForm, code: e.target.value })} placeholder="e.g. WARD-MM1" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <Field label="Floor" value={wardForm.floor} onChange={(e) => setWardForm({ ...wardForm, floor: e.target.value })} />
                <Field label="Building" value={wardForm.building} onChange={(e) => setWardForm({ ...wardForm, building: e.target.value })} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                <Button variant="secondary" onClick={() => setNewWardModal(false)} disabled={submitting}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={submitting}>Create Ward</Button>
              </div>
            </form>
          </Dialog>

          {/* Create Room */}
          <Dialog open={newRoomModal} onClose={() => setNewRoomModal(false)} title="Create Inpatient Room">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSubmitting(true);
                try {
                  await axios.post(`${BACKEND_URL}/api/inpatient/rooms`, { ...roomForm, wardId: roomForm.wardId || selectedWardId }, { withCredentials: true });
                  setFeedback(`Room ${roomForm.roomNumber} created successfully`);
                  setNewRoomModal(false);
                  setRoomForm({ wardId: "", roomNumber: "", roomType: "general", dailyTariffMinor: 100000 });
                  await fetchWardsAndBeds();
                } catch (err) {
                  setError(err.response?.data?.message || "Failed to create room");
                } finally {
                  setSubmitting(false);
                }
              }}
              style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}
            >
              <Field label="Room Number" required value={roomForm.roomNumber} onChange={(e) => setRoomForm({ ...roomForm, roomNumber: e.target.value })} placeholder="e.g. 201" />
              <div className="mp-field">
                <label htmlFor="room-type-select" style={{ fontWeight: 600 }}>Room Type: *</label>
                <select id="room-type-select" className="mp-input" value={roomForm.roomType} onChange={(e) => setRoomForm({ ...roomForm, roomType: e.target.value })}>
                  <option value="general">General Ward Bed</option>
                  <option value="semi_private">Semi-Private Room</option>
                  <option value="private">Private Room</option>
                  <option value="deluxe">Deluxe Suite</option>
                  <option value="icu">ICU / Critical Care</option>
                </select>
              </div>
              <Field label="Daily Tariff (Minor/cents)" type="number" min={0} value={roomForm.dailyTariffMinor} onChange={(e) => setRoomForm({ ...roomForm, dailyTariffMinor: e.target.value })} />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                <Button variant="secondary" onClick={() => setNewRoomModal(false)} disabled={submitting}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={submitting}>Create Room</Button>
              </div>
            </form>
          </Dialog>

          {/* Add Bed */}
          <Dialog open={newBedModal} onClose={() => setNewBedModal(false)} title="Add Bed to Room">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSubmitting(true);
                try {
                  await axios.post(
                    `${BACKEND_URL}/api/inpatient/beds`,
                    {
                      wardId: bedForm.wardId || selectedWardId,
                      roomId: bedForm.roomId || rooms[0]?._id,
                      bedNumber: bedForm.bedNumber,
                    },
                    { withCredentials: true }
                  );
                  setFeedback(`Bed ${bedForm.bedNumber} added successfully`);
                  setNewBedModal(false);
                  setBedForm({ wardId: "", roomId: "", bedNumber: "" });
                  await fetchWardsAndBeds();
                } catch (err) {
                  setError(err.response?.data?.message || "Failed to add bed");
                } finally {
                  setSubmitting(false);
                }
              }}
              style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}
            >
              <div className="mp-field">
                <label htmlFor="bed-room-select" style={{ fontWeight: 600 }}>Room: *</label>
                <select
                  id="bed-room-select"
                  className="mp-input"
                  required
                  value={bedForm.roomId || rooms[0]?._id}
                  onChange={(e) => setBedForm({ ...bedForm, roomId: e.target.value })}
                >
                  {rooms.map((r) => (
                    <option key={r._id} value={r._id}>Room {r.roomNumber} ({r.roomType})</option>
                  ))}
                </select>
              </div>
              <Field label="Bed Number / Identifier" required value={bedForm.bedNumber} onChange={(e) => setBedForm({ ...bedForm, bedNumber: e.target.value })} placeholder="e.g. BED-201-A" />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                <Button variant="secondary" onClick={() => setNewBedModal(false)} disabled={submitting}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={submitting}>Add Bed</Button>
              </div>
            </form>
          </Dialog>
        </>
      )}
    </main>
  );
}
