import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Building2, CalendarDays, HeartPulse, Plus, Search, Star, Trash2, UserRound } from "lucide-react";
import { BACKEND_URL } from "../utils";

import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";

const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "Date unavailable";

const PatientHealthPortal = () => {
  const { user } = useAuth();
  const [timeline, setTimeline] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [browseHospitals, setBrowseHospitals] = useState([]);
  const [family, setFamily] = useState([]);
  const [member, setMember] = useState({ name: "", relation: "", dob: "", gender: "", bloodGroup: "" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const stats = useMemo(
    () => ({
      visits: timeline.length,
      hospitals: hospitals.length,
      family: family.length,
    }),
    [family.length, hospitals.length, timeline.length],
  );

  const loadPortal = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [timelineRes, hospitalsRes, familyRes, browseRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/patients/me/health-timeline`, { withCredentials: true }),
        axios.get(`${BACKEND_URL}/api/patients/me/hospitals`, { withCredentials: true }),
        axios.get(`${BACKEND_URL}/api/patients/me/family`, { withCredentials: true }),
        axios.get(`${BACKEND_URL}/api/hospitals?limit=12`),
      ]);
      setTimeline(timelineRes.data.items || []);
      setHospitals(hospitalsRes.data.items || []);
      setFamily(familyRes.data.items || []);
      setBrowseHospitals(browseRes.data.items || []);
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to load patient portal");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPortal();
  }, []);

  const addMember = async (event) => {
    event.preventDefault();
    setMessage("");
    try {
      const response = await axios.post(`${BACKEND_URL}/api/patients/me/family`, member, { withCredentials: true });
      setFamily(response.data.items || []);
      setMember({ name: "", relation: "", dob: "", gender: "", bloodGroup: "" });
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to add family member");
    }
  };

  const removeMember = async (memberId) => {
    try {
      const response = await axios.delete(`${BACKEND_URL}/api/patients/me/family/${memberId}`, { withCredentials: true });
      setFamily(response.data.items || []);
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to remove family member");
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-900 px-4 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase text-red-600 dark:text-red-500">Patient Portal</p>
          <h1 className="mt-1 text-3xl font-extrabold text-gray-950">Health Records</h1>
          <p className="mt-2 text-sm text-gray-600">A unified timeline of completed OPD visits and online appointments.</p>
          {message && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{message}</p>}
        </section>

        {!user?.triageProfile?.agentSummary && (
          <section className="rounded-xl border border-red-200 bg-red-50 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-blue-950">Complete your health triage</h2>
            <p className="mt-2 text-sm text-blue-800">
              Set up your baseline medical profile before booking an appointment. Our AI assistant will ask a few quick questions to prepare a summary for your future doctors.
            </p>
            <div className="mt-4">
              <Link
                to="/opd/triage"
                className="inline-flex rounded-md bg-red-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
              >
                Start Triage Profile →
              </Link>
            </div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["Completed visits", stats.visits, HeartPulse],
            ["Hospitals visited", stats.hospitals, Building2],
            ["Family members", stats.family, UserRound],
          ].map(([label, value, Icon]) => (
            <div key={label} className="rounded-xl bg-white dark:bg-slate-950 p-5 shadow-sm">
              <Icon className="text-red-600 dark:text-red-500" />
              <p className="mt-3 text-sm text-gray-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-gray-950">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-950">
              <CalendarDays className="text-red-600 dark:text-red-500" />
              Health Timeline
            </h2>
            <div className="mt-5 space-y-4">
              {loading ? (
                <p className="text-sm text-gray-500">Loading records...</p>
              ) : timeline.length ? (
                timeline.map((item) => (
                  <div key={`${item.type}-${item.id}`} className="rounded-lg border border-gray-200 dark:border-red-900/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase text-red-600 dark:text-red-500">{item.type.replace("_", " ")}</p>
                        <h3 className="mt-1 font-bold text-gray-950">{item.title}</h3>
                        <p className="mt-1 text-sm text-gray-600">{item.subtitle}</p>
                      </div>
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">{formatDate(item.date)}</span>
                    </div>
                    {item.chiefComplaint && <p className="mt-3 text-sm text-gray-700">Complaint: {item.chiefComplaint}</p>}
                    {item.patientBrief?.agentSummary && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-blue-900">{item.patientBrief.agentSummary}</p>}
                    {item.doctorNotes && <p className="mt-3 text-sm text-gray-700">Doctor notes: {item.doctorNotes}</p>}
                  </div>
                ))
              ) : (
                <p className="rounded-lg bg-gray-50 dark:bg-slate-900 p-5 text-sm text-gray-500">No completed health records yet.</p>
              )}
            </div>
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-950">Visited Hospitals</h2>
              <div className="mt-4 space-y-3">
                {hospitals.map((hospital) => (
                  <div key={hospital._id} className="rounded-lg border border-gray-200 dark:border-red-900/40 p-4">
                    <p className="font-bold text-gray-950">{hospital.name}</p>
                    <p className="text-sm text-gray-600">{hospital.address?.city}, {hospital.address?.state}</p>
                  </div>
                ))}
                {!hospitals.length && <p className="text-sm text-gray-500">No hospital visits yet.</p>}
              </div>
            </section>

            <section className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-950">Family Manager</h2>
              <form onSubmit={addMember} className="mt-4 space-y-3">
                {[
                  ["name", "Name"],
                  ["relation", "Relation"],
                  ["dob", "Date of birth"],
                  ["gender", "Gender"],
                  ["bloodGroup", "Blood group"],
                ].map(([field, label]) => (
                  <input
                    key={field}
                    type={field === "dob" ? "date" : "text"}
                    value={member[field]}
                    onChange={(event) => setMember({ ...member, [field]: event.target.value })}
                    placeholder={label}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-500"
                  />
                ))}
                <button className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-red-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white">
                  <Plus size={16} />
                  Add Family Member
                </button>
              </form>

              <div className="mt-5 space-y-2">
                {family.map((item) => (
                  <div key={item._id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 dark:bg-slate-900 p-3">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-slate-100">{item.name}</p>
                      <p className="text-xs text-gray-500">{item.relation} {item.bloodGroup ? `• ${item.bloodGroup}` : ""}</p>
                    </div>
                    <button onClick={() => removeMember(item._id)} className="rounded-md p-2 text-red-600 hover:bg-red-50" aria-label="Remove family member">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>

        <section className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-950">
                <Search className="text-red-600 dark:text-red-500" />
                Browse Hospitals
              </h2>
              <p className="mt-1 text-sm text-gray-600">Explore active hospitals available on MediPulse.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {browseHospitals.map((hospital) => (
              <div key={hospital._id} className="rounded-lg border border-gray-200 dark:border-red-900/40 p-4">
                <div className="flex items-center gap-3">
                  {hospital.branding?.logo ? (
                    <img src={hospital.branding.logo} alt={hospital.name} className="h-12 w-12 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:text-red-500">
                      <Building2 size={22} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-bold text-gray-950">{hospital.name}</p>
                    <p className="text-sm text-gray-600">{hospital.address?.city}, {hospital.address?.state}</p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-gray-600">{hospital.branding?.tagline || "Smart OPD hospital on MediPulse."}</p>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-1 text-yellow-600">
                    <Star size={15} fill="currentColor" />
                    {Number(hospital.stats?.avgRating || 0).toFixed(1)}
                  </span>
                  <span className="text-gray-500">{hospital.stats?.totalDoctors || 0} doctors</span>
                </div>
              </div>
            ))}
            {!browseHospitals.length && !loading && <p className="text-sm text-gray-500">No active hospitals available yet.</p>}
          </div>
        </section>
      </div>
    </main>
  );
};

export default PatientHealthPortal;
