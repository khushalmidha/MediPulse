import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Building2,
  ClipboardList,
  Droplets,
  ExternalLink,
  Globe2,
  LayoutDashboard,
  Lock,
  MessageSquare,
  Palette,
  Plus,
  Send,
  Stethoscope,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { BACKEND_URL } from "../utils";

const defaultSlides = [
  "https://images.unsplash.com/photo-1586773860418-d37222d8fce3?w=1200&q=80",
  "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=1200&q=80",
  "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1200&q=80",
];

const roles = ["DOCTOR", "NURSE", "LAB_TECH", "RECEPTIONIST", "PHARMACIST", "DEPARTMENT_HEAD", "HOSPITAL_ADMIN"];

const currency = (value) => `INR ${Number(value || 0).toLocaleString("en-IN")}`;

const statusBadge = (status) => {
  if (status === "accepted") return "bg-green-50 text-green-700 border-green-200";
  if (status === "expired") return "bg-red-50 text-red-700 border-red-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
};

const HospitalAdminDashboard = () => {
  const saved = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem("medipulse.hospitalAdmin") || "null");
    } catch {
      return null;
    }
  }, []);

  const [hospital, setHospital] = useState(saved?.hospital || null);
  const [analytics, setAnalytics] = useState(null);
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [forecasts, setForecasts] = useState({ beds: null, blood: null });
  const [forecastLoading, setForecastLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [openPanel, setOpenPanel] = useState("");
  const [slide, setSlide] = useState(0);
  const [message, setMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [department, setDepartment] = useState({ name: "", code: "", description: "", consultationFee: "" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });
  const [brandingForm, setBrandingForm] = useState({
    tagline: saved?.hospital?.branding?.tagline || "",
    about: saved?.hospital?.branding?.about || "",
    primaryColor: saved?.hospital?.branding?.primaryColor || "#2563eb",
    logo: saved?.hospital?.branding?.logo || "",
    coverImage: saved?.hospital?.branding?.coverImage || "",
  });
  const [invite, setInvite] = useState({
    name: "",
    email: "",
    role: "DOCTOR",
    profilePhoto: "",
    specialization: "",
    qualification: "",
    experience: "",
    consultationFee: "",
    bio: "",
  });
  // OTP removal modal state
  const [otpModal, setOtpModal] = useState(null); // { member } or null
  const [otpValue, setOtpValue] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpError, setOtpError] = useState("");

  const hospitalId = hospital?._id;
  const websiteUrl = hospital?.slug ? `/hospitals/${hospital.slug}` : "";
  const slides = hospital?.branding?.galleryImages?.length ? hospital.branding.galleryImages : defaultSlides;

  const loadPortal = async () => {
    if (!hospitalId) return;
    const [analyticsRes, staffRes, profileRes] = await Promise.all([
      axios.get(`${BACKEND_URL}/api/hospitals/${hospitalId}/analytics`, { withCredentials: true }),
      axios.get(`${BACKEND_URL}/api/hospitals/${hospitalId}/staff`, { withCredentials: true }),
      axios.get(`${BACKEND_URL}/api/hospitals/${hospitalId}/admin-profile`, { withCredentials: true }),
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
    setBrandingForm({
      tagline: freshHospital.branding?.tagline || "",
      about: freshHospital.branding?.about || "",
      primaryColor: freshHospital.branding?.primaryColor || "#2563eb",
      logo: freshHospital.branding?.logo || "",
      coverImage: freshHospital.branding?.coverImage || "",
    });
    sessionStorage.setItem("medipulse.hospitalAdmin", JSON.stringify({ ...saved, hospital: freshHospital }));
    loadForecasts(freshHospital._id).catch(() => {});
  };

  const loadForecasts = async (targetHospitalId = hospitalId) => {
    if (!targetHospitalId) return;
    const [bedRes, bloodRes] = await Promise.all([
      axios.get(`${BACKEND_URL}/api/forecast/beds/${targetHospitalId}`, { withCredentials: true }),
      axios.get(`${BACKEND_URL}/api/forecast/blood/${targetHospitalId}`, { withCredentials: true }),
    ]);
    setForecasts({ beds: bedRes.data, blood: bloodRes.data });
  };

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
      setMessage("AI planning forecast refreshed");
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not refresh forecasts");
    } finally {
      setForecastLoading(false);
    }
  };

  useEffect(() => {
    loadPortal().catch((error) => setMessage(error.response?.data?.message || "Unable to load hospital portal"));
    const interval = window.setInterval(() => {
      loadPortal().catch(() => {});
    }, 15000);
    return () => window.clearInterval(interval);
  }, [hospitalId]);

  useEffect(() => {
    if (!slides.length) return undefined;
    const timer = window.setInterval(() => setSlide((current) => (current + 1) % slides.length), 4000);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  const departmentStats = useMemo(() => {
    const map = new Map();
    (analytics?.departmentBreakdown || []).forEach((item) => map.set(String(item._id), item));
    return map;
  }, [analytics]);

  const staffByRole = useMemo(
    () =>
      roles.reduce((grouped, role) => {
        grouped[role] = staff.filter((member) => member.role === role);
        return grouped;
      }, {}),
    [staff],
  );

  const addDepartment = async (event) => {
    event.preventDefault();
    setMessage("");
    try {
      await axios.post(
        `${BACKEND_URL}/api/hospitals/${hospitalId}/departments`,
        {
          name: department.name,
          code: department.code,
          description: department.description,
          opd: { consultationFee: Number(department.consultationFee || 0), isActive: true },
        },
        { withCredentials: true },
      );
      setDepartment({ name: "", code: "", description: "", consultationFee: "" });
      setOpenPanel("");
      setMessage("Department added successfully");
      await loadPortal();
    } catch (error) {
      const duplicate = error.response?.data?.message?.includes("duplicate") || error.response?.status === 409;
      setMessage(duplicate ? "Department already exists for this hospital" : error.response?.data?.message || "Could not add department");
    }
  };

  const inviteStaff = async (event) => {
    event.preventDefault();
    setMessage("");
    try {
      await axios.post(
        `${BACKEND_URL}/api/hospitals/${hospitalId}/staff/invite`,
        {
          ...invite,
          doctorProfile: {
            specialization: invite.specialization,
            qualification: invite.qualification,
            experience: Number(invite.experience || 0),
            consultationFee: Number(invite.consultationFee || 0),
            bio: invite.bio,
          },
        },
        { withCredentials: true },
      );
      setInvite({ name: "", email: "", role: "DOCTOR", profilePhoto: "", specialization: "", qualification: "", experience: "", consultationFee: "", bio: "" });
      setOpenPanel("");
      setMessage("Staff invite sent");
      await loadPortal();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not invite staff");
    }
  };

  const resendInvite = async (staffId) => {
    setMessage("");
    try {
      await axios.post(`${BACKEND_URL}/api/hospitals/${hospitalId}/staff/${staffId}/invite/resend`, {}, { withCredentials: true });
      setMessage("Invite resent");
      await loadPortal();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not resend invite");
    }
  };

  const removeStaff = (member) => {
    setOtpModal({ member });
    setOtpValue("");
    setOtpSent(false);
    setOtpError("");
    setOtpSending(false);
  };

  const sendRemovalOtp = async () => {
    if (!otpModal) return;
    setOtpSending(true);
    setOtpError("");
    try {
      await axios.post(`${BACKEND_URL}/api/hospitals/${hospitalId}/staff/${otpModal.member._id}/remove/request-otp`, {}, { withCredentials: true });
      setOtpSent(true);
    } catch (error) {
      setOtpError(error.response?.data?.message || "Could not send OTP");
    } finally {
      setOtpSending(false);
    }
  };

  const confirmRemovalWithOtp = async () => {
    if (!otpModal || !otpValue) return;
    setOtpSending(true);
    setOtpError("");
    try {
      await axios.delete(`${BACKEND_URL}/api/hospitals/${hospitalId}/staff/${otpModal.member._id}`, { data: { otp: otpValue }, withCredentials: true });
      setOtpModal(null);
      setMessage("Staff member removed successfully");
      await loadPortal();
    } catch (error) {
      setOtpError(error.response?.data?.message || "Invalid OTP. Please try again.");
    } finally {
      setOtpSending(false);
    }
  };

  const grantAdminAccess = async (member) => {
    setMessage("");
    if (!window.confirm(`Grant HOSPITAL_ADMIN access to ${member.name}? They will have full admin privileges.`)) return;
    try {
      await axios.post(
        `${BACKEND_URL}/api/hospitals/${hospitalId}/staff/invite`,
        { email: member.email, name: member.name, role: "HOSPITAL_ADMIN" },
        { withCredentials: true }
      );
      setMessage(`Admin access invite sent to ${member.name}`);
      await loadPortal();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not grant admin access");
    }
  };

  const saveBranding = async (event) => {
    event.preventDefault();
    setMessage("");
    try {
      const response = await axios.patch(
        `${BACKEND_URL}/api/hospitals/${hospitalId}/profile`,
        { branding: brandingForm },
        { withCredentials: true },
      );
      setHospital(response.data.hospital);
      setMessage("Hospital website branding updated");
      await loadPortal();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not update branding");
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setPasswordMessage("");
    try {
      const response = await axios.patch(`${BACKEND_URL}/api/auth/staff/password`, passwordForm, { withCredentials: true });
      setPasswordMessage(response.data.message || "Password changed successfully");
      setPasswordForm({ currentPassword: "", newPassword: "" });
    } catch (error) {
      setPasswordMessage(error.response?.data?.message || "Could not change password");
    }
  };

  if (!hospitalId) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-slate-900 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl bg-white dark:bg-slate-950 p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Hospital portal not found</h1>
          <p className="mt-2 text-gray-600">Create a hospital admin account first.</p>
        </div>
      </main>
    );
  }

  const tabs = [
    ["overview", "Dashboard", LayoutDashboard],
    ["departments", "Departments", ClipboardList],
    ["staff", "Staff", Users],
    ["forecast", "Forecast", TrendingUp],
    ["website", "Website", Globe2],
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row">
        <aside className="lg:sticky lg:top-24 lg:h-fit lg:w-64">
          <div className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-950 p-3 shadow-sm">
            <div className="p-3">
              <p className="text-xs font-semibold uppercase text-blue-600 dark:text-red-500">Hospital Admin</p>
              <h1 className="mt-1 text-xl font-black text-slate-950">{hospital.name}</h1>
              <p className="mt-1 text-sm text-slate-500">{hospital.address?.city || "City"}, {hospital.address?.state || "State"}</p>
            </div>
            <div className="mt-2 grid gap-1">
              {tabs.map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${activeTab === key ? "bg-blue-600 dark:bg-red-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4">
              {[
                ["/hospital/nursing-station", "Nursing Station", ClipboardList],
                ["/hospital/doctor-opd", "OPD Console", Stethoscope],
                ["/hospital/staff-communication", "Staff Chat", MessageSquare],
              ].map(([to, label, Icon]) => (
                <Link key={to} to={to} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">
                  <Icon size={16} />
                  {label}
                  <ExternalLink className="ml-auto" size={14} />
                </Link>
              ))}
            </div>
          </div>
        </aside>

        <section className="min-w-0 flex-1 space-y-6">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white dark:bg-slate-950 shadow-sm">
            <div className="relative h-64">
              {slides.map((src, index) => (
                <img
                  key={src}
                  src={src}
                  alt={`${hospital.name} slide ${index + 1}`}
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${slide === index ? "opacity-100" : "opacity-0"}`}
                />
              ))}
              <div className="absolute inset-0 bg-gradient-to-r from-slate-950/80 via-slate-950/35 to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-end p-6 text-white">
                <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${hospital.status === "active" ? "bg-green-500" : "bg-amber-500"}`}>
                  {hospital.status === "active" ? "Workspace approved" : "Verification pending"}
                </span>
                <h2 className="mt-3 text-3xl font-black md:text-4xl">{hospital.name}</h2>
                <p className="mt-2 max-w-2xl text-white/80">{hospital.branding?.tagline || "Smart hospital workspace for OPD, staff, doctors, and public patient access."}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={loadPortal} className="rounded-lg bg-white dark:bg-slate-950 px-4 py-2 text-sm font-bold text-slate-950">Refresh portal</button>
                  {websiteUrl && <Link to={websiteUrl} className="rounded-lg bg-blue-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white">Open hospital website</Link>}
                </div>
              </div>
            </div>
          </div>

          {message && <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm font-medium text-blue-700">{message}</p>}

          {activeTab === "overview" && (
            <>
              <section className="grid gap-4 md:grid-cols-4">
                {[
                  ["Tokens Today", analytics?.today?.tokensIssued || 0, ClipboardList],
                  ["Completed", analytics?.today?.completed || 0, Stethoscope],
                  ["No Shows", analytics?.today?.noShows || 0, Users],
                  ["Revenue", currency(analytics?.today?.revenue), Building2],
                ].map(([label, value, Icon]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-950 p-5 shadow-sm">
                    <Icon className="text-blue-600 dark:text-red-500" size={22} />
                    <p className="mt-3 text-sm text-slate-500">{label}</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
                  </div>
                ))}
              </section>

              <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-950 p-6 shadow-sm">
                  <h2 className="text-lg font-black text-slate-950">Today's Top Doctors</h2>
                  <div className="mt-4 divide-y divide-slate-100">
                    {(analytics?.topDoctors || []).map((doctor) => (
                      <div key={doctor.name} className="grid grid-cols-[1fr_auto_auto] gap-3 py-3 text-sm">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{doctor.name}</span>
                        <span className="text-slate-500">{doctor.patientsToday} patients</span>
                        <span className="font-semibold text-amber-600">{Number(doctor.rating || 0).toFixed(1)}</span>
                      </div>
                    ))}
                    {!analytics?.topDoctors?.length && <p className="py-6 text-sm text-slate-500">Doctor performance appears after OPD tokens are completed.</p>}
                  </div>
                </div>
                <Link to={websiteUrl || "#"} className="rounded-2xl border border-blue-100 bg-blue-600 dark:bg-red-700 p-6 text-white shadow-sm">
                  <Globe2 size={30} />
                  <h2 className="mt-4 text-2xl font-black">Public Hospital Website</h2>
                  <p className="mt-2 text-sm text-blue-50">Patients can browse departments, doctors, reviews, and OPD status from here.</p>
                  <span className="mt-6 inline-flex rounded-lg bg-white dark:bg-slate-950 px-4 py-2 text-sm font-bold text-blue-700">Open website</span>
                </Link>
              </section>
            </>
          )}

          {activeTab === "departments" && (
            <section className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-950 p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-slate-950">Departments</h2>
                  <p className="mt-1 text-sm text-slate-500">Manage public OPD departments and patient fees.</p>
                </div>
                <button onClick={() => setOpenPanel("department")} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white">
                  <Plus size={16} />
                  Add Department
                </button>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {departments.map((item) => {
                  const stats = departmentStats.get(String(item._id));
                  return (
                    <div key={item._id} className="rounded-2xl border border-slate-200 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-black text-slate-950">{item.name}</h3>
                          <p className="mt-2 text-sm text-slate-500">{item.description || "OPD consultation available."}</p>
                        </div>
                        <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700">{item.status || "active"}</span>
                      </div>
                      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-slate-500">OPD Fee</p>
                          <p className="mt-1 font-black text-slate-950">{currency(item.opd?.consultationFee)}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-slate-500">Tokens Today</p>
                          <p className="mt-1 font-black text-slate-950">{stats?.patients || 0}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!departments.length && (
                  <div className="col-span-full rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
                    No departments yet. Add your first department to start accepting OPD patients.
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === "staff" && (
            <section className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-950 p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-slate-950">Staff</h2>
                  <p className="mt-1 text-sm text-slate-500">Invite doctors, nurses, reception, lab, and department teams.</p>
                </div>
                <button onClick={() => setOpenPanel("staff")} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white">
                  <Plus size={16} />
                  Invite Staff
                </button>
              </div>
              <div className="mt-6 space-y-6">
                {!!staff.filter((member) => member.inviteStatus === "pending").length && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <h3 className="font-black text-amber-950">Pending invites</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {staff.filter((member) => member.inviteStatus === "pending").map((member) => (
                        <div key={member._id} className="flex items-center justify-between gap-3 rounded-xl bg-white dark:bg-slate-950 p-3">
                          <div className="min-w-0">
                            <p className="truncate font-bold text-slate-950">{member.email}</p>
                            <p className="text-xs text-slate-500">{member.role.replace(/_/g, " ")}</p>
                          </div>
                          <button onClick={() => resendInvite(member._id)} className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-bold text-amber-700">Resend</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {roles.map((roleName) => (
                  <div key={roleName}>
                    <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">{roleName.replace(/_/g, " ")}</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {(staffByRole[roleName] || []).map((member) => (
                        <div key={member._id} className="rounded-2xl border border-slate-200 p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-black text-blue-700">
                              {member.profilePhoto ? <img src={member.profilePhoto} alt={member.name} className="h-full w-full object-cover" /> : member.name?.slice(0, 2)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-black text-slate-950">{member.name}</p>
                                <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusBadge(member.inviteStatus)}`}>{member.inviteStatus}</span>
                              </div>
                              <p className="truncate text-sm text-slate-500">{member.email}</p>
                              {member.role === "DOCTOR" && (
                                <p className="mt-1 text-sm text-slate-600">{member.doctorProfile?.specialization || "General Medicine"}</p>
                              )}
                              {member.doctorId && (
                                <Link to={`/doctorsProfile/${member.doctorId}`} className="mt-2 inline-block text-xs font-bold text-blue-600 dark:text-red-500">
                                  View on platform
                                </Link>
                              )}
                              {member.inviteStatus === "accepted" && member._id !== (saved?.staff?._id || saved?.staff?.id) && (
                                <div className="mt-2 flex gap-3">
                                  <button onClick={() => removeStaff(member)} className="text-xs font-bold text-red-600 hover:underline">
                                    Remove (OTP)
                                  </button>
                                  {member.role !== "HOSPITAL_ADMIN" && (
                                    <button onClick={() => grantAdminAccess(member)} className="text-xs font-bold text-blue-600 dark:text-red-500 hover:underline">
                                      Grant Admin
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {!staffByRole[roleName]?.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No {roleName.replace(/_/g, " ").toLowerCase()} added yet.</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === "forecast" && (
            <section className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white dark:bg-slate-950 p-6 shadow-sm">
                <div>
                  <h2 className="text-xl font-black text-slate-950">AI Capacity Forecast</h2>
                  <p className="mt-1 text-sm text-slate-500">Monthly bed and blood demand estimates based on OPD history, emergency signals, and department type.</p>
                </div>
                <button onClick={regenerateForecasts} disabled={forecastLoading} className="rounded-lg bg-blue-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-400">
                  {forecastLoading ? "Refreshing..." : "Refresh forecast"}
                </button>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-950 p-6 shadow-sm">
                  <h3 className="flex items-center gap-2 text-lg font-black text-slate-950"><TrendingUp size={20} className="text-blue-600 dark:text-red-500" /> Bed Demand</h3>
                  <div className="mt-4 space-y-3">
                    {(forecasts.beds?.forecasts || []).map((item) => (
                      <div key={`${item.departmentId?._id || item.departmentId}-${item.bedType}`} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-black text-slate-950">{item.departmentId?.name || "Department"} · {item.bedType}</p>
                            <p className="mt-1 text-sm text-slate-500">{item.explanation}</p>
                          </div>
                          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">{item.confidence}</span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                          <div className="rounded-lg bg-white dark:bg-slate-950 p-3"><p className="text-slate-500">Predicted</p><p className="font-black">{item.predictedDemand} beds</p></div>
                          <div className="rounded-lg bg-white dark:bg-slate-950 p-3"><p className="text-slate-500">Reserve</p><p className="font-black">{item.recommendedReserve} beds</p></div>
                        </div>
                      </div>
                    ))}
                    {!forecasts.beds?.forecasts?.length && <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">Add departments and OPD tokens to generate bed demand signals.</p>}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-950 p-6 shadow-sm">
                  <h3 className="flex items-center gap-2 text-lg font-black text-slate-950"><Droplets size={20} className="text-red-500" /> Blood Bank Demand</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {(forecasts.blood?.forecasts || []).map((item) => (
                      <div key={item.bloodGroup} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-xl font-black text-slate-950">{item.bloodGroup}</p>
                          <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.shortageRisk === "high" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                            {item.shortageRisk} risk
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-500">{item.predictedUnits} units predicted · reserve {item.recommendedReserve}</p>
                        <p className="mt-2 text-xs text-slate-500">{item.explanation}</p>
                      </div>
                    ))}
                    {!forecasts.blood?.forecasts?.length && <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500 sm:col-span-2">Blood demand appears after forecast generation.</p>}
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === "website" && (
            <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-950 p-6 shadow-sm">
                <Globe2 className="text-blue-600 dark:text-red-500" size={28} />
                <h2 className="mt-4 text-xl font-black text-slate-950">Hospital Website</h2>
                <p className="mt-2 text-sm text-slate-500">Your public path-based website works without wildcard DNS.</p>
                {websiteUrl && (
                  <Link to={websiteUrl} className="mt-5 flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm font-bold text-blue-700">
                    medipulse.com{websiteUrl}
                    <ExternalLink size={16} />
                  </Link>
                )}
                <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
                  Subdomain option: {hospital.slug}.medipulse.com requires DNS setup.
                </p>
                <form onSubmit={changePassword} className="mt-6 border-t border-slate-100 pt-6">
                  <h3 className="flex items-center gap-2 font-black text-slate-950"><Lock size={17} /> Change Admin Password</h3>
                  <input value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} type="password" required placeholder="Current password" className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                  <input value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} type="password" required minLength={8} placeholder="New password" className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                  <button className="mt-3 rounded-lg bg-blue-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white">Update password</button>
                  {passwordMessage && <p className="mt-3 text-sm text-blue-700">{passwordMessage}</p>}
                </form>
              </div>
              <form onSubmit={saveBranding} className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-950 p-6 shadow-sm">
                <h2 className="flex items-center gap-2 text-xl font-black text-slate-950"><Palette size={20} className="text-blue-600 dark:text-red-500" /> Branding</h2>
                <div className="mt-5 grid gap-4">
                  <input value={brandingForm.tagline} onChange={(e) => setBrandingForm({ ...brandingForm, tagline: e.target.value })} placeholder="Tagline" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                  <textarea value={brandingForm.about} onChange={(e) => setBrandingForm({ ...brandingForm, about: e.target.value })} placeholder="About hospital" className="min-h-24 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                  <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
                    <input value={brandingForm.primaryColor} onChange={(e) => setBrandingForm({ ...brandingForm, primaryColor: e.target.value })} type="color" className="h-11 w-full rounded-lg border border-slate-300 p-1" />
                    <input value={brandingForm.logo} onChange={(e) => setBrandingForm({ ...brandingForm, logo: e.target.value })} placeholder="Logo URL" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <input value={brandingForm.coverImage} onChange={(e) => setBrandingForm({ ...brandingForm, coverImage: e.target.value })} placeholder="Cover image URL" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                </div>
                <button className="mt-5 rounded-lg bg-blue-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white">Save website branding</button>
              </form>
            </section>
          )}
        </section>
      </div>

      {/* OTP Removal Modal */}
      {otpModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-950 p-6 shadow-2xl">
            <h2 className="text-xl font-black text-slate-950">Remove Staff Member</h2>
            <p className="mt-2 text-sm text-slate-600">You are about to remove <strong>{otpModal.member.name}</strong> ({otpModal.member.role.replace(/_/g, " ")}) from the hospital.</p>
            {otpError && <p className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{otpError}</p>}
            {!otpSent ? (
              <div className="mt-5 flex gap-3">
                <button
                  onClick={sendRemovalOtp}
                  disabled={otpSending}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-400"
                >
                  {otpSending ? "Sending OTP..." : "Send OTP to My Email"}
                </button>
                <button onClick={() => setOtpModal(null)} className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <p className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">OTP sent to your admin email. Enter it below to confirm removal.</p>
                <input
                  value={otpValue}
                  onChange={(e) => setOtpValue(e.target.value)}
                  maxLength={6}
                  placeholder="Enter 6-digit OTP"
                  className="w-full rounded-lg border border-slate-300 px-4 py-3 text-center text-2xl font-bold tracking-widest outline-none focus:border-red-500"
                />
                <div className="flex gap-3">
                  <button
                    onClick={confirmRemovalWithOtp}
                    disabled={otpSending || otpValue.length !== 6}
                    className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-400"
                  >
                    {otpSending ? "Removing..." : "Confirm Removal"}
                  </button>
                  <button onClick={() => setOtpModal(null)} className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {openPanel && (
        <div className="fixed inset-0 z-[60] bg-slate-950/40">
          <div className="ml-auto h-full w-full max-w-xl overflow-y-auto bg-white dark:bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-slate-950">{openPanel === "department" ? "Add Department" : "Invite Staff"}</h2>
              <button onClick={() => setOpenPanel("")} className="rounded-full p-2 hover:bg-slate-100"><X size={20} /></button>
            </div>

            {openPanel === "department" ? (
              <form onSubmit={addDepartment} className="mt-6 grid gap-4">
                <input value={department.name} onChange={(e) => setDepartment({ ...department, name: e.target.value })} required placeholder="Department name" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                <input value={department.code} onChange={(e) => setDepartment({ ...department, code: e.target.value.toUpperCase() })} placeholder="Code" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                <input value={department.consultationFee} onChange={(e) => setDepartment({ ...department, consultationFee: e.target.value })} required type="number" placeholder="Consultation fee" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                <textarea value={department.description} onChange={(e) => setDepartment({ ...department, description: e.target.value })} placeholder="Description" className="min-h-24 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                <button className="rounded-lg bg-blue-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white">Add Department</button>
              </form>
            ) : (
              <form onSubmit={inviteStaff} className="mt-6 grid gap-4">
                <input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} placeholder="Staff name (optional)" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                <input value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required type="email" placeholder="staff@hospital.com" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                <input value={invite.profilePhoto} onChange={(e) => setInvite({ ...invite, profilePhoto: e.target.value })} type="url" placeholder="Profile photo URL" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                  {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                {invite.role === "DOCTOR" && (
                  <>
                    <input value={invite.specialization} onChange={(e) => setInvite({ ...invite, specialization: e.target.value })} placeholder="Specialization" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                    <input value={invite.qualification} onChange={(e) => setInvite({ ...invite, qualification: e.target.value })} placeholder="Qualification" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                    <input value={invite.experience} onChange={(e) => setInvite({ ...invite, experience: e.target.value })} type="number" placeholder="Experience years" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                    <input value={invite.consultationFee} onChange={(e) => setInvite({ ...invite, consultationFee: e.target.value })} type="number" placeholder="Consultation fee" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                    <textarea value={invite.bio} onChange={(e) => setInvite({ ...invite, bio: e.target.value })} placeholder="Doctor bio" className="min-h-24 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                  </>
                )}
                <button className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white">
                  <Send size={16} />
                  Send Invite
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  );
};

export default HospitalAdminDashboard;
