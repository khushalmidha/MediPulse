import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import axios from "axios";
import {
  ClipboardList,
  ExternalLink,
  Globe2,
  LayoutDashboard,
  MessageSquare,
  Plus,
  RefreshCcw,
  Send,
  Shield,
  Stethoscope,
  TrendingUp,
  Users,
  ArrowRight,
  Droplets,
  Bed,
  MapPin,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { clearSessionState } from "../utils/sessionHttp";
import { useAuth } from "../context/AuthContext";
import { BACKEND_URL } from "../utils";
import { Banner, Button, Card, DataTable, Dialog, EmptyState, Field, LoadingState, StatusBadge } from "../components/ui";
import { hospitalPalette } from "../utils/visualSystem";
import "../components/hospital-admin/hospitalAdmin.css";

const roles = ["DOCTOR", "NURSE", "LAB_TECH", "RECEPTIONIST", "PHARMACIST", "DEPARTMENT_HEAD", "HOSPITAL_ADMIN"];

const formatCurrency = (value) => `INR ${Number(value || 0).toLocaleString("en-IN")}`;

const HospitalAdminDashboard = () => {
  const navigate = useNavigate();
  const { staffUser, staffHospital, isStaffAuth, loader, clearLocalSession } = useAuth();
  const hospitalId = staffUser?.hospitalId || staffHospital?._id;

  const [hospital, setHospital] = useState(staffHospital || null);
  const [analytics, setAnalytics] = useState(null);
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [locations, setLocations] = useState([]);
  const [forecasts, setForecasts] = useState({ beds: null, blood: null });
  const [forecastLoading, setForecastLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [openModal, setOpenModal] = useState(""); // "department", "location", "invite", "otp", "password"
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("info");
  const showError = (text) => { setMessage(text); setMessageTone("error"); };
  const showSuccess = (text) => { setMessage(text); setMessageTone("info"); };

  const [department, setDepartment] = useState({ name: "", code: "", description: "", consultationFee: "" });
  const [locationForm, setLocationForm] = useState({
    name: "",
    type: "room",
    building: "",
    floor: "",
    roomNumber: "",
    departmentId: "",
    serviceType: "consultation",
    instructions: "",
  });
  const [locationSubmitting, setLocationSubmitting] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [brandingForm, setBrandingForm] = useState({
    tagline: staffHospital?.branding?.tagline || "",
    about: staffHospital?.branding?.about || "",
    primaryColor: staffHospital?.branding?.primaryColor || "#115e59",
    logo: staffHospital?.branding?.logo || "",
    coverImage: staffHospital?.branding?.coverImage || "",
  });
  const [savingBranding, setSavingBranding] = useState(false);

  const [invite, setInvite] = useState({
    name: "",
    email: "",
    role: "DOCTOR",
    specialization: "",
    qualification: "",
    experience: "",
    consultationFee: "",
    bio: "",
  });
  const [inviting, setInviting] = useState(false);

  // Staff removal with OTP state
  const [otpMember, setOtpMember] = useState(null);
  const [otpValue, setOtpValue] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpError, setOtpError] = useState("");

  // Role filter on staff table
  const [staffRoleFilter, setStaffRoleFilter] = useState("ALL");

  // Account-switch disposal
  const currentIdentity = `${hospitalId || ""}:${staffUser?._id || ""}`;
  const prevIdentityRef = useRef(currentIdentity);
  useEffect(() => {
    if (prevIdentityRef.current !== currentIdentity) {
      prevIdentityRef.current = currentIdentity;
      setHospital(staffHospital || null);
      setAnalytics(null);
      setStaff([]);
      setDepartments([]);
      setDoctors([]);
      setLocations([]);
      setForecasts({ beds: null, blood: null });
      setMessage("");
      setOpenModal("");
    }
  }, [currentIdentity, staffHospital]);

  const loadForecasts = useCallback(async (targetId = hospitalId) => {
    if (!targetId) return;
    try {
      const [bedRes, bloodRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/forecast/beds/${targetId}`, { withCredentials: true }),
        axios.get(`${BACKEND_URL}/api/forecast/blood/${targetId}`, { withCredentials: true }),
      ]);
      setForecasts({ beds: bedRes.data, blood: bloodRes.data });
    } catch {
      // Forecasts are optional planning tools
    }
  }, [hospitalId]);

  const loadPortal = useCallback(async () => {
    if (!hospitalId || !isStaffAuth) return;
    try {
      const [analyticsRes, staffRes, profileRes, locationsRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/hospitals/${hospitalId}/analytics`, { withCredentials: true }),
        axios.get(`${BACKEND_URL}/api/hospitals/${hospitalId}/staff`, { withCredentials: true }),
        axios.get(`${BACKEND_URL}/api/hospitals/${hospitalId}/admin-profile`, { withCredentials: true }),
        axios.get(`${BACKEND_URL}/api/hospitals/${hospitalId}/locations?includeInactive=true`, { withCredentials: true }).catch(() => ({ data: { locations: [] } })),
      ]);

      const freshHospital = profileRes.data.hospital;
      let publicProfile = null;
      if (freshHospital?.slug && freshHospital.status === "active") {
        const publicRes = await axios.get(`${BACKEND_URL}/api/hospitals/${freshHospital.slug}`).catch(() => null);
        publicProfile = publicRes?.data || null;
      }

      setHospital(freshHospital);
      setAnalytics(analyticsRes.data);
      setStaff(staffRes.data.items || []);
      setDepartments(publicProfile?.departments || []);
      setDoctors(publicProfile?.doctors || []);
      setLocations(locationsRes.data?.locations || []);
      setBrandingForm({
        tagline: freshHospital.branding?.tagline || "",
        about: freshHospital.branding?.about || "",
        primaryColor: freshHospital.branding?.primaryColor || "#115e59",
        logo: freshHospital.branding?.logo || "",
        coverImage: freshHospital.branding?.coverImage || "",
      });

      loadForecasts(freshHospital._id);
    } catch (error) {
      showError(error.response?.data?.message || "Unable to load hospital admin portal");
    }
  }, [hospitalId, isStaffAuth, loadForecasts]);

  useEffect(() => {
    loadPortal();
    const interval = window.setInterval(loadPortal, 20000);
    return () => window.clearInterval(interval);
  }, [loadPortal]);

  const regenerateForecasts = async () => {
    if (!hospitalId) return;
    setForecastLoading(true);
    setMessage("");
    try {
      const [bedRes, bloodRes] = await Promise.all([
        axios.post(`${BACKEND_URL}/api/forecast/beds/${hospitalId}/generate`, {}, { withCredentials: true }),
        axios.post(`${BACKEND_URL}/api/forecast/blood/${hospitalId}/generate`, {}, { withCredentials: true }),
      ]);
      setForecasts({ beds: bedRes.data, blood: bloodRes.data });
      showSuccess("AI planning forecasts refreshed");
    } catch (error) {
      showError(error.response?.data?.message || "Could not refresh planning forecasts");
    } finally {
      setForecastLoading(false);
    }
  };

  const addDepartment = async (event) => {
    event.preventDefault();
    if (!department.name.trim() || !department.code.trim()) {
      showError("Department name and short code are required.");
      return;
    }
    setMessage("");
    try {
      await axios.post(
        `${BACKEND_URL}/api/hospitals/${hospitalId}/departments`,
        {
          name: department.name.trim(),
          code: department.code.trim().toUpperCase(),
          description: department.description.trim(),
          opd: { consultationFee: Number(department.consultationFee || 0), isActive: true },
        },
        { withCredentials: true },
      );
      setDepartment({ name: "", code: "", description: "", consultationFee: "" });
      setOpenModal("");
      showSuccess("Department added successfully.");
      await loadPortal();
    } catch (error) {
      const duplicate = error.response?.data?.message?.includes("duplicate") || error.response?.status === 409;
      showError(duplicate ? "Department code already exists for this hospital." : error.response?.data?.message || "Could not add department.");
    }
  };

  const addLocation = async (event) => {
    event.preventDefault();
    if (!locationForm.name.trim()) {
      showError("Location name is required.");
      return;
    }
    setLocationSubmitting(true);
    setMessage("");
    try {
      await axios.post(
        `${BACKEND_URL}/api/hospitals/${hospitalId}/locations`,
        {
          name: locationForm.name.trim(),
          type: locationForm.type,
          building: locationForm.building.trim(),
          floor: locationForm.floor.trim(),
          roomNumber: locationForm.roomNumber.trim(),
          departmentId: locationForm.departmentId || undefined,
          serviceType: locationForm.serviceType,
          instructions: locationForm.instructions.trim(),
        },
        { withCredentials: true },
      );
      setLocationForm({
        name: "",
        type: "room",
        building: "",
        floor: "",
        roomNumber: "",
        departmentId: "",
        serviceType: "consultation",
        instructions: "",
      });
      setOpenModal("");
      showSuccess("Hospital location registered successfully.");
      await loadPortal();
    } catch (error) {
      showError(error.response?.data?.message || "Could not register location.");
    } finally {
      setLocationSubmitting(false);
    }
  };

  const toggleLocationStatus = async (loc) => {
    setMessage("");
    try {
      const newStatus = loc.status === "active" ? "inactive" : "active";
      await axios.patch(
        `${BACKEND_URL}/api/hospitals/${hospitalId}/locations/${loc._id}`,
        { status: newStatus },
        { withCredentials: true },
      );
      showSuccess(`Location marked as ${newStatus}.`);
      await loadPortal();
    } catch (error) {
      showError(error.response?.data?.message || "Could not update location status.");
    }
  };

  const inviteStaffMember = async (event) => {
    event.preventDefault();
    if (!invite.name.trim() || !invite.email.trim()) {
      showError("Staff name and email address are required.");
      return;
    }
    setInviting(true);
    setMessage("");
    try {
      await axios.post(
        `${BACKEND_URL}/api/hospitals/${hospitalId}/staff/invite`,
        {
          ...invite,
          doctorProfile: invite.role === "DOCTOR" ? {
            specialization: invite.specialization,
            qualification: invite.qualification,
            experience: Number(invite.experience || 0),
            consultationFee: Number(invite.consultationFee || 0),
            bio: invite.bio,
          } : undefined,
        },
        { withCredentials: true },
      );
      setInvite({
        name: "",
        email: "",
        role: "DOCTOR",
        specialization: "",
        qualification: "",
        experience: "",
        consultationFee: "",
        bio: "",
      });
      setOpenModal("");
      showSuccess("Staff invitation sent successfully.");
      await loadPortal();
    } catch (error) {
      showError(error.response?.data?.message || "Could not invite staff member.");
    } finally {
      setInviting(false);
    }
  };

  const resendInvite = async (staffMemberId) => {
    setMessage("");
    try {
      await axios.post(`${BACKEND_URL}/api/hospitals/${hospitalId}/staff/${staffMemberId}/invite/resend`, {}, { withCredentials: true });
      showSuccess("Invitation resent.");
      await loadPortal();
    } catch (error) {
      showError(error.response?.data?.message || "Could not resend invitation.");
    }
  };

  const openRemovalModal = (member) => {
    setOtpMember(member);
    setOtpValue("");
    setOtpSent(false);
    setOtpError("");
    setOtpSending(false);
    setOpenModal("otp");
  };

  const sendRemovalOtp = async () => {
    if (!otpMember) return;
    setOtpSending(true);
    setOtpError("");
    try {
      await axios.post(`${BACKEND_URL}/api/hospitals/${hospitalId}/staff/${otpMember._id}/remove/request-otp`, {}, { withCredentials: true });
      setOtpSent(true);
    } catch (error) {
      setOtpError(error.response?.data?.message || "Could not dispatch verification OTP.");
    } finally {
      setOtpSending(false);
    }
  };

  const confirmRemovalWithOtp = async () => {
    if (!otpMember || !otpValue.trim()) {
      setOtpError("Enter the 6-digit confirmation OTP.");
      return;
    }
    setOtpSending(true);
    setOtpError("");
    try {
      await axios.delete(`${BACKEND_URL}/api/hospitals/${hospitalId}/staff/${otpMember._id}`, { data: { otp: otpValue.trim() }, withCredentials: true });
      setOpenModal("");
      setOtpMember(null);
      showSuccess("Staff member removed successfully.");
      await loadPortal();
    } catch (error) {
      setOtpError(error.response?.data?.message || "Invalid or expired OTP. Please try again.");
    } finally {
      setOtpSending(false);
    }
  };

  const grantAdminAccess = async (member) => {
    if (!window.confirm(`Grant HOSPITAL_ADMIN privileges to ${member.name}? They will have full administrative access.`)) return;
    try {
      await axios.post(
        `${BACKEND_URL}/api/hospitals/${hospitalId}/staff/invite`,
        { email: member.email, name: member.name, role: "HOSPITAL_ADMIN" },
        { withCredentials: true },
      );
      showSuccess(`Hospital admin access granted to ${member.name}.`);
      await loadPortal();
    } catch (error) {
      showError(error.response?.data?.message || "Could not grant admin access.");
    }
  };

  const saveBranding = async (event) => {
    event.preventDefault();
    setSavingBranding(true);
    setMessage("");
    try {
      const response = await axios.patch(
        `${BACKEND_URL}/api/hospitals/${hospitalId}/profile`,
        { branding: brandingForm },
        { withCredentials: true },
      );
      setHospital(response.data.hospital);
      showSuccess("Hospital branding and website appearance updated.");
      await loadPortal();
    } catch (error) {
      showError(error.response?.data?.message || "Could not update hospital branding.");
    } finally {
      setSavingBranding(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      showError("Current and new passwords are required.");
      return;
    }
    setPasswordLoading(true);
    setMessage("");
    try {
      await axios.patch(`${BACKEND_URL}/api/auth/staff/password`, passwordForm, { withCredentials: true });
      setPasswordForm({ currentPassword: "", newPassword: "" });
      setOpenModal("");
      clearSessionState();
      clearLocalSession();
      navigate("/hospital/login");
    } catch (error) {
      showError(error.response?.data?.message || "Could not change password.");
    } finally {
      setPasswordLoading(false);
    }
  };

  const filteredStaff = useMemo(() => {
    if (staffRoleFilter === "ALL") return staff;
    return staff.filter((member) => member.role === staffRoleFilter);
  }, [staff, staffRoleFilter]);

  const brandPalette = useMemo(() => hospitalPalette(brandingForm.primaryColor), [brandingForm.primaryColor]);

  if (loader) {
    return (
      <main className="mp-page">
        <LoadingState>Loading hospital administrator workspace...</LoadingState>
      </main>
    );
  }

  if (!hospitalId || !isStaffAuth) {
    return (
      <main className="mp-page">
        <Card>
          <EmptyState
            title="Hospital Admin workspace unavailable"
            action={
              <Button to="/hospital/login">
                Sign in as Hospital Admin <ArrowRight size={16} />
              </Button>
            }
          >
            Access requires an authorized hospital administrative account.
          </EmptyState>
        </Card>
      </main>
    );
  }

  const tabs = [
    ["overview", "Overview", LayoutDashboard],
    ["departments", "Departments", ClipboardList],
    ["locations", "Locations & Desks", MapPin],
    ["staff", "Staff & Invites", Users],
    ["website", "Website & Branding", Globe2],
    ["forecast", "Demand Forecasting", TrendingUp],
    ["security", "Security & Settings", Shield],
  ];

  return (
    <main className="mp-page mp-admin-page">
      {/* Header */}
      <div className="mp-admin-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <p className="mp-eyebrow" style={{ margin: 0 }}>Hospital Administration</p>
            <StatusBadge tone={hospital?.status === "active" ? "positive" : "warning"}>
              {hospital?.status === "active" ? "Operational" : "Verification Pending"}
            </StatusBadge>
          </div>
          <h1 style={{ fontSize: "2rem", margin: "6px 0 4px", fontWeight: 800 }}>{hospital?.name || "Hospital Workspace"}</h1>
          <p style={{ color: "var(--mp-muted)", margin: 0 }}>
            {hospital?.address?.city ? `${hospital.address.city}, ${hospital.address.state || ""}` : "Hospital Operating Headquarters"}
            {hospital?.slug && (
              <>
                {" · "}
                <a
                  href={`/hospitals/${hospital.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--mp-accent-ink)", fontWeight: 650, display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  View Public Website <ExternalLink size={13} />
                </a>
              </>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={loadPortal}>
            <RefreshCcw size={15} /> Refresh Data
          </Button>
          {hospital?.slug && (
            <Button to={`/hospitals/${hospital.slug}`} variant="secondary">
              <Globe2 size={15} /> Patient Portal
            </Button>
          )}
        </div>
      </div>

      {message && <Banner tone={messageTone}>{message}</Banner>}

      {/* Quick operational navigation */}
      <Card aria-label="Operational tools">
        <p className="mp-field-hint" style={{ fontWeight: 700, marginBottom: 12 }}>OPERATIONAL WORKSPACES</p>
        <div className="mp-admin-quick-links">
          <Link to="/hospital/nursing-station" className="mp-admin-quick-link">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ClipboardList size={18} /> Nursing & Reception Station
            </span>
            <ArrowRight size={16} />
          </Link>
          <Link to="/hospital/doctor-opd" className="mp-admin-quick-link">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Stethoscope size={18} /> Doctor OPD Console
            </span>
            <ArrowRight size={16} />
          </Link>
          <Link to="/hospital/staff-communication" className="mp-admin-quick-link">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <MessageSquare size={18} /> Internal Staff Communication
            </span>
            <ArrowRight size={16} />
          </Link>
        </div>
      </Card>

      {/* Navigation tabs */}
      <nav className="mp-admin-nav-tabs" aria-label="Dashboard sections">
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => {
              setActiveTab(key);
              setMessage("");
            }}
            className="mp-admin-tab-btn"
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="mp-stack">
          <div className="mp-admin-metrics-grid">
            <div className="mp-admin-metric-card">
              <span>Total OPD Bookings</span>
              <strong>{analytics?.totalBookings ?? "—"}</strong>
            </div>
            <div className="mp-admin-metric-card">
              <span>Completed Consultations</span>
              <strong>{analytics?.completedVisits ?? "—"}</strong>
            </div>
            <div className="mp-admin-metric-card">
              <span>Active Care Staff</span>
              <strong>{staff.length}</strong>
            </div>
            <div className="mp-admin-metric-card">
              <span>Active Departments</span>
              <strong>{departments.length}</strong>
            </div>
            <div className="mp-admin-metric-card">
              <span>Patient Satisfaction</span>
              <strong>{analytics?.avgRating ? `${Number(analytics.avgRating).toFixed(1)} / 5` : "5.0 / 5"}</strong>
            </div>
            <div className="mp-admin-metric-card">
              <span>Demo OPD Volume</span>
              <strong>{analytics?.revenue ? formatCurrency(analytics.revenue) : "Active"}</strong>
            </div>
          </div>

          <Card>
            <div className="mp-card-heading">
              <h2>Department Overview & Volume</h2>
              <Button size="small" onClick={() => setOpenModal("department")}>
                <Plus size={15} /> Add Department
              </Button>
            </div>
            {!departments.length ? (
              <EmptyState title="No departments configured yet." action={<Button size="small" onClick={() => setOpenModal("department")}>Add your first department</Button>}>
                Configure hospital departments to organize doctor sessions and patient OPD queues.
              </EmptyState>
            ) : (
              <DataTable
                caption="Hospital departments"
                rows={departments}
                columns={[
                  { key: "code", label: "Code", render: (d) => <strong>{d.code}</strong> },
                  { key: "name", label: "Department Name" },
                  {
                    key: "fee",
                    label: "Consultation Fee",
                    render: (d) => (d.opd?.consultationFee ? `${d.opd.consultationFee} demo credits` : "Standard"),
                  },
                  {
                    key: "doctors",
                    label: "Associated Doctors",
                    render: (d) => doctors.filter((doc) => doc.departmentIds?.some((id) => String(id) === String(d._id))).length,
                  },
                  {
                    key: "status",
                    label: "Status",
                    render: (d) => <StatusBadge tone={d.status === "active" ? "positive" : "neutral"}>{d.status || "active"}</StatusBadge>,
                  },
                ]}
              />
            )}
          </Card>
        </div>
      )}

      {/* Departments Tab */}
      {activeTab === "departments" && (
        <Card>
          <div className="mp-card-heading">
            <div>
              <h2>Department Catalog</h2>
              <p className="mp-field-hint" style={{ margin: 0 }}>Manage clinical departments, codes, and OPD fee structures.</p>
            </div>
            <Button onClick={() => setOpenModal("department")}>
              <Plus size={16} /> Add Department
            </Button>
          </div>
          {!departments.length ? (
            <EmptyState title="No departments created yet." action={<Button onClick={() => setOpenModal("department")}>Add Department</Button>}>
              Add clinical departments such as General Medicine, Cardiology, or Pediatrics.
            </EmptyState>
          ) : (
            <DataTable
              caption="Clinical departments"
              rows={departments}
              columns={[
                { key: "code", label: "Code", render: (d) => <code>{d.code}</code> },
                { key: "name", label: "Name", render: (d) => <strong>{d.name}</strong> },
                { key: "description", label: "Description", render: (d) => d.description || "—" },
                {
                  key: "opdFee",
                  label: "OPD Consultation Fee",
                  render: (d) => (d.opd?.consultationFee ? `${d.opd.consultationFee} demo credits` : "Standard"),
                },
                {
                  key: "status",
                  label: "Status",
                  render: (d) => <StatusBadge tone="positive">{d.status || "Active"}</StatusBadge>,
                },
              ]}
            />
          )}
        </Card>
      )}

      {/* Locations Tab */}
      {activeTab === "locations" && (
        <Card>
          <div className="mp-card-heading">
            <div>
              <h2>Hospital Locations & Service Desks</h2>
              <p className="mp-field-hint" style={{ margin: 0 }}>Register validated service locations, rooms, and desks for patient encounter navigation.</p>
            </div>
            <Button onClick={() => setOpenModal("location")}>
              <Plus size={16} /> Add Location
            </Button>
          </div>
          {!locations.length ? (
            <EmptyState title="No locations registered yet." action={<Button onClick={() => setOpenModal("location")}>Add Location</Button>}>
              Register destinations like Reception Desks, Triage Stations, Doctor Chambers, and Pharmacy Counters.
            </EmptyState>
          ) : (
            <DataTable
              caption="Hospital locations"
              rows={locations}
              columns={[
                { key: "name", label: "Location Name", render: (loc) => <strong>{loc.name}</strong> },
                { key: "type", label: "Type", render: (loc) => <StatusBadge tone="neutral">{loc.type || "room"}</StatusBadge> },
                {
                  key: "serviceType",
                  label: "Service Type",
                  render: (loc) => <StatusBadge tone="accent">{loc.serviceType || "consultation"}</StatusBadge>,
                },
                {
                  key: "department",
                  label: "Department",
                  render: (loc) => loc.departmentId?.name || "All Departments",
                },
                {
                  key: "placement",
                  label: "Building / Floor / Room",
                  render: (loc) => [loc.building, loc.floor ? `Floor ${loc.floor}` : null, loc.roomNumber ? `Room ${loc.roomNumber}` : null].filter(Boolean).join(" · ") || "—",
                },
                {
                  key: "status",
                  label: "Status",
                  render: (loc) => <StatusBadge tone={loc.status === "active" ? "positive" : "warning"}>{loc.status || "active"}</StatusBadge>,
                },
                {
                  key: "action",
                  label: "Action",
                  render: (loc) => (
                    <Button size="small" variant="secondary" onClick={() => toggleLocationStatus(loc)}>
                      {loc.status === "active" ? "Deactivate" : "Activate"}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}

      {/* Staff Tab */}
      {activeTab === "staff" && (
        <Card>
          <div className="mp-admin-header" style={{ marginBottom: 16 }}>
            <div>
              <h2>Hospital Staff Directory & Invites</h2>
              <p className="mp-field-hint" style={{ margin: 0 }}>Authorize doctors, nurses, receptionists, and administrative personnel.</p>
            </div>
            <Button onClick={() => setOpenModal("invite")}>
              <Plus size={16} /> Invite Staff Member
            </Button>
          </div>

          <div style={{ marginBottom: 16, display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {["ALL", ...roles].map((role) => (
              <Button
                key={role}
                size="small"
                variant={staffRoleFilter === role ? "primary" : "secondary"}
                onClick={() => setStaffRoleFilter(role)}
              >
                {role === "ALL" ? "All Roles" : role.replace("_", " ")}
              </Button>
            ))}
          </div>

          {!filteredStaff.length ? (
            <EmptyState title="No staff members found for this filter." action={<Button size="small" onClick={() => setOpenModal("invite")}>Send an invite</Button>} />
          ) : (
            <DataTable
              caption="Authorized hospital personnel"
              rows={filteredStaff}
              columns={[
                {
                  key: "name",
                  label: "Staff Name",
                  render: (m) => (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="mp-avatar" aria-hidden="true" style={{ width: 32, height: 32, fontSize: "0.75rem" }}>
                        {m.name?.slice(0, 2).toUpperCase() || "ST"}
                      </span>
                      <div>
                        <strong>{m.name}</strong>
                        <p className="mp-field-hint" style={{ margin: 0 }}>{m.email}</p>
                      </div>
                    </div>
                  ),
                },
                {
                  key: "role",
                  label: "Operational Role",
                  render: (m) => <StatusBadge tone="info">{m.role?.replace("_", " ")}</StatusBadge>,
                },
                {
                  key: "status",
                  label: "Invite Status",
                  render: (m) => (
                    <StatusBadge tone={m.inviteStatus === "accepted" ? "positive" : m.inviteStatus === "expired" ? "danger" : "warning"}>
                      {m.inviteStatus || "accepted"}
                    </StatusBadge>
                  ),
                },
                {
                  key: "actions",
                  label: "Actions",
                  render: (m) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {m.inviteStatus === "pending" && (
                        <Button size="small" variant="secondary" onClick={() => resendInvite(m._id)}>
                          Resend
                        </Button>
                      )}
                      {m.role !== "HOSPITAL_ADMIN" && (
                        <Button size="small" variant="secondary" onClick={() => grantAdminAccess(m)}>
                          Grant Admin
                        </Button>
                      )}
                      <Button size="small" variant="danger" onClick={() => openRemovalModal(m)}>
                        Remove
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}

      {/* Website & Branding Tab */}
      {activeTab === "website" && (
        <Card as="form" onSubmit={saveBranding} noValidate>
          <div className="mp-card-heading">
            <div>
              <h2>Hospital Website & Brand Customization</h2>
              <p className="mp-field-hint" style={{ margin: 0 }}>Customize public appearance, color palette, logo, and hospital story.</p>
            </div>
            <Button type="submit" disabled={savingBranding}>
              {savingBranding ? "Saving..." : "Save Branding"}
            </Button>
          </div>

          <div className="mp-form-grid">
            <Field
              label="Hospital Tagline"
              placeholder="e.g. Compassionate care with modern clinical precision"
              value={brandingForm.tagline}
              onChange={(e) => setBrandingForm({ ...brandingForm, tagline: e.target.value })}
              hint="Displayed in hero section on public hospital portal"
            />

            <Field
              as="textarea"
              label="About the Hospital"
              placeholder="Describe your hospital facilities, values, and clinical excellence..."
              value={brandingForm.about}
              onChange={(e) => setBrandingForm({ ...brandingForm, about: e.target.value })}
            />

            <div className="mp-form-row">
              <Field
                label="Primary Brand Color (Hex)"
                type="text"
                placeholder="#115e59"
                value={brandingForm.primaryColor}
                onChange={(e) => setBrandingForm({ ...brandingForm, primaryColor: e.target.value })}
                hint="Used for buttons, badges, and primary accents across patient portal"
              />
              <Field
                label="Hospital Logo URL"
                placeholder="https://example.com/logo.png"
                value={brandingForm.logo}
                onChange={(e) => setBrandingForm({ ...brandingForm, logo: e.target.value })}
              />
            </div>

            <Field
              label="Cover Hero Image URL"
              placeholder="https://example.com/hero-banner.jpg"
              value={brandingForm.coverImage}
              onChange={(e) => setBrandingForm({ ...brandingForm, coverImage: e.target.value })}
            />

            {/* Brand Color Preview */}
            <div className="mp-admin-color-preview">
              <div className="mp-admin-color-swatch" style={{ backgroundColor: brandPalette.accent }} />
              <div>
                <strong>Brand Palette Preview</strong>
                <p className="mp-field-hint" style={{ margin: "2px 0 0" }}>
                  Primary Accent: <code>{brandPalette.accent}</code> · Accessible Text: <code>{brandPalette.onAccent}</code>
                </p>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <Button type="submit" disabled={savingBranding}>
                {savingBranding ? "Saving..." : "Save Website Branding"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Demand Forecast Tab */}
      {activeTab === "forecast" && (
        <div className="mp-stack">
          <Card>
            <div className="mp-card-heading">
              <div>
                <h2>AI Clinical Demand Forecasts</h2>
                <p className="mp-field-hint" style={{ margin: 0 }}>
                  Predictive planning drafts for inpatient bed occupancy and blood bank reserves.
                </p>
              </div>
              <Button variant="secondary" onClick={regenerateForecasts} disabled={forecastLoading}>
                <RefreshCcw size={16} className={forecastLoading ? "mp-spin" : ""} />
                {forecastLoading ? "Generating draft..." : "Regenerate Forecast"}
              </Button>
            </div>
            <Banner tone="info">
              AI planning drafts are experimental operational forecasts. Unreviewed planning drafts are not validated clinical predictions or regulatory statements.
            </Banner>

            <div className="mp-admin-forecast-grid" style={{ marginTop: 20 }}>
              {/* Bed Demand Forecast */}
              <div className="mp-card" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <Bed size={22} style={{ color: "var(--mp-accent-ink)" }} />
                  <h3 style={{ margin: 0 }}>Inpatient Bed Demand</h3>
                </div>
                {forecasts.beds ? (
                  <dl className="mp-details">
                    <div>
                      <dt>Projected Admissions</dt>
                      <dd>{forecasts.beds.projectedAdmissions ?? "Calculating"}</dd>
                    </div>
                    <div>
                      <dt>Occupancy Rate</dt>
                      <dd>{forecasts.beds.projectedOccupancy ? `${Math.round(forecasts.beds.projectedOccupancy * 100)}%` : "Normal"}</dd>
                    </div>
                    <div>
                      <dt>Confidence Rating</dt>
                      <dd><StatusBadge tone="neutral">{forecasts.beds.confidence || "Draft"}</StatusBadge></dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mp-field-hint">No bed forecast draft available. Click regenerate to create a draft.</p>
                )}
              </div>

              {/* Blood Bank Demand Forecast */}
              <div className="mp-card" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <Droplets size={22} style={{ color: "var(--mp-accent-ink)" }} />
                  <h3 style={{ margin: 0 }}>Blood Bank Reserves</h3>
                </div>
                {forecasts.blood ? (
                  <dl className="mp-details">
                    <div>
                      <dt>Projected Demand</dt>
                      <dd>{forecasts.blood.projectedUnits ?? "Normal"} units</dd>
                    </div>
                    <div>
                      <dt>Critical Group Alert</dt>
                      <dd>{forecasts.blood.criticalGroups?.join(", ") || "Adequate reserves"}</dd>
                    </div>
                    <div>
                      <dt>Confidence Rating</dt>
                      <dd><StatusBadge tone="neutral">{forecasts.blood.confidence || "Draft"}</StatusBadge></dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mp-field-hint">No blood bank forecast draft available. Click regenerate to create a draft.</p>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Security & Settings Tab */}
      {activeTab === "security" && (
        <Card as="form" onSubmit={changePassword} noValidate>
          <div className="mp-card-heading">
            <div>
              <h2>Administrator Password & Security</h2>
              <p className="mp-field-hint" style={{ margin: 0 }}>Update your staff credentials and manage administrative access.</p>
            </div>
          </div>

          <div className="mp-form-grid" style={{ maxWidth: 480 }}>
            <Field
              label="Current Password"
              type="password"
              required
              value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
            />
            <Field
              label="New Password"
              type="password"
              required
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              hint="Requires at least 8 characters with numbers and symbols"
            />
            <div style={{ marginTop: 12 }}>
              <Button type="submit" disabled={passwordLoading}>
                {passwordLoading ? "Updating..." : "Update Password"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Add Department Dialog */}
      <Dialog open={openModal === "department"} onClose={() => setOpenModal("")} title="Add Clinical Department">
        <form onSubmit={addDepartment} noValidate>
          <div className="mp-form-grid">
            <Field
              label="Department Name"
              required
              placeholder="e.g. Cardiology"
              value={department.name}
              onChange={(e) => setDepartment({ ...department, name: e.target.value })}
            />
            <Field
              label="Short Code"
              required
              placeholder="e.g. CARD"
              value={department.code}
              onChange={(e) => setDepartment({ ...department, code: e.target.value })}
            />
            <Field
              label="Consultation Fee (demo credits)"
              type="number"
              placeholder="e.g. 500"
              value={department.consultationFee}
              onChange={(e) => setDepartment({ ...department, consultationFee: e.target.value })}
            />
            <Field
              as="textarea"
              label="Description"
              placeholder="Brief description of specialized clinical services provided..."
              value={department.description}
              onChange={(e) => setDepartment({ ...department, description: e.target.value })}
            />
          </div>
          <div className="mp-actions">
            <Button variant="secondary" onClick={() => setOpenModal("")}>Cancel</Button>
            <Button type="submit">Create Department</Button>
          </div>
        </form>
      </Dialog>

      {/* Add Location Dialog */}
      <Dialog open={openModal === "location"} onClose={() => setOpenModal("")} title="Register Hospital Location / Destination">
        <form onSubmit={addLocation} noValidate>
          <div className="mp-form-grid">
            <Field
              label="Location Name"
              required
              placeholder="e.g. Reception Desk A, Chamber 102, Triage Room 1"
              value={locationForm.name}
              onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
            />
            <Field as="select" label="Location Type" value={locationForm.type} onChange={(e) => setLocationForm({ ...locationForm, type: e.target.value })}>
              {["room", "desk", "station", "floor", "building"].map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
            </Field>
            <Field as="select" label="Service Type" value={locationForm.serviceType} onChange={(e) => setLocationForm({ ...locationForm, serviceType: e.target.value })}>
              {["reception", "registration", "vitals", "consultation", "lab", "pharmacy", "billing", "other"].map((s) => (
                <option key={s} value={s}>{s.replace("_", " ").toUpperCase()}</option>
              ))}
            </Field>
            <Field as="select" label="Department (Optional)" value={locationForm.departmentId} onChange={(e) => setLocationForm({ ...locationForm, departmentId: e.target.value })}>
              <option value="">All Departments (General)</option>
              {departments.map((d) => <option key={d._id} value={d._id}>{d.name} ({d.code})</option>)}
            </Field>
            <Field
              label="Building"
              placeholder="e.g. Block A, Main Wing"
              value={locationForm.building}
              onChange={(e) => setLocationForm({ ...locationForm, building: e.target.value })}
            />
            <Field
              label="Floor"
              placeholder="e.g. 1st Floor, Ground"
              value={locationForm.floor}
              onChange={(e) => setLocationForm({ ...locationForm, floor: e.target.value })}
            />
            <Field
              label="Room Number"
              placeholder="e.g. 102"
              value={locationForm.roomNumber}
              onChange={(e) => setLocationForm({ ...locationForm, roomNumber: e.target.value })}
            />
            <Field
              as="textarea"
              label="Patient Navigation Instructions"
              placeholder="e.g. Take the west elevators to the 1st floor, turn right past the waiting area."
              value={locationForm.instructions}
              onChange={(e) => setLocationForm({ ...locationForm, instructions: e.target.value })}
            />
          </div>
          <div className="mp-actions">
            <Button variant="secondary" onClick={() => setOpenModal("")}>Cancel</Button>
            <Button type="submit" disabled={locationSubmitting}>{locationSubmitting ? "Registering..." : "Register Location"}</Button>
          </div>
        </form>
      </Dialog>

      {/* Invite Staff Dialog */}
      <Dialog open={openModal === "invite"} onClose={() => setOpenModal("")} title="Invite Staff Member">
        <form onSubmit={inviteStaffMember} noValidate>
          <div className="mp-form-grid">
            <Field as="select" label="Operational Role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              {roles.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
            </Field>
            <Field
              label="Full Name"
              required
              placeholder="e.g. Dr. Jane Smith"
              value={invite.name}
              onChange={(e) => setInvite({ ...invite, name: e.target.value })}
            />
            <Field
              label="Email Address"
              type="email"
              required
              placeholder="staff@hospital.com"
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
            />

            {invite.role === "DOCTOR" && (
              <>
                <div className="mp-form-row">
                  <Field
                    label="Specialization"
                    placeholder="e.g. Interventional Cardiologist"
                    value={invite.specialization}
                    onChange={(e) => setInvite({ ...invite, specialization: e.target.value })}
                  />
                  <Field
                    label="Qualification"
                    placeholder="e.g. MBBS, MD, DM"
                    value={invite.qualification}
                    onChange={(e) => setInvite({ ...invite, qualification: e.target.value })}
                  />
                </div>
                <div className="mp-form-row">
                  <Field
                    label="Years of Experience"
                    type="number"
                    value={invite.experience}
                    onChange={(e) => setInvite({ ...invite, experience: e.target.value })}
                  />
                  <Field
                    label="Consultation Fee"
                    type="number"
                    value={invite.consultationFee}
                    onChange={(e) => setInvite({ ...invite, consultationFee: e.target.value })}
                  />
                </div>
                <Field
                  as="textarea"
                  label="Doctor Bio"
                  placeholder="Professional background and clinical expertise..."
                  value={invite.bio}
                  onChange={(e) => setInvite({ ...invite, bio: e.target.value })}
                />
              </>
            )}
          </div>
          <div className="mp-actions">
            <Button variant="secondary" onClick={() => setOpenModal("")}>Cancel</Button>
            <Button type="submit" disabled={inviting}>
              <Send size={15} /> {inviting ? "Sending invite..." : "Send Invitation"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Staff Removal OTP Dialog */}
      <Dialog open={openModal === "otp"} onClose={() => setOpenModal("")} title={`Remove Staff: ${otpMember?.name || ""}`}>
        <div className="mp-stack">
          <p>
            Removing <strong>{otpMember?.name}</strong> ({otpMember?.role?.replace("_", " ")}) requires administrator two-step verification.
          </p>
          {otpError && <Banner tone="error">{otpError}</Banner>}

          {!otpSent ? (
            <div style={{ display: "grid", gap: 14 }}>
              <p className="mp-field-hint">
                Click below to request an authorization OTP sent to the hospital administrator email on file.
              </p>
              <Button onClick={sendRemovalOtp} disabled={otpSending}>
                {otpSending ? "Sending OTP..." : "Send Verification OTP"}
              </Button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <Field
                label="Enter Verification OTP"
                placeholder="6-digit OTP"
                value={otpValue}
                onChange={(e) => setOtpValue(e.target.value.trim())}
                hint="Check administrator inbox for the single-use OTP"
              />
              <div className="mp-actions">
                <Button variant="secondary" onClick={() => setOpenModal("")} disabled={otpSending}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmRemovalWithOtp} disabled={otpSending || !otpValue.trim()}>
                  {otpSending ? "Verifying..." : "Confirm Removal"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </main>
  );
};

export default HospitalAdminDashboard;
