import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Building2, CalendarDays, HeartPulse, Plus, Trash2, UserRound } from "lucide-react";
import { BACKEND_URL } from "../utils";

const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "Date unavailable";

const PatientHealthPortal = () => {
  const [timeline, setTimeline] = useState([]);
  const [hospitals, setHospitals] = useState([]);
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
      const [timelineRes, hospitalsRes, familyRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/patients/me/health-timeline`, { withCredentials: true }),
        axios.get(`${BACKEND_URL}/api/patients/me/hospitals`, { withCredentials: true }),
        axios.get(`${BACKEND_URL}/api/patients/me/family`, { withCredentials: true }),
      ]);
      setTimeline(timelineRes.data.items || []);
      setHospitals(hospitalsRes.data.items || []);
      setFamily(familyRes.data.items || []);
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
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-xl bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase text-blue-600">Patient Portal</p>
          <h1 className="mt-1 text-3xl font-extrabold text-gray-950">Health Records</h1>
          <p className="mt-2 text-sm text-gray-600">A unified timeline of completed OPD visits and online appointments.</p>
          {message && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{message}</p>}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["Completed visits", stats.visits, HeartPulse],
            ["Hospitals visited", stats.hospitals, Building2],
            ["Family members", stats.family, UserRound],
          ].map(([label, value, Icon]) => (
            <div key={label} className="rounded-xl bg-white p-5 shadow-sm">
              <Icon className="text-blue-600" />
              <p className="mt-3 text-sm text-gray-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-gray-950">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-950">
              <CalendarDays className="text-blue-600" />
              Health Timeline
            </h2>
            <div className="mt-5 space-y-4">
              {loading ? (
                <p className="text-sm text-gray-500">Loading records...</p>
              ) : timeline.length ? (
                timeline.map((item) => (
                  <div key={`${item.type}-${item.id}`} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase text-blue-600">{item.type.replace("_", " ")}</p>
                        <h3 className="mt-1 font-bold text-gray-950">{item.title}</h3>
                        <p className="mt-1 text-sm text-gray-600">{item.subtitle}</p>
                      </div>
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">{formatDate(item.date)}</span>
                    </div>
                    {item.chiefComplaint && <p className="mt-3 text-sm text-gray-700">Complaint: {item.chiefComplaint}</p>}
                    {item.patientBrief?.agentSummary && <p className="mt-3 rounded-md bg-blue-50 p-3 text-sm text-blue-900">{item.patientBrief.agentSummary}</p>}
                    {item.doctorNotes && <p className="mt-3 text-sm text-gray-700">Doctor notes: {item.doctorNotes}</p>}
                  </div>
                ))
              ) : (
                <p className="rounded-lg bg-gray-50 p-5 text-sm text-gray-500">No completed health records yet.</p>
              )}
            </div>
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-950">Visited Hospitals</h2>
              <div className="mt-4 space-y-3">
                {hospitals.map((hospital) => (
                  <div key={hospital._id} className="rounded-lg border border-gray-200 p-4">
                    <p className="font-bold text-gray-950">{hospital.name}</p>
                    <p className="text-sm text-gray-600">{hospital.address?.city}, {hospital.address?.state}</p>
                  </div>
                ))}
                {!hospitals.length && <p className="text-sm text-gray-500">No hospital visits yet.</p>}
              </div>
            </section>

            <section className="rounded-xl bg-white p-6 shadow-sm">
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
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                ))}
                <button className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white">
                  <Plus size={16} />
                  Add Family Member
                </button>
              </form>

              <div className="mt-5 space-y-2">
                {family.map((item) => (
                  <div key={item._id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 p-3">
                    <div>
                      <p className="font-semibold text-gray-900">{item.name}</p>
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
      </div>
    </main>
  );
};

export default PatientHealthPortal;
