import { useState } from "react";
import axios from "axios";
import { useNavigate, Link } from "react-router-dom";
import { Building2, Lock, Mail, MapPin, Phone, ShieldCheck, User } from "lucide-react";
import { BACKEND_URL } from "../utils";

const hospitalTypes = [
  { value: "private", label: "Private Hospital" },
  { value: "government", label: "Government Hospital" },
  { value: "clinic", label: "Clinic" },
  { value: "diagnostic-center", label: "Diagnostic Center" },
  { value: "nursing-home", label: "Nursing Home" },
];

const medicineSystems = [
  { value: "allopathic", label: "Allopathic / Modern Medicine" },
  { value: "ayurveda", label: "Ayurveda Hospital" },
  { value: "homeopathy", label: "Homeopathy Hospital" },
  { value: "yoga_wellness", label: "Yoga & Wellness Center" },
  { value: "integrative", label: "Integrative Care" },
];

const Field = ({ icon, label, ...props }) => (
  <label className="block">
    <span className="text-sm font-medium text-gray-700">{label}</span>
    <span className="relative mt-1 block">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
        {icon}
      </span>
      <input
        {...props}
        className="w-full rounded-lg border border-gray-300 bg-white dark:bg-slate-950 px-3 py-2.5 pl-10 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-blue-100"
      />
    </span>
  </label>
);

const HospitalAdminSignup = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    type: "private",
    medicineSystem: "allopathic",
    registrationNumber: "",
    adminName: "",
    adminPassword: "",
    line1: "",
    city: "",
    state: "",
    pincode: "",
  });

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/hospitals/register`,
        {
          name: form.name,
          email: form.email,
          phone: form.phone,
          type: form.type,
          medicineSystem: form.medicineSystem,
          registrationNumber: form.registrationNumber,
          adminName: form.adminName,
          adminPassword: form.adminPassword,
          address: {
            line1: form.line1,
            city: form.city,
            state: form.state,
            pincode: form.pincode,
          },
        },
        { withCredentials: true },
      );

      sessionStorage.setItem("medipulse.hospitalAdmin", JSON.stringify(response.data));
      navigate("/hospital/admin");
    } catch (error) {
      setMessage(error.response?.data?.message || "Hospital registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-red-50 dark:from-red-950/20 via-white to-slate-100 px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-600 dark:bg-red-700 text-white">
            <Building2 size={28} />
          </div>
          <h1 className="mt-4 text-3xl font-extrabold text-gray-950">Create Hospital Admin Portal</h1>
          <p className="mt-2 text-gray-600">
            Register your hospital, start a 30-day trial, and set up departments and staff.
          </p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-gray-200 dark:border-red-900/40 bg-white dark:bg-slate-950 p-6 shadow-sm">
          {message && (
            <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {message}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-4">
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-slate-100">
                <Building2 size={20} className="text-red-600 dark:text-red-500" />
                Hospital Details
              </h2>
              <Field icon={<Building2 size={18} />} label="Hospital Name" required value={form.name} onChange={(e) => update("name", e.target.value)} />
              <Field icon={<Mail size={18} />} label="Hospital Email" type="email" required value={form.email} onChange={(e) => update("email", e.target.value)} />
              <Field icon={<Phone size={18} />} label="Phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
              <Field icon={<ShieldCheck size={18} />} label="Registration / License Number" required value={form.registrationNumber} onChange={(e) => update("registrationNumber", e.target.value)} />
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Hospital Type</span>
                <select
                  value={form.type}
                  onChange={(e) => update("type", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-blue-100"
                >
                  {hospitalTypes.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Care System</span>
                <select
                  value={form.medicineSystem}
                  onChange={(e) => update("medicineSystem", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-blue-100"
                >
                  {medicineSystems.map((system) => (
                    <option key={system.value} value={system.value}>{system.label}</option>
                  ))}
                </select>
              </label>
            </section>

            <section className="space-y-4">
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-slate-100">
                <User size={20} className="text-red-600 dark:text-red-500" />
                Admin and Address
              </h2>
              <Field icon={<User size={18} />} label="Admin Name" required value={form.adminName} onChange={(e) => update("adminName", e.target.value)} />
              <Field icon={<Lock size={18} />} label="Admin Password" type="password" required value={form.adminPassword} onChange={(e) => update("adminPassword", e.target.value)} />
              <Field icon={<MapPin size={18} />} label="Address Line" value={form.line1} onChange={(e) => update("line1", e.target.value)} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field icon={<MapPin size={18} />} label="City" required value={form.city} onChange={(e) => update("city", e.target.value)} />
                <Field icon={<MapPin size={18} />} label="State" required value={form.state} onChange={(e) => update("state", e.target.value)} />
              </div>
              <Field icon={<MapPin size={18} />} label="Pincode" value={form.pincode} onChange={(e) => update("pincode", e.target.value)} />
            </section>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-5">
            <Link to="/signup" className="text-sm font-medium text-gray-600 hover:text-red-600 dark:text-red-500">
              Back to profile selection
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-red-600 dark:bg-red-700 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {loading ? "Creating portal..." : "Create Hospital Portal"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
};

export default HospitalAdminSignup;
