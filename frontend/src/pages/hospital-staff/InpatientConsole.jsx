/* eslint-disable react/prop-types */
import { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import {
  BedDouble,
  RefreshCw,
  Plus,
  ArrowRightLeft,
  CheckCircle2,
  FileText,
  LogOut,
  HeartPulse,
  Activity,
  Pill,
  AlertTriangle,
  Stethoscope,
  ClipboardList,
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

// Client-side instant NEWS2 calculation preview
const computeNews2Preview = (v) => {
  let score = 0;
  const rr = Number(v.respirationRate);
  if (rr) {
    if (rr <= 8 || rr >= 25) score += 3;
    else if (rr >= 21) score += 2;
    else if (rr >= 9 && rr <= 11) score += 1;
  }
  const spo2 = Number(v.spO2);
  if (spo2) {
    if (spo2 <= 91) score += 3;
    else if (spo2 <= 93) score += 2;
    else if (spo2 <= 95) score += 1;
  }
  if (v.supplementalOxygen) score += 2;
  const sbp = Number(v.systolicBP);
  if (sbp) {
    if (sbp <= 90 || sbp >= 220) score += 3;
    else if (sbp <= 100) score += 2;
    else if (sbp <= 110) score += 1;
  }
  const hr = Number(v.pulse);
  if (hr) {
    if (hr <= 40 || hr >= 131) score += 3;
    else if (hr >= 111) score += 2;
    else if (hr <= 50 || hr >= 91) score += 1;
  }
  if (v.consciousness && v.consciousness !== "A") score += 3;
  const temp = Number(v.temperature);
  if (temp) {
    if (temp <= 35.0) score += 3;
    else if (temp >= 39.1) score += 2;
    else if (temp <= 36.0 || temp >= 38.1) score += 1;
  }

  let risk = "LOW";
  let tone = "positive";
  if (score >= 7) {
    risk = "HIGH (Code Blue Outreach)";
    tone = "danger";
  } else if (score >= 5) {
    risk = "MEDIUM (Urgent Doctor Review)";
    tone = "warning";
  } else if (score >= 1) {
    risk = "LOW-MEDIUM";
    tone = "info";
  }
  return { score, risk, tone };
};

export default function InpatientConsole({ initialTab = "beds" }) {
  const { staffUser, isStaffAuth } = useAuth();
  if (!isStaffAuth) {
    return (
      <main className="mp-page mp-enterprise">
        <Card>
          <h1>Hospital Staff Authentication Required</h1>
          <p>Please sign in with your hospital staff account to access inpatient bed management and nursing care.</p>
        </Card>
      </main>
    );
  }
  return <InpatientWorkspace key={`${staffUser?._id || staffUser?.id}:${staffUser?.hospitalId}:${staffUser?.role}:${Boolean(staffUser?.adminAccess)}`} initialTab={initialTab} />;
}

function InpatientWorkspace({ initialTab = "beds" }) {
  const { staffUser } = useAuth();
  const isAdmin = staffUser?.role === "HOSPITAL_ADMIN" || Boolean(staffUser?.adminAccess);
  const isDoctor = staffUser?.role === "DOCTOR" || staffUser?.role === "DEPARTMENT_HEAD";
  const isNurse = staffUser?.role === "NURSE" || staffUser?.role === "DEPARTMENT_HEAD";
  const isPharmacist = staffUser?.role === "PHARMACIST";
  const isReception = staffUser?.role === "RECEPTIONIST" || staffUser?.role === "HOSPITAL_ADMIN";

  // Active top tab: "beds" | "nursing" | "handovers"
  const [activeTab, setActiveTab] = useState(initialTab);

  // Wards, rooms, beds
  const [wards, setWards] = useState([]);
  const [selectedWardId, setSelectedWardId] = useState("");
  const [rooms, setRooms] = useState([]);
  const [beds, setBeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Bed Board Dialog states
  const [admitModalBed, setAdmitModalBed] = useState(null);
  const [transferModalBed, setTransferModalBed] = useState(null);
  const [clearanceModalBed, setClearanceModalBed] = useState(null);
  const [dischargeModalBed, setDischargeModalBed] = useState(null);
  const [timelineModalAdmissionId, setTimelineModalAdmissionId] = useState(null);
  const [statusModalBed, setStatusModalBed] = useState(null);
  const [newWardModal, setNewWardModal] = useState(false);
  const [newRoomModal, setNewRoomModal] = useState(false);
  const [newBedModal, setNewBedModal] = useState(false);

  // Bed Board Form states
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

  const [wardForm, setWardForm] = useState({ name: "", code: "", floor: "1", building: "Main", genderPolicy: "all" });
  const [roomForm, setRoomForm] = useState({ wardId: "", roomNumber: "", roomType: "general", dailyTariffMinor: 100000 });
  const [bedForm, setBedForm] = useState({ wardId: "", roomId: "", bedNumber: "" });
  const [statusUpdateForm, setStatusUpdateForm] = useState({ targetStatus: "cleaning", reason: "" });

  // -------------------------------------------------------------
  // Clinical Nursing, Orders & eMAR Flowsheet States
  // -------------------------------------------------------------
  const [selectedAdmissionId, setSelectedAdmissionId] = useState("");
  const [flowsheetLoading, setFlowsheetLoading] = useState(false);
  const [flowsheetData, setFlowsheetData] = useState({ activeOrders: [], vitalsHistory: [], emarSchedule: [] });

  // Order modal states
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderForm, setOrderForm] = useState({
    orderType: "medication",
    drugName: "",
    dose: "",
    route: "oral",
    frequency: "od",
    durationDays: 3,
    isHighAlert: false,
    isControlledSubstance: false,
    nursingInstructions: "",
    specialInstructions: "",
  });
  const [discontinueModalOrder, setDiscontinueModalOrder] = useState(null);
  const [discontinueReason, setDiscontinueReason] = useState("");

  // Vitals modal states
  const [vitalsModalOpen, setVitalsModalOpen] = useState(false);
  const [vitalsForm, setVitalsForm] = useState({
    respirationRate: "16",
    spO2: "98",
    supplementalOxygen: false,
    systolicBP: "120",
    diastolicBP: "80",
    pulse: "72",
    consciousness: "A",
    temperature: "37.0",
    painScore: "0",
    bloodGlucose: "",
  });

  // eMAR administration modal states
  const [administerModalEmar, setAdministerModalEmar] = useState(null);
  const [fiveRights, setFiveRights] = useState({
    rightPatient: false,
    rightDrug: false,
    rightDose: false,
    rightRoute: false,
    rightTime: false,
  });
  const [dualWitnessStaffId, setDualWitnessStaffId] = useState("");
  const [dualWitnessSignature, setDualWitnessSignature] = useState("");
  const [injectionSite, setInjectionSite] = useState("");

  // eMAR omission modal states
  const [omitModalEmar, setOmitModalEmar] = useState(null);
  const [omissionReason, setOmissionReason] = useState("patient_refused");
  const [omissionNote, setOmissionNote] = useState("");

  // -------------------------------------------------------------
  // Nurse Shift Handover States
  // -------------------------------------------------------------
  const [handoversList, setHandoversList] = useState([]);
  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [handoverForm, setHandoverForm] = useState({
    wardId: "",
    shiftDate: new Date().toISOString().substring(0, 10),
    shiftType: "morning",
    incomingNurseStaffId: "",
    handoverNotes: "",
    criticalAlerts: "",
  });

  const [submitting, setSubmitting] = useState(false);

  // Load Wards & Beds
  const fetchWardsAndBeds = useCallback(async () => {
    setLoading(true);
    try {
      const wardsRes = await axios.get(`${BACKEND_URL}/api/inpatient/wards`, { withCredentials: true });
      const loadedWards = wardsRes.data.wards || [];
      setWards(loadedWards);

      const targetWardId = selectedWardId || loadedWards[0]?._id;
      if (targetWardId) {
        if (!selectedWardId) setSelectedWardId(targetWardId);
        const [roomsRes, bedsRes] = await Promise.all([
          axios.get(`${BACKEND_URL}/api/inpatient/rooms?wardId=${targetWardId}`, { withCredentials: true }),
          axios.get(`${BACKEND_URL}/api/inpatient/beds?wardId=${targetWardId}`, { withCredentials: true }),
        ]);
        setRooms(roomsRes.data.rooms || []);
        const loadedBeds = bedsRes.data.beds || [];
        setBeds(loadedBeds);

        // Auto-select first occupied bed admission if none selected
        const occupied = loadedBeds.find((b) => b.currentAdmissionId);
        if (occupied && !selectedAdmissionId) {
          setSelectedAdmissionId(String(occupied.currentAdmissionId));
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load inpatient data");
    } finally {
      setLoading(false);
    }
  }, [selectedWardId, selectedAdmissionId]);

  useEffect(() => {
    fetchWardsAndBeds();
  }, [fetchWardsAndBeds]);

  // Load Clinical Flowsheet for selected admission
  const fetchFlowsheet = useCallback(async () => {
    if (!selectedAdmissionId) return;
    setFlowsheetLoading(true);
    try {
      const res = await axios.get(`${BACKEND_URL}/api/nursing/admissions/${selectedAdmissionId}/flowsheet`, {
        withCredentials: true,
      });
      setFlowsheetData(res.data || { activeOrders: [], vitalsHistory: [], emarSchedule: [] });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load clinical flowsheet");
    } finally {
      setFlowsheetLoading(false);
    }
  }, [selectedAdmissionId]);

  useEffect(() => {
    if (activeTab === "nursing" && selectedAdmissionId) {
      fetchFlowsheet();
    }
  }, [activeTab, selectedAdmissionId, fetchFlowsheet]);

  // Load Shift Handovers
  const fetchHandovers = useCallback(async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/api/nursing/handovers`, { withCredentials: true });
      setHandoversList(res.data.handovers || []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load shift handovers");
    }
  }, []);

  useEffect(() => {
    if (activeTab === "handovers") {
      fetchHandovers();
    }
  }, [activeTab, fetchHandovers]);

  // Open flowsheet from a bed card
  const openFlowsheetForBed = (bed) => {
    if (bed.currentAdmissionId) {
      setSelectedAdmissionId(String(bed.currentAdmissionId));
      setActiveTab("nursing");
    }
  };

  // Handle Bed Admission Submit
  const handleAdmitSubmit = async (e) => {
    e.preventDefault();
    if (!admitModalBed) return;
    setSubmitting(true);
    setError("");
    setFeedback("");
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/inpatient/admit`,
        {
          bedId: admitModalBed._id,
          patientId: admitForm.patientId,
          admittingDiagnosis: admitForm.admittingDiagnosis,
          departmentId: admitForm.departmentId || undefined,
          admittingDoctorId: admitForm.admittingDoctorId || undefined,
          advanceDepositMinor: Number(admitForm.advanceDepositMinor) || 0,
          estimatedLengthOfStayDays: Number(admitForm.estimatedLengthOfStayDays) || 3,
        },
        { withCredentials: true }
      );
      setFeedback(`Patient admitted successfully. Admission Number: ${res.data.admission.admissionNumber}`);
      setAdmitModalBed(null);
      setAdmitForm({ patientId: "", admittingDiagnosis: "", departmentId: "", admittingDoctorId: "", advanceDepositMinor: 0, estimatedLengthOfStayDays: 3 });
      await fetchWardsAndBeds();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to admit patient");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Transfer Bed Submit
  const handleTransferSubmit = async (e) => {
    e.preventDefault();
    if (!transferModalBed || !transferModalBed.currentAdmissionId) return;
    setSubmitting(true);
    setError("");
    setFeedback("");
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
      setError(err.response?.data?.message || "Failed to transfer bed");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Multi-Department Clearance
  const handleClearance = async (admissionId, clearanceType) => {
    setSubmitting(true);
    setError("");
    setFeedback("");
    try {
      await axios.post(
        `${BACKEND_URL}/api/inpatient/admissions/${admissionId}/clearance`,
        { clearanceType },
        { withCredentials: true }
      );
      setFeedback(`${clearanceType.toUpperCase()} clearance recorded successfully`);
      setClearanceModalBed(null);
      await fetchWardsAndBeds();
    } catch (err) {
      setError(err.response?.data?.message || `Failed to record ${clearanceType} clearance`);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Discharge Finalization
  const handleDischargeSubmit = async (e) => {
    e.preventDefault();
    if (!dischargeModalBed || !dischargeModalBed.currentAdmissionId) return;
    setSubmitting(true);
    setError("");
    setFeedback("");
    try {
      await axios.post(
        `${BACKEND_URL}/api/inpatient/admissions/${dischargeModalBed.currentAdmissionId}/discharge`,
        {
          dischargeSummary: {
            summaryText: dischargeForm.summaryText,
            dischargeCondition: dischargeForm.dischargeCondition,
            followUpPlan: dischargeForm.followUpPlan,
          },
        },
        { withCredentials: true }
      );
      setFeedback(`Patient discharged successfully. Bed moved to cleaning.`);
      setDischargeModalBed(null);
      setDischargeForm({ summaryText: "", dischargeCondition: "improved", followUpPlan: "" });
      await fetchWardsAndBeds();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to discharge patient");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Bed Status Update
  const handleStatusUpdateSubmit = async (e) => {
    e.preventDefault();
    if (!statusModalBed) return;
    setSubmitting(true);
    setError("");
    setFeedback("");
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

  // Handle Inpatient Clinical Order Submit
  const handleCreateOrderSubmit = async (e) => {
    e.preventDefault();
    if (!selectedAdmissionId) return;
    setSubmitting(true);
    setError("");
    setFeedback("");
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/nursing/orders`,
        {
          admissionId: selectedAdmissionId,
          orderType: orderForm.orderType,
          medicationDetails: {
            drugName: orderForm.drugName,
            dose: orderForm.dose,
            route: orderForm.route,
            frequency: orderForm.frequency,
            durationDays: Number(orderForm.durationDays) || 1,
            isHighAlert: orderForm.isHighAlert,
            isControlledSubstance: orderForm.isControlledSubstance,
            specialInstructions: orderForm.specialInstructions,
          },
          nursingInstructions: orderForm.nursingInstructions,
        },
        { withCredentials: true }
      );
      setFeedback(`Order created successfully. Generated ${res.data.scheduledDosesCount || 0} scheduled eMAR doses.`);
      setOrderModalOpen(false);
      setOrderForm({
        orderType: "medication",
        drugName: "",
        dose: "",
        route: "oral",
        frequency: "od",
        durationDays: 3,
        isHighAlert: false,
        isControlledSubstance: false,
        nursingInstructions: "",
        specialInstructions: "",
      });
      await fetchFlowsheet();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create order");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Order Discontinue
  const handleDiscontinueOrderSubmit = async (e) => {
    e.preventDefault();
    if (!discontinueModalOrder) return;
    setSubmitting(true);
    setError("");
    setFeedback("");
    try {
      await axios.post(
        `${BACKEND_URL}/api/nursing/orders/${discontinueModalOrder._id}/discontinue`,
        { reason: discontinueReason },
        { withCredentials: true }
      );
      setFeedback("Order discontinued and future scheduled doses cancelled.");
      setDiscontinueModalOrder(null);
      setDiscontinueReason("");
      await fetchFlowsheet();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to discontinue order");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Vitals Logging Submit
  const handleVitalsSubmit = async (e) => {
    e.preventDefault();
    if (!selectedAdmissionId) return;
    setSubmitting(true);
    setError("");
    setFeedback("");
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/nursing/admissions/${selectedAdmissionId}/vitals`,
        {
          vitals: {
            respirationRate: Number(vitalsForm.respirationRate),
            spO2: Number(vitalsForm.spO2),
            supplementalOxygen: Boolean(vitalsForm.supplementalOxygen),
            systolicBP: Number(vitalsForm.systolicBP),
            diastolicBP: Number(vitalsForm.diastolicBP) || 80,
            pulse: Number(vitalsForm.pulse),
            consciousness: vitalsForm.consciousness,
            temperature: Number(vitalsForm.temperature),
            painScore: Number(vitalsForm.painScore) || 0,
            bloodGlucose: vitalsForm.bloodGlucose ? Number(vitalsForm.bloodGlucose) : null,
          },
        },
        { withCredentials: true }
      );
      const news2 = res.data.news2;
      setFeedback(`Vitals recorded! NEWS2 Score: ${news2.score} (${news2.riskLevel}). ${news2.action}`);
      setVitalsModalOpen(false);
      await fetchFlowsheet();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to record nursing vitals");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Bedside eMAR Medication Administration Submit
  const handleAdministerSubmit = async (e) => {
    e.preventDefault();
    if (!administerModalEmar) return;
    const { rightPatient, rightDrug, rightDose, rightRoute, rightTime } = fiveRights;
    if (!rightPatient || !rightDrug || !rightDose || !rightRoute || !rightTime) {
      setError("Mandatory 5-Rights Bedside Verification required before administering medication.");
      return;
    }

    setSubmitting(true);
    setError("");
    setFeedback("");
    try {
      await axios.post(
        `${BACKEND_URL}/api/nursing/emar/${administerModalEmar._id}/administer`,
        {
          fiveRightsVerified: fiveRights,
          dualWitnessStaffId: dualWitnessStaffId || undefined,
          dualWitnessSignature: dualWitnessSignature || undefined,
          injectionSite: injectionSite || undefined,
        },
        { withCredentials: true }
      );
      setFeedback("Medication administered and eMAR updated successfully.");
      setAdministerModalEmar(null);
      setFiveRights({ rightPatient: false, rightDrug: false, rightDose: false, rightRoute: false, rightTime: false });
      setDualWitnessStaffId("");
      setDualWitnessSignature("");
      setInjectionSite("");
      await fetchFlowsheet();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to administer medication");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Medication Omission / Refusal Submit
  const handleOmitSubmit = async (e) => {
    e.preventDefault();
    if (!omitModalEmar) return;
    setSubmitting(true);
    setError("");
    setFeedback("");
    try {
      await axios.post(
        `${BACKEND_URL}/api/nursing/emar/${omitModalEmar._id}/omit`,
        {
          omissionReason,
          omissionNote,
        },
        { withCredentials: true }
      );
      setFeedback(`Medication dose marked as ${omissionReason === "patient_refused" ? "refused" : "omitted"}.`);
      setOmitModalEmar(null);
      setOmissionReason("patient_refused");
      setOmissionNote("");
      await fetchFlowsheet();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to record medication omission");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Nurse Shift Handover Submit
  const handleShiftHandoverSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setFeedback("");
    try {
      const activeAdmissions = beds.filter((b) => b.currentAdmissionId).map((b) => ({
        admissionId: b.currentAdmissionId,
        bedNumber: b.bedNumber,
        news2Score: 0,
        criticalAlerts: handoverForm.criticalAlerts,
      }));

      const res = await axios.post(
        `${BACKEND_URL}/api/nursing/handover`,
        {
          wardId: handoverForm.wardId || selectedWardId,
          shiftDate: handoverForm.shiftDate,
          shiftType: handoverForm.shiftType,
          incomingNurseStaffId: handoverForm.incomingNurseStaffId,
          patientSummaries: activeAdmissions,
          handoverNotes: handoverForm.handoverNotes,
        },
        { withCredentials: true }
      );
      setFeedback(`Shift handover recorded for ${handoverForm.shiftType} shift (${res.data.handover.totalPatients} patients).`);
      setHandoverModalOpen(false);
      setHandoverForm({
        wardId: selectedWardId,
        shiftDate: new Date().toISOString().substring(0, 10),
        shiftType: "morning",
        incomingNurseStaffId: "",
        handoverNotes: "",
        criticalAlerts: "",
      });
      await fetchHandovers();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to record shift handover");
    } finally {
      setSubmitting(false);
    }
  };

  // Stats calculation for Bed Board
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

  const occupiedBedOptions = beds.filter((b) => b.currentAdmissionId);
  const news2Preview = useMemo(() => computeNews2Preview(vitalsForm), [vitalsForm]);

  return (
    <main className="mp-page mp-enterprise">
      <header className="mp-page-header" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
              <BedDouble aria-hidden="true" size={28} />
              Inpatient Clinical & Nursing Console
            </h1>
            <p className="mp-muted" style={{ margin: "0.25rem 0 0 0" }}>
              Enterprise ADT bed board, clinical orders, NEWS2 vitals early warning, eMAR bedside administration & shift handovers
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <Button variant="secondary" onClick={activeTab === "beds" ? fetchWardsAndBeds : activeTab === "nursing" ? fetchFlowsheet : fetchHandovers} disabled={loading || flowsheetLoading}>
              <RefreshCw size={16} className={loading || flowsheetLoading ? "mp-spin" : ""} /> Refresh
            </Button>
            {isAdmin && activeTab === "beds" && (
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

        {/* Console Navigation Tabs */}
        <div className="mp-enterprise-tabs" style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--mp-border)", marginTop: "1rem", paddingTop: "0.5rem" }}>
          <button
            type="button"
            className={`mp-button ${activeTab === "beds" ? "mp-button--primary" : "mp-button--secondary"}`}
            style={{ borderRadius: "8px 8px 0 0", borderBottom: "none" }}
            onClick={() => setActiveTab("beds")}
          >
            <BedDouble size={16} /> Bed Board & ADT
          </button>
          <button
            type="button"
            className={`mp-button ${activeTab === "nursing" ? "mp-button--primary" : "mp-button--secondary"}`}
            style={{ borderRadius: "8px 8px 0 0", borderBottom: "none" }}
            onClick={() => setActiveTab("nursing")}
          >
            <HeartPulse size={16} /> Nursing Care, Orders & eMAR
          </button>
          <button
            type="button"
            className={`mp-button ${activeTab === "handovers" ? "mp-button--primary" : "mp-button--secondary"}`}
            style={{ borderRadius: "8px 8px 0 0", borderBottom: "none" }}
            onClick={() => setActiveTab("handovers")}
          >
            <ClipboardList size={16} /> Nurse Shift Handover
          </button>
        </div>
      </header>

      {error && (
        <Banner tone="danger" style={{ marginBottom: "1rem" }} onDismiss={() => setError("")}>
          {error}
        </Banner>
      )}
      {feedback && (
        <Banner tone="positive" style={{ marginBottom: "1rem" }} onDismiss={() => setFeedback("")}>
          {feedback}
        </Banner>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: BED BOARD & ADT */}
      {/* ========================================================================= */}
      {activeTab === "beds" && (
        <>
          {/* Metrics bar */}
          <section className="mp-enterprise-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "1rem",
              marginBottom: "1.5rem",
            }}
          >
            <Card style={{ padding: "1rem", textAlign: "center" }}>
              <div className="mp-muted" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>Total Beds</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{totalBeds}</div>
            </Card>
            <Card style={{ padding: "1rem", textAlign: "center" }}>
              <div className="mp-muted" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>Occupied</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--mp-primary, #0284c7)" }}>{occupiedBeds}</div>
            </Card>
            <Card style={{ padding: "1rem", textAlign: "center" }}>
              <div className="mp-muted" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>Available</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--mp-success, #16a34a)" }}>{availableBeds}</div>
            </Card>
            <Card style={{ padding: "1rem", textAlign: "center" }}>
              <div className="mp-muted" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>Cleaning</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--mp-warning, #d97706)" }}>{cleaningBeds}</div>
            </Card>
            <Card style={{ padding: "1rem", textAlign: "center" }}>
              <div className="mp-muted" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>Maintenance</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--mp-error, #dc2626)" }}>{maintenanceBeds}</div>
            </Card>
            <Card style={{ padding: "1rem", textAlign: "center" }}>
              <div className="mp-muted" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>Occupancy Rate</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{occupancyRate}%</div>
            </Card>
          </section>

          {/* Ward Selector & Status Filter Bar */}
          <Card style={{ marginBottom: "1.5rem", padding: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
                <label htmlFor="ward-select" style={{ fontWeight: 600 }}>Active Ward:</label>
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
            <section className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1.25rem" }}>
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
                        <div style={{ background: "var(--mp-surface-subtle, var(--mp-surface-subtle))", padding: "0.75rem", borderRadius: "6px", margin: "0.75rem 0", fontSize: "0.85rem" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b" }}>Active Patient Admission</div>
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

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--mp-border)" }}>
                      {bed.status === "available" && (
                        <Button variant="primary" size="small" onClick={() => setAdmitModalBed(bed)}>
                          Admit Patient
                        </Button>
                      )}

                      {bed.status === "occupied" && (
                        <>
                          <Button variant="primary" size="small" onClick={() => openFlowsheetForBed(bed)}>
                            <HeartPulse size={14} /> Care & eMAR
                          </Button>
                          <Button variant="secondary" size="small" onClick={() => setTransferModalBed(bed)}>
                            <ArrowRightLeft size={14} /> Transfer
                          </Button>
                          <Button variant="secondary" size="small" onClick={() => setClearanceModalBed(bed)}>
                            <CheckCircle2 size={14} /> Clearance
                          </Button>
                          <Button variant="secondary" size="small" onClick={() => setDischargeModalBed(bed)}>
                            <LogOut size={14} /> Discharge
                          </Button>
                        </>
                      )}

                      {(bed.status === "cleaning" || bed.status === "maintenance" || isNurse || isAdmin) && (
                        <Button variant="secondary" size="small" onClick={() => setStatusModalBed(bed)}>
                          Change Status
                        </Button>
                      )}

                      {bed.currentAdmissionId && (
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => {
                            setTimelineModalAdmissionId(bed.currentAdmissionId);
                            setTimelineLoading(true);
                            axios.get(`${BACKEND_URL}/api/inpatient/admissions/${bed.currentAdmissionId}/timeline`, { withCredentials: true })
                              .then((r) => setTimelineData(r.data.timeline))
                              .catch((err) => setError(err.response?.data?.message || "Failed to load timeline"))
                              .finally(() => setTimelineLoading(false));
                          }}
                        >
                          <FileText size={14} /> Timeline
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </section>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: NURSING CARE, CLINICAL ORDERS & eMAR */}
      {/* ========================================================================= */}
      {activeTab === "nursing" && (
        <section style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Active Admission Selector */}
          <Card style={{ padding: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
                <label htmlFor="admission-selector" style={{ fontWeight: 600 }}>Active Inpatient:</label>
                <select
                  id="admission-selector"
                  className="mp-input"
                  value={selectedAdmissionId}
                  onChange={(e) => setSelectedAdmissionId(e.target.value)}
                  style={{ minWidth: 260 }}
                >
                  <option value="">-- Select Admitted Patient --</option>
                  {occupiedBedOptions.map((b) => (
                    <option key={b._id} value={b.currentAdmissionId}>
                      Bed {b.bedNumber} (Admission: {String(b.currentAdmissionId).substring(0, 8)}...)
                    </option>
                  ))}
                </select>
              </div>

              {selectedAdmissionId && (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <Button variant="secondary" onClick={() => setVitalsModalOpen(true)}>
                    <Activity size={16} /> Record Vitals (NEWS2)
                  </Button>
                  {isDoctor && (
                    <Button variant="primary" onClick={() => setOrderModalOpen(true)}>
                      <Plus size={16} /> Prescribe Order
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>

          {!selectedAdmissionId ? (
            <EmptyState title="No Inpatient Selected">
              Select an admitted patient above or click &quot;Care &amp; eMAR&quot; on an occupied bed in the Bed Board.
            </EmptyState>
          ) : flowsheetLoading ? (
            <LoadingState>Loading clinical flowsheet, orders, and eMAR schedule...</LoadingState>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {/* NEWS2 Vitals Flowsheet Section */}
              <Card style={{ padding: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.15rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <Activity size={20} className="text-teal-600" />
                      High-Frequency Nursing Vitals & Objective NEWS2 Scoring
                    </h2>
                    <p className="mp-muted" style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem" }}>
                      National Early Warning Score 2 (NEWS2) calculated deterministically across RR, SpO2, BP, pulse, AVPU, temperature
                    </p>
                  </div>
                  <Button variant="secondary" size="small" onClick={() => setVitalsModalOpen(true)}>
                    + New Vitals Reading
                  </Button>
                </div>

                {flowsheetData.vitalsHistory.length === 0 ? (
                  <div className="mp-muted" style={{ padding: "1rem", textAlign: "center" }}>
                    No vitals recorded for this admission yet. Click &quot;New Vitals Reading&quot; to record the baseline.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="mp-table" style={{ width: "100%", fontSize: "0.85rem" }}>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>RR (/min)</th>
                          <th>SpO2</th>
                          <th>Supp O2</th>
                          <th>BP (mmHg)</th>
                          <th>Pulse (bpm)</th>
                          <th>AVPU</th>
                          <th>Temp (°C)</th>
                          <th>NEWS2 Score</th>
                          <th>Clinical Action</th>
                          <th>Recorded By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flowsheetData.vitalsHistory.map((vh) => {
                          const n = vh.news2 || {};
                          const scoreTone = n.score >= 7 ? "danger" : n.score >= 5 ? "warning" : n.score >= 1 ? "info" : "positive";
                          return (
                            <tr key={vh._id} style={{ background: n.score >= 7 ? "rgba(220, 38, 38, 0.05)" : undefined }}>
                              <td>{new Date(vh.recordedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                              <td>{vh.respirationRate}</td>
                              <td>{vh.spO2}%</td>
                              <td>{vh.supplementalOxygen ? "Yes" : "Air"}</td>
                              <td>{vh.systolicBP}/{vh.diastolicBP}</td>
                              <td>{vh.pulse}</td>
                              <td>{vh.consciousness}</td>
                              <td>{vh.temperature}°</td>
                              <td>
                                <StatusBadge status={`${n.score} - ${n.riskLevel}`} tone={scoreTone} />
                              </td>
                              <td style={{ fontSize: "0.8rem", color: n.score >= 7 ? "#dc2626" : undefined, fontWeight: n.score >= 7 ? 600 : 400 }}>
                                {n.action}
                              </td>
                              <td>{vh.recordedByStaffId?.name || "Staff Nurse"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* Inpatient Clinical Orders Section */}
              <Card style={{ padding: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.15rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <Stethoscope size={20} className="text-blue-600" />
                      Clinician Orders (Medications, Monitoring & Care)
                    </h2>
                    <p className="mp-muted" style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem" }}>
                      Doctor-prescribed inpatient treatment plans with versioned changes and automated eMAR administration scheduling
                    </p>
                  </div>
                  {isDoctor && (
                    <Button variant="secondary" size="small" onClick={() => setOrderModalOpen(true)}>
                      + New Order
                    </Button>
                  )}
                </div>

                {flowsheetData.activeOrders.length === 0 ? (
                  <div className="mp-muted" style={{ padding: "1rem", textAlign: "center" }}>
                    No active clinical orders. Click &quot;+ New Order&quot; to prescribe medications or monitoring.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {flowsheetData.activeOrders.map((order) => {
                      const med = order.medicationDetails || {};
                      return (
                        <div
                          key={order._id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "0.75rem 1rem",
                            border: "1px solid var(--mp-border)",
                            borderRadius: "6px",
                            background: "var(--mp-surface-subtle, var(--mp-surface-subtle))",
                          }}
                        >
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ fontWeight: 700, fontSize: "1rem" }}>
                                {order.orderType === "medication" ? med.drugName : order.orderType.toUpperCase()}
                              </span>
                              {order.orderType === "medication" && (
                                <span className="mp-badge mp-badge--info">
                                  {med.dose} • {med.route?.toUpperCase()} • {med.frequency?.toUpperCase()} ({med.durationDays} days)
                                </span>
                              )}
                              {med.isControlledSubstance && (
                                <span className="mp-badge mp-badge--danger" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                                  <AlertTriangle size={12} /> Schedule X / Narcotic
                                </span>
                              )}
                              {med.isHighAlert && <span className="mp-badge mp-badge--warning">High-Alert</span>}
                            </div>
                            <div className="mp-muted" style={{ fontSize: "0.82rem", marginTop: "0.25rem" }}>
                              {order.nursingInstructions && `Nursing: ${order.nursingInstructions} • `}
                              Prescribed by: {order.prescribedByDoctorId?.name || "Consultant"}
                            </div>
                          </div>

                          {isDoctor && (
                            <Button
                              variant="secondary"
                              size="small"
                              onClick={() => {
                                setDiscontinueModalOrder(order);
                                setDiscontinueReason("");
                              }}
                            >
                              Discontinue
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Electronic Medication Administration Record (eMAR) Section */}
              <Card style={{ padding: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.15rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <Pill size={20} className="text-emerald-600" />
                      Electronic Medication Administration Record (eMAR)
                    </h2>
                    <p className="mp-muted" style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem" }}>
                      Bedside 5-Rights verification, Schedule X dual-nurse sign-off, and structured omission logging
                    </p>
                  </div>
                </div>

                {flowsheetData.emarSchedule.length === 0 ? (
                  <div className="mp-muted" style={{ padding: "1rem", textAlign: "center" }}>
                    No scheduled medication administrations. Prescribe a medication order to populate the eMAR.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="mp-table" style={{ width: "100%", fontSize: "0.85rem" }}>
                      <thead>
                        <tr>
                          <th>Scheduled Time</th>
                          <th>Medication & Dose</th>
                          <th>Route</th>
                          <th>Status</th>
                          <th>Administered At / By</th>
                          <th>Witness</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flowsheetData.emarSchedule.map((emar) => {
                          const order = emar.orderId || {};
                          const med = order.medicationDetails || {};
                          const emarTone =
                            emar.status === "administered"
                              ? "positive"
                              : emar.status === "scheduled"
                              ? "info"
                              : emar.status === "omitted" || emar.status === "refused"
                              ? "warning"
                              : "neutral";

                          return (
                            <tr key={emar._id}>
                              <td style={{ fontWeight: 600 }}>
                                {new Date(emar.scheduledTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                <div className="mp-muted" style={{ fontSize: "0.75rem" }}>
                                  {new Date(emar.scheduledTime).toLocaleDateString()}
                                </div>
                              </td>
                              <td>
                                <span style={{ fontWeight: 600 }}>{med.drugName || "Medication"}</span> ({med.dose || "—"})
                                {med.isControlledSubstance && (
                                  <div style={{ color: "#dc2626", fontSize: "0.75rem", fontWeight: 600 }}>
                                    Narcotic (Dual-Witness Req.)
                                  </div>
                                )}
                              </td>
                              <td>{med.route?.toUpperCase() || "ORAL"}</td>
                              <td>
                                <StatusBadge status={emar.status} tone={emarTone} />
                                {emar.omissionReason && (
                                  <div className="mp-muted" style={{ fontSize: "0.75rem" }}>
                                    Reason: {emar.omissionReason}
                                  </div>
                                )}
                              </td>
                              <td>
                                {emar.administeredAt ? (
                                  <>
                                    <div>{new Date(emar.administeredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                                    <div className="mp-muted" style={{ fontSize: "0.75rem" }}>
                                      {emar.administeredByStaffId?.name || "Staff Nurse"}
                                    </div>
                                  </>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td>
                                {emar.dualWitnessSignature ? (
                                  <div style={{ fontSize: "0.8rem", color: "#16a34a", fontWeight: 600 }}>
                                    ✓ {emar.dualWitnessSignature}
                                  </div>
                                ) : med.isControlledSubstance ? (
                                  <span style={{ fontSize: "0.75rem", color: "#d97706" }}>Pending witness</span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td>
                                {emar.status === "scheduled" && (
                                  <div style={{ display: "flex", gap: "0.4rem" }}>
                                    <Button
                                      variant="primary"
                                      size="small"
                                      onClick={() => {
                                        setAdministerModalEmar(emar);
                                        setFiveRights({ rightPatient: false, rightDrug: false, rightDose: false, rightRoute: false, rightTime: false });
                                        setDualWitnessStaffId("");
                                        setDualWitnessSignature("");
                                        setInjectionSite("");
                                      }}
                                    >
                                      Administer
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      size="small"
                                      onClick={() => {
                                        setOmitModalEmar(emar);
                                        setOmissionReason("patient_refused");
                                        setOmissionNote("");
                                      }}
                                    >
                                      Omit / Refuse
                                    </Button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}
        </section>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: NURSE SHIFT HANDOVER */}
      {/* ========================================================================= */}
      {activeTab === "handovers" && (
        <section style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <Card style={{ padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <ClipboardList size={22} className="text-teal-600" />
                  Nurse Shift Handover Protocol
                </h2>
                <p className="mp-muted" style={{ margin: "0.25rem 0 0 0" }}>
                  Mandatory structured handover between distinct nurses with patient summaries, critical alerts, and Code Blue logs
                </p>
              </div>
              <Button variant="primary" onClick={() => setHandoverModalOpen(true)}>
                <Plus size={16} /> Record Shift Handover
              </Button>
            </div>
          </Card>

          {handoversList.length === 0 ? (
            <EmptyState title="No Handovers Recorded">
              No shift handovers logged yet. Click &quot;Record Shift Handover&quot; at change of shift.
            </EmptyState>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {handoversList.map((h) => (
                <Card key={h._id} style={{ padding: "1.25rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ fontWeight: 700, fontSize: "1.1rem", textTransform: "capitalize" }}>
                          {h.shiftType} Shift
                        </span>
                        <span className="mp-badge mp-badge--info">{h.shiftDate}</span>
                        {h.criticalPatientsCount > 0 && (
                          <span className="mp-badge mp-badge--danger">
                            {h.criticalPatientsCount} High NEWS2 Patient(s)
                          </span>
                        )}
                      </div>
                      <div className="mp-muted" style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
                        Ward: {h.wardId?.name || "General Ward"} • Outgoing Nurse: {h.outgoingNurseStaffId?.name || "Staff Nurse"} ➔ Incoming Nurse: {h.incomingNurseStaffId?.name || "Relieving Nurse"}
                      </div>
                    </div>
                    <span className="mp-badge mp-badge--positive" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                      <CheckCircle2 size={12} /> Acknowledged
                    </span>
                  </div>

                  {h.handoverNotes && (
                    <div style={{ background: "var(--mp-surface-subtle, var(--mp-surface-subtle))", padding: "0.75rem", borderRadius: "6px", fontSize: "0.88rem", marginTop: "0.5rem" }}>
                      <strong>Handover Notes:</strong> {h.handoverNotes}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}

      {/* 1. Vitals Entry Modal with Instant NEWS2 Preview */}
      {vitalsModalOpen && (
        <Dialog title="Record High-Frequency Vitals (NEWS2)" onClose={() => setVitalsModalOpen(false)}>
          <form onSubmit={handleVitalsSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
            <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <Field
                label="Respiration Rate (/min)"
                required
                type="number"
                value={vitalsForm.respirationRate}
                onChange={(e) => setVitalsForm({ ...vitalsForm, respirationRate: e.target.value })}
                placeholder="e.g. 16"
              />
              <Field
                label="Oxygen Saturation SpO2 (%)"
                required
                type="number"
                value={vitalsForm.spO2}
                onChange={(e) => setVitalsForm({ ...vitalsForm, spO2: e.target.value })}
                placeholder="e.g. 98"
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                id="supp-o2"
                checked={vitalsForm.supplementalOxygen}
                onChange={(e) => setVitalsForm({ ...vitalsForm, supplementalOxygen: e.target.checked })}
              />
              <label htmlFor="supp-o2" style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                Patient is receiving Supplemental Oxygen
              </label>
            </div>

            <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <Field
                label="Systolic BP (mmHg)"
                required
                type="number"
                value={vitalsForm.systolicBP}
                onChange={(e) => setVitalsForm({ ...vitalsForm, systolicBP: e.target.value })}
                placeholder="e.g. 120"
              />
              <Field
                label="Diastolic BP (mmHg)"
                type="number"
                value={vitalsForm.diastolicBP}
                onChange={(e) => setVitalsForm({ ...vitalsForm, diastolicBP: e.target.value })}
                placeholder="e.g. 80"
              />
            </div>

            <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <Field
                label="Pulse / Heart Rate (bpm)"
                required
                type="number"
                value={vitalsForm.pulse}
                onChange={(e) => setVitalsForm({ ...vitalsForm, pulse: e.target.value })}
                placeholder="e.g. 72"
              />
              <div className="mp-field">
                <label htmlFor="consciousness-select" style={{ fontWeight: 600 }}>Consciousness (AVPU):</label>
                <select
                  id="consciousness-select"
                  className="mp-input"
                  value={vitalsForm.consciousness}
                  onChange={(e) => setVitalsForm({ ...vitalsForm, consciousness: e.target.value })}
                >
                  <option value="A">Alert (A)</option>
                  <option value="V">Responds to Voice (V)</option>
                  <option value="P">Responds to Pain (P)</option>
                  <option value="U">Unresponsive (U)</option>
                </select>
              </div>
            </div>

            <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <Field
                label="Temperature (°C)"
                required
                type="number"
                step="0.1"
                value={vitalsForm.temperature}
                onChange={(e) => setVitalsForm({ ...vitalsForm, temperature: e.target.value })}
                placeholder="e.g. 37.0"
              />
              <Field
                label="Pain Score (0-10)"
                type="number"
                min="0"
                max="10"
                value={vitalsForm.painScore}
                onChange={(e) => setVitalsForm({ ...vitalsForm, painScore: e.target.value })}
                placeholder="e.g. 2"
              />
            </div>

            {/* Live NEWS2 Preview Bar */}
            <div
              style={{
                padding: "0.75rem",
                borderRadius: "6px",
                border: "1px solid var(--mp-border)",
                background: news2Preview.score >= 7 ? "#fee2e2" : news2Preview.score >= 5 ? "#fef3c7" : "#ecfdf5",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span style={{ fontWeight: 700 }}>Computed NEWS2 Score: {news2Preview.score}</span>
                <div style={{ fontSize: "0.8rem", color: news2Preview.score >= 7 ? "#b91c1c" : "#1f2937" }}>
                  Risk Category: {news2Preview.risk}
                </div>
              </div>
              <StatusBadge status={`Score: ${news2Preview.score}`} tone={news2Preview.tone} />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setVitalsModalOpen(false)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>Record Vitals</Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* 2. New Clinical Order Modal */}
      {orderModalOpen && (
        <Dialog title="Prescribe Inpatient Order" onClose={() => setOrderModalOpen(false)}>
          <form onSubmit={handleCreateOrderSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
            <div className="mp-field">
              <label htmlFor="order-type-select" style={{ fontWeight: 600 }}>Order Type: *</label>
              <select
                id="order-type-select"
                className="mp-input"
                value={orderForm.orderType}
                onChange={(e) => setOrderForm({ ...orderForm, orderType: e.target.value })}
              >
                <option value="medication">Medication Order</option>
                <option value="investigation">Investigation / Lab Order</option>
                <option value="nursing_care">Nursing Care Order</option>
                <option value="monitoring">Monitoring Order</option>
                <option value="diet">Dietary Order</option>
              </select>
            </div>

            {orderForm.orderType === "medication" ? (
              <>
                <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem" }}>
                  <Field
                    label="Drug Name"
                    required
                    value={orderForm.drugName}
                    onChange={(e) => setOrderForm({ ...orderForm, drugName: e.target.value })}
                    placeholder="e.g. Ceftriaxone or Morphine"
                  />
                  <Field
                    label="Dose"
                    required
                    value={orderForm.dose}
                    onChange={(e) => setOrderForm({ ...orderForm, dose: e.target.value })}
                    placeholder="e.g. 1g or 5mg"
                  />
                </div>

                <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
                  <div className="mp-field">
                    <label htmlFor="route-select" style={{ fontWeight: 600 }}>Route:</label>
                    <select
                      id="route-select"
                      className="mp-input"
                      value={orderForm.route}
                      onChange={(e) => setOrderForm({ ...orderForm, route: e.target.value })}
                    >
                      <option value="oral">Oral</option>
                      <option value="iv">Intravenous (IV)</option>
                      <option value="im">Intramuscular (IM)</option>
                      <option value="sc">Subcutaneous (SC)</option>
                      <option value="inhalation">Inhalation</option>
                      <option value="topical">Topical</option>
                    </select>
                  </div>

                  <div className="mp-field">
                    <label htmlFor="freq-select" style={{ fontWeight: 600 }}>Frequency:</label>
                    <select
                      id="freq-select"
                      className="mp-input"
                      value={orderForm.frequency}
                      onChange={(e) => setOrderForm({ ...orderForm, frequency: e.target.value })}
                    >
                      <option value="stat">STAT (Immediate 1 dose)</option>
                      <option value="od">OD (Once Daily)</option>
                      <option value="bd">BD (Twice Daily - 12h)</option>
                      <option value="tds">TDS (Thrice Daily - 8h)</option>
                      <option value="qid">QID (Four Times Daily - 6h)</option>
                      <option value="prn">PRN (As needed)</option>
                    </select>
                  </div>

                  <Field
                    label="Duration (Days)"
                    required
                    type="number"
                    min="1"
                    value={orderForm.durationDays}
                    onChange={(e) => setOrderForm({ ...orderForm, durationDays: e.target.value })}
                  />
                </div>

                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="checkbox"
                      id="ctrl-sub"
                      checked={orderForm.isControlledSubstance}
                      onChange={(e) => setOrderForm({ ...orderForm, isControlledSubstance: e.target.checked })}
                    />
                    <label htmlFor="ctrl-sub" style={{ fontWeight: 600, color: "#dc2626", fontSize: "0.9rem" }}>
                      Controlled Substance (Schedule X / Narcotic)
                    </label>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="checkbox"
                      id="high-alert"
                      checked={orderForm.isHighAlert}
                      onChange={(e) => setOrderForm({ ...orderForm, isHighAlert: e.target.checked })}
                    />
                    <label htmlFor="high-alert" style={{ fontWeight: 600, color: "#d97706", fontSize: "0.9rem" }}>
                      High-Alert Medication
                    </label>
                  </div>
                </div>
              </>
            ) : null}

            <Field
              label="Nursing Instructions / Infusion Plan"
              value={orderForm.nursingInstructions}
              onChange={(e) => setOrderForm({ ...orderForm, nursingInstructions: e.target.value })}
              placeholder="e.g. Infuse in 100ml Normal Saline over 30 minutes"
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setOrderModalOpen(false)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>Prescribe Order</Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* 3. Discontinue Order Modal */}
      {discontinueModalOrder && (
        <Dialog title="Discontinue Clinical Order" onClose={() => setDiscontinueModalOrder(null)}>
          <form onSubmit={handleDiscontinueOrderSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
            <p>
              Are you sure you want to discontinue the order for{" "}
              <strong>
                {discontinueModalOrder.medicationDetails?.drugName || discontinueModalOrder.orderType}
              </strong>
              ? Future scheduled doses will be cancelled immediately.
            </p>
            <Field
              label="Reason for Discontinuation"
              required
              value={discontinueReason}
              onChange={(e) => setDiscontinueReason(e.target.value)}
              placeholder="e.g. Culture sensitivity changed / de-escalating to oral"
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setDiscontinueModalOrder(null)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>Discontinue Order</Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* 4. Bedside Medication Administration Modal (5-Rights & Dual-Witness) */}
      {administerModalEmar && (
        <Dialog title="Bedside Medication Administration" onClose={() => setAdministerModalEmar(null)}>
          <form onSubmit={handleAdministerSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem", padding: "1rem" }}>
            <div style={{ background: "var(--mp-surface-subtle, var(--mp-surface-subtle))", padding: "0.75rem", borderRadius: "6px" }}>
              <div style={{ fontWeight: 700, fontSize: "1rem" }}>
                {administerModalEmar.orderId?.medicationDetails?.drugName} ({administerModalEmar.orderId?.medicationDetails?.dose})
              </div>
              <div className="mp-muted" style={{ fontSize: "0.85rem" }}>
                Route: {administerModalEmar.orderId?.medicationDetails?.route?.toUpperCase()} • Scheduled: {new Date(administerModalEmar.scheduledTime).toLocaleTimeString()}
              </div>
            </div>

            {/* 5-Rights Checklist */}
            <div style={{ border: "1px solid var(--mp-border)", padding: "1rem", borderRadius: "6px" }}>
              <div style={{ fontWeight: 700, marginBottom: "0.5rem", fontSize: "0.95rem" }}>
                Mandatory 5-Rights Bedside Verification:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {[
                  { key: "rightPatient", label: "1. Right Patient (Barcode/Wristband verified)" },
                  { key: "rightDrug", label: "2. Right Drug (Medication label matches order)" },
                  { key: "rightDose", label: "3. Right Dose (Measurement validated)" },
                  { key: "rightRoute", label: "4. Right Route (Route verified)" },
                  { key: "rightTime", label: "5. Right Time (Scheduled administration window)" },
                ].map(({ key, label }) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="checkbox"
                      id={`right-${key}`}
                      checked={fiveRights[key]}
                      onChange={(e) => setFiveRights({ ...fiveRights, [key]: e.target.checked })}
                    />
                    <label htmlFor={`right-${key}`} style={{ fontSize: "0.88rem" }}>{label}</label>
                  </div>
                ))}
              </div>
            </div>

            {/* Controlled Substance Dual-Nurse Witness */}
            {administerModalEmar.orderId?.medicationDetails?.isControlledSubstance && (
              <div style={{ border: "1px solid #f87171", background: "#fef2f2", padding: "1rem", borderRadius: "6px" }}>
                <div style={{ fontWeight: 700, color: "#dc2626", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <AlertTriangle size={16} /> Secondary Nurse Witness (Schedule X / Narcotic)
                </div>
                <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <Field
                    label="Secondary Witness Staff ID"
                    required
                    value={dualWitnessStaffId}
                    onChange={(e) => setDualWitnessStaffId(e.target.value)}
                    placeholder="Staff ID of witnessing nurse"
                  />
                  <Field
                    label="Secondary Witness Signature / PIN"
                    required
                    value={dualWitnessSignature}
                    onChange={(e) => setDualWitnessSignature(e.target.value)}
                    placeholder="e.g. Sister Anjali Sharma RN"
                  />
                </div>
              </div>
            )}

            <Field
              label="Injection Site / Route Notes"
              value={injectionSite}
              onChange={(e) => setInjectionSite(e.target.value)}
              placeholder="e.g. Left forearm IV cannula / Deltoid IM"
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setAdministerModalEmar(null)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>Confirm & Administer</Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* 5. Medication Omission / Refusal Modal */}
      {omitModalEmar && (
        <Dialog title="Medication Omission / Refusal" onClose={() => setOmitModalEmar(null)}>
          <form onSubmit={handleOmitSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
            <div className="mp-field">
              <label htmlFor="omit-reason-select" style={{ fontWeight: 600 }}>Structured Omission Reason: *</label>
              <select
                id="omit-reason-select"
                className="mp-input"
                value={omissionReason}
                onChange={(e) => setOmissionReason(e.target.value)}
              >
                <option value="patient_refused">Patient Refused</option>
                <option value="fasting_for_procedure">Fasting for Procedure (NPO)</option>
                <option value="medication_unavailable">Medication Unavailable in Pharmacy</option>
                <option value="vital_contraindicated">Vital Sign Contraindicated</option>
                <option value="clinician_hold">Clinician Hold</option>
              </select>
            </div>

            <Field
              label="Clinical Observation / Note"
              value={omissionNote}
              onChange={(e) => setOmissionNote(e.target.value)}
              placeholder="e.g. Patient nauseous, refuses oral tablet"
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setOmitModalEmar(null)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>Log Omission</Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* 6. Nurse Shift Handover Modal */}
      {handoverModalOpen && (
        <Dialog title="Record Nurse Shift Handover" onClose={() => setHandoverModalOpen(false)}>
          <form onSubmit={handleShiftHandoverSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
            <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <Field
                label="Shift Date"
                type="date"
                required
                value={handoverForm.shiftDate}
                onChange={(e) => setHandoverForm({ ...handoverForm, shiftDate: e.target.value })}
              />
              <div className="mp-field">
                <label htmlFor="shift-type-select" style={{ fontWeight: 600 }}>Shift Type: *</label>
                <select
                  id="shift-type-select"
                  className="mp-input"
                  value={handoverForm.shiftType}
                  onChange={(e) => setHandoverForm({ ...handoverForm, shiftType: e.target.value })}
                >
                  <option value="morning">Morning Shift (07:00 - 15:00)</option>
                  <option value="evening">Evening Shift (15:00 - 23:00)</option>
                  <option value="night">Night Shift (23:00 - 07:00)</option>
                </select>
              </div>
            </div>

            <Field
              label="Incoming Nurse Staff ID"
              required
              value={handoverForm.incomingNurseStaffId}
              onChange={(e) => setHandoverForm({ ...handoverForm, incomingNurseStaffId: e.target.value })}
              placeholder="Staff ID of relieving nurse"
            />

            <Field
              label="Critical Patient Alerts & Escalations"
              value={handoverForm.criticalAlerts}
              onChange={(e) => setHandoverForm({ ...handoverForm, criticalAlerts: e.target.value })}
              placeholder="e.g. Bed 101 NEWS2 8, Outreach review active"
            />

            <Field
              label="General Ward Handover Notes"
              value={handoverForm.handoverNotes}
              onChange={(e) => setHandoverForm({ ...handoverForm, handoverNotes: e.target.value })}
              placeholder="Ward staffing status, narcotic count reconciliation, planned procedures"
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setHandoverModalOpen(false)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>Submit Handover</Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* 7. Bed Board Admit Modal */}
      {admitModalBed && (
        <Dialog title={`Admit Patient to Bed ${admitModalBed.bedNumber}`} onClose={() => setAdmitModalBed(null)}>
          <form onSubmit={handleAdmitSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
            <Field label="Patient User ID" required value={admitForm.patientId} onChange={(e) => setAdmitForm({ ...admitForm, patientId: e.target.value })} placeholder="Enter Patient Object ID" />
            <Field label="Admitting Diagnosis" required value={admitForm.admittingDiagnosis} onChange={(e) => setAdmitForm({ ...admitForm, admittingDiagnosis: e.target.value })} placeholder="e.g. Acute Appendicitis" />
            <Field label="Advance Deposit (Minor units/cents)" type="number" value={admitForm.advanceDepositMinor} onChange={(e) => setAdmitForm({ ...admitForm, advanceDepositMinor: e.target.value })} />
            <Field label="Estimated Length of Stay (Days)" type="number" min="1" value={admitForm.estimatedLengthOfStayDays} onChange={(e) => setAdmitForm({ ...admitForm, estimatedLengthOfStayDays: e.target.value })} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setAdmitModalBed(null)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>Confirm Admission</Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* 8. Bed Transfer Modal */}
      {transferModalBed && (
        <Dialog title={`Transfer Patient from Bed ${transferModalBed.bedNumber}`} onClose={() => setTransferModalBed(null)}>
          <form onSubmit={handleTransferSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
            <div className="mp-field">
              <label htmlFor="target-bed-select" style={{ fontWeight: 600 }}>Target Bed: *</label>
              <select
                id="target-bed-select"
                className="mp-input"
                required
                value={transferForm.targetBedId}
                onChange={(e) => setTransferForm({ ...transferForm, targetBedId: e.target.value })}
              >
                <option value="">-- Select Available Bed --</option>
                {beds.filter((b) => b.status === "available" && b._id !== transferModalBed._id).map((b) => (
                  <option key={b._id} value={b._id}>Bed {b.bedNumber}</option>
                ))}
              </select>
            </div>
            <Field label="Transfer Reason" required value={transferForm.transferReason} onChange={(e) => setTransferForm({ ...transferForm, transferReason: e.target.value })} placeholder="e.g. ICU step-down to General Ward" />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setTransferModalBed(null)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>Complete Transfer</Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* 9. Multi-Department Clearance Modal */}
      {clearanceModalBed && (
        <Dialog title={`Discharge Clearance Gate - Bed ${clearanceModalBed.bedNumber}`} onClose={() => setClearanceModalBed(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", padding: "1rem" }}>
            <p className="mp-muted">
              Inpatient discharge requires 3 independent departmental sign-offs: Medical (Doctor), Pharmacy (Pharmacist), and Finance (Billing/Admin).
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem", border: "1px solid var(--mp-border)", borderRadius: "6px" }}>
                <div>
                  <strong>1. Medical Clearance (Consultant Doctor)</strong>
                  <div className="mp-muted" style={{ fontSize: "0.8rem" }}>Certifies clinical stability for discharge</div>
                </div>
                {isDoctor && (
                  <Button variant="primary" size="small" onClick={() => handleClearance(clearanceModalBed.currentAdmissionId, "medical")} disabled={submitting}>
                    Grant Medical Clearance
                  </Button>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem", border: "1px solid var(--mp-border)", borderRadius: "6px" }}>
                <div>
                  <strong>2. Pharmacy Clearance (Hospital Pharmacist)</strong>
                  <div className="mp-muted" style={{ fontSize: "0.8rem" }}>Certifies all return medications and take-home medications reconciled</div>
                </div>
                {isPharmacist && (
                  <Button variant="primary" size="small" onClick={() => handleClearance(clearanceModalBed.currentAdmissionId, "pharmacy")} disabled={submitting}>
                    Grant Pharmacy Clearance
                  </Button>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem", border: "1px solid var(--mp-border)", borderRadius: "6px" }}>
                <div>
                  <strong>3. Finance / Billing Clearance (Receptionist/Admin)</strong>
                  <div className="mp-muted" style={{ fontSize: "0.8rem" }}>Certifies full settlement of interim & final bill folios</div>
                </div>
                {isReception && (
                  <Button variant="primary" size="small" onClick={() => handleClearance(clearanceModalBed.currentAdmissionId, "finance")} disabled={submitting}>
                    Grant Finance Clearance
                  </Button>
                )}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => setClearanceModalBed(null)}>Close</Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* 10. Discharge Finalization Modal */}
      {dischargeModalBed && (
        <Dialog title={`Finalize Discharge - Bed ${dischargeModalBed.bedNumber}`} onClose={() => setDischargeModalBed(null)}>
          <form onSubmit={handleDischargeSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
            <p className="mp-muted">
              All 3 clearances (medical, pharmacy, finance) must be recorded before discharge can be finalized.
            </p>
            <div className="mp-field">
              <label htmlFor="discharge-condition" style={{ fontWeight: 600 }}>Discharge Condition: *</label>
              <select
                id="discharge-condition"
                className="mp-input"
                value={dischargeForm.dischargeCondition}
                onChange={(e) => setDischargeForm({ ...dischargeForm, dischargeCondition: e.target.value })}
              >
                <option value="improved">Improved / Stable</option>
                <option value="cured">Cured</option>
                <option value="lama">Left Against Medical Advice (LAMA)</option>
                <option value="transferred_higher_center">Transferred to Higher Center</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <Field label="Clinical Summary" required value={dischargeForm.summaryText} onChange={(e) => setDischargeForm({ ...dischargeForm, summaryText: e.target.value })} placeholder="Hospital course and final diagnosis" />
            <Field label="Follow-Up Plan" value={dischargeForm.followUpPlan} onChange={(e) => setDischargeForm({ ...dischargeForm, followUpPlan: e.target.value })} placeholder="Review in OPD after 7 days" />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setDischargeModalBed(null)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>Finalize Discharge</Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* 11. Bed Status Change Modal */}
      {statusModalBed && (
        <Dialog title={`Update Bed ${statusModalBed.bedNumber} Status`} onClose={() => setStatusModalBed(null)}>
          <form onSubmit={handleStatusUpdateSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
            <div className="mp-field">
              <label htmlFor="bed-status-select" style={{ fontWeight: 600 }}>Target Status: *</label>
              <select
                id="bed-status-select"
                className="mp-input"
                value={statusUpdateForm.targetStatus}
                onChange={(e) => setStatusUpdateForm({ ...statusUpdateForm, targetStatus: e.target.value })}
              >
                <option value="available">Available (Clean & ready)</option>
                <option value="cleaning">Cleaning (Sanitization in progress)</option>
                <option value="maintenance">Maintenance (Repairs/Out of service)</option>
              </select>
            </div>
            <Field label="Reason / Notes" value={statusUpdateForm.reason} onChange={(e) => setStatusUpdateForm({ ...statusUpdateForm, reason: e.target.value })} placeholder="e.g. Terminal cleaning after discharge" />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setStatusModalBed(null)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>Save Status</Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* 12. Admission Timeline Audit Modal */}
      {timelineModalAdmissionId && (
        <Dialog title="Inpatient Care Timeline Audit" onClose={() => { setTimelineModalAdmissionId(null); setTimelineData(null); }}>
          <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            {timelineLoading ? (
              <LoadingState>Aggregating timeline events...</LoadingState>
            ) : timelineData ? (
              <>
                <div style={{ background: "var(--mp-surface-subtle, var(--mp-surface-subtle))", padding: "0.75rem", borderRadius: "6px" }}>
                  <div style={{ fontWeight: 700, fontSize: "1rem" }}>Admission #{timelineData.admission?.admissionNumber}</div>
                  <div className="mp-muted" style={{ fontSize: "0.85rem" }}>
                    Diagnosis: {timelineData.admission?.admittingDiagnosis} • Status: {timelineData.admission?.status?.toUpperCase()}
                  </div>
                </div>
                <div>
                  <h4 style={{ margin: "0 0 0.5rem 0" }}>Bed Transfer History</h4>
                  {timelineData.transfers?.length === 0 ? (
                    <div className="mp-muted" style={{ fontSize: "0.85rem" }}>No transfers recorded</div>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem" }}>
                      {timelineData.transfers?.map((t) => (
                        <li key={t._id} style={{ marginBottom: "0.25rem" }}>
                          Transferred to Bed {t.toBedId?.bedNumber} ({new Date(t.transferredAt).toLocaleString()}) - {t.transferReason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : null}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => { setTimelineModalAdmissionId(null); setTimelineData(null); }}>Close</Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* 13. New Ward Modal */}
      {newWardModal && (
        <Dialog title="Add New Ward" onClose={() => setNewWardModal(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitting(true);
              try {
                const res = await axios.post(`${BACKEND_URL}/api/inpatient/wards`, wardForm, { withCredentials: true });
                setFeedback(`Ward ${res.data.ward.name} created successfully`);
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
            <Field label="Ward Name" required value={wardForm.name} onChange={(e) => setWardForm({ ...wardForm, name: e.target.value })} placeholder="e.g. Cardiology Ward" />
            <Field label="Ward Code" required value={wardForm.code} onChange={(e) => setWardForm({ ...wardForm, code: e.target.value })} placeholder="e.g. WARD-CARD" />
            <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <Field label="Floor" value={wardForm.floor} onChange={(e) => setWardForm({ ...wardForm, floor: e.target.value })} />
              <Field label="Building" value={wardForm.building} onChange={(e) => setWardForm({ ...wardForm, building: e.target.value })} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setNewWardModal(false)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>Create Ward</Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* 14. New Room Modal */}
      {newRoomModal && (
        <Dialog title="Add Room to Ward" onClose={() => setNewRoomModal(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitting(true);
              try {
                const res = await axios.post(
                  `${BACKEND_URL}/api/inpatient/rooms`,
                  {
                    wardId: roomForm.wardId || selectedWardId,
                    roomNumber: roomForm.roomNumber,
                    roomType: roomForm.roomType,
                    dailyTariffMinor: Number(roomForm.dailyTariffMinor) || 100000,
                  },
                  { withCredentials: true }
                );
                setFeedback(`Room ${res.data.room.roomNumber} created`);
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
            <div className="mp-field">
              <label htmlFor="room-ward-select" style={{ fontWeight: 600 }}>Ward: *</label>
              <select
                id="room-ward-select"
                className="mp-input"
                value={roomForm.wardId || selectedWardId}
                onChange={(e) => setRoomForm({ ...roomForm, wardId: e.target.value })}
              >
                {wards.map((w) => (
                  <option key={w._id} value={w._id}>{w.name} ({w.code})</option>
                ))}
              </select>
            </div>
            <Field label="Room Number" required value={roomForm.roomNumber} onChange={(e) => setRoomForm({ ...roomForm, roomNumber: e.target.value })} placeholder="e.g. 201" />
            <div className="mp-field">
              <label htmlFor="room-type-select" style={{ fontWeight: 600 }}>Room Type:</label>
              <select
                id="room-type-select"
                className="mp-input"
                value={roomForm.roomType}
                onChange={(e) => setRoomForm({ ...roomForm, roomType: e.target.value })}
              >
                <option value="general">General</option>
                <option value="semi_private">Semi-Private</option>
                <option value="private">Private</option>
                <option value="deluxe">Deluxe</option>
                <option value="icu">ICU</option>
                <option value="hdu">HDU</option>
                <option value="isolation">Isolation</option>
              </select>
            </div>
            <Field label="Daily Tariff (Minor units / cents)" type="number" value={roomForm.dailyTariffMinor} onChange={(e) => setRoomForm({ ...roomForm, dailyTariffMinor: e.target.value })} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setNewRoomModal(false)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>Create Room</Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* 15. New Bed Modal */}
      {newBedModal && (
        <Dialog title="Add Bed" onClose={() => setNewBedModal(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitting(true);
              try {
                const targetRoom = rooms.find((r) => r._id === (bedForm.roomId || rooms[0]?._id));
                const res = await axios.post(
                  `${BACKEND_URL}/api/inpatient/beds`,
                  {
                    wardId: selectedWardId,
                    roomId: targetRoom?._id,
                    bedNumber: bedForm.bedNumber,
                  },
                  { withCredentials: true }
                );
                setFeedback(`Bed ${res.data.bed.bedNumber} added successfully`);
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
      )}
    </main>
  );
}
