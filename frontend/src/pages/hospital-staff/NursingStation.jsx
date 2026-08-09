import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ClipboardPlus, RefreshCcw, Save, UserRound } from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { getSocket } from "../../socket";

const readStaffSession = () => {
  try {
    return JSON.parse(sessionStorage.getItem("medipulse.hospitalAdmin") || "null");
  } catch {
    return null;
  }
};

const NursingStation = () => {
  const saved = useMemo(readStaffSession, []);
  const staff = saved?.staff;
  const hospital = saved?.hospital;
  const hospitalId = staff?.hospitalId || hospital?._id;
  const [doctorId, setDoctorId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [directory, setDirectory] = useState({ departments: [], staff: [] });
  const [queue, setQueue] = useState({ waiting: [], currentlyServing: null });
  const [message, setMessage] = useState("");
  const [selectedToken, setSelectedToken] = useState(null);
  const [vitals, setVitals] = useState({ bp: "", temperature: "", pulse: "", oxygenSat: "", weight: "", height: "", chiefComplaint: "" });
  const [newToken, setNewToken] = useState({ name: "", phone: "", age: "", gender: "", chiefComplaint: "" });

  const loadQueue = async () => {
    if (!hospitalId || !doctorId) return;
    const response = await axios.get(`${BACKEND_URL}/api/opd/${hospitalId}/${doctorId}/queue`, { withCredentials: true });
    setQueue(response.data);
  };

  const loadDirectory = async () => {
    if (!hospitalId) return;
    const response = await axios.get(`${BACKEND_URL}/api/staff-messages/directory`, { withCredentials: true });
    const nextDirectory = response.data || { departments: [], staff: [] };
    setDirectory(nextDirectory);
    if (!departmentId) setDepartmentId(staff?.departmentIds?.[0] || nextDirectory.departments?.[0]?._id || "");
  };

  useEffect(() => {
    loadDirectory().catch((error) => setMessage(error.response?.data?.message || "Unable to load staff directory"));
  }, [hospitalId]);

  useEffect(() => {
    const doctors = directory.staff.filter((member) => member.role === "DOCTOR" && (!departmentId || member.departmentIds?.some((id) => String(id) === String(departmentId))));
    if (!doctorId && doctors[0]?._id) setDoctorId(doctors[0]._id);
  }, [departmentId, directory.staff, doctorId]);

  useEffect(() => {
    loadQueue().catch(() => {});
  }, [doctorId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    const refresh = () => loadQueue().catch(() => {});
    socket.on("opd:token-issued", refresh);
    socket.on("opd:vitals-ready", refresh);
    socket.on("opd:consultation-started", refresh);
    socket.on("opd:no-show", refresh);
    return () => {
      socket.off("opd:token-issued", refresh);
      socket.off("opd:vitals-ready", refresh);
      socket.off("opd:consultation-started", refresh);
      socket.off("opd:no-show", refresh);
    };
  }, [hospitalId, doctorId]);

  const issueToken = async (event) => {
    event.preventDefault();
    setMessage("");
    try {
      await axios.post(
        `${BACKEND_URL}/api/opd/${hospitalId}/${departmentId}/token`,
        {
          doctorId,
          patientInfo: { ...newToken, isWalkIn: true },
          chiefComplaint: newToken.chiefComplaint,
        },
        { withCredentials: true },
      );
      setNewToken({ name: "", phone: "", age: "", gender: "", chiefComplaint: "" });
      await loadQueue();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not issue token");
    }
  };

  const saveVitals = async (event) => {
    event.preventDefault();
    if (!selectedToken) return;
    setMessage("");
    try {
      await axios.patch(`${BACKEND_URL}/api/opd/tokens/${selectedToken._id}/vitals`, vitals, { withCredentials: true });
      setSelectedToken(null);
      setVitals({ bp: "", temperature: "", pulse: "", oxygenSat: "", weight: "", height: "", chiefComplaint: "" });
      await loadQueue();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not save vitals");
    }
  };

  const markNoShow = async (tokenId) => {
    try {
      await axios.patch(`${BACKEND_URL}/api/opd/tokens/${tokenId}/no-show`, {}, { withCredentials: true });
      await loadQueue();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not mark no-show");
    }
  };

  if (!hospitalId) {
    return <div className="min-h-screen bg-gray-50 dark:bg-slate-900 p-8">Staff session not found. Sign in as hospital staff first.</div>;
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-900 px-4 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase text-red-600 dark:text-red-500">{hospital?.name || "Hospital"}</p>
          <h1 className="text-2xl font-extrabold text-gray-950">Nursing Station</h1>
          <p className="mt-2 text-sm text-gray-600">Select a department and doctor to operate today&apos;s OPD queue.</p>
          {message && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-blue-700">{message}</p>}
        </section>

        <section className="grid gap-4 rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm md:grid-cols-[1fr_1fr_auto]">
          <select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setDoctorId(""); }} className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-500">
            <option value="">Select department</option>
            {directory.departments.map((department) => <option key={department._id} value={department._id}>{department.name}</option>)}
          </select>
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-500">
            <option value="">Select doctor</option>
            {directory.staff
              .filter((member) => member.role === "DOCTOR" && (!departmentId || member.departmentIds?.some((id) => String(id) === String(departmentId))))
              .map((doctor) => <option key={doctor._id} value={doctor._id}>{doctor.name} · {doctor.doctorProfile?.specialization || "Doctor"}</option>)}
          </select>
          <button onClick={loadQueue} className="inline-flex items-center justify-center gap-2 rounded-md bg-red-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white">
            <RefreshCcw size={16} />
            Load
          </button>
        </section>

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <form onSubmit={issueToken} className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-950">
              <ClipboardPlus className="text-red-600 dark:text-red-500" />
              Issue Walk-in Token
            </h2>
            <div className="mt-4 space-y-3">
              {["name", "phone", "age", "gender", "chiefComplaint"].map((field) => (
                <input
                  key={field}
                  value={newToken[field]}
                  onChange={(e) => setNewToken({ ...newToken, [field]: e.target.value })}
                  placeholder={field === "chiefComplaint" ? "Chief complaint" : field[0].toUpperCase() + field.slice(1)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-500"
                />
              ))}
              <button disabled={!doctorId || !departmentId} className="w-full rounded-md bg-red-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-400">
                Issue Token
              </button>
            </div>
          </form>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-950">
                <UserRound className="text-red-600 dark:text-red-500" />
                Waiting for Vitals
              </h2>
              <div className="mt-4 space-y-3">
                {queue.waiting?.filter((token) => token.status === "waiting").map((token) => (
                  <div key={token._id} className="rounded-lg border border-gray-200 dark:border-red-900/40 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-bold">{token.displayToken}</p>
                        <p className="text-sm text-gray-600">{token.patientInfo?.name || "Patient"}</p>
                      </div>
                      <button onClick={() => { setSelectedToken(token); setVitals({ ...vitals, chiefComplaint: token.chiefComplaint || "" }); }} className="rounded-md bg-red-600 dark:bg-red-700 px-3 py-2 text-sm font-medium text-white">
                        Record Vitals
                      </button>
                    </div>
                    <button onClick={() => markNoShow(token._id)} className="mt-2 text-sm text-red-600">Mark no-show</button>
                  </div>
                ))}
                {!queue.waiting?.filter((token) => token.status === "waiting").length && <p className="text-sm text-gray-500">No patients waiting for vitals.</p>}
              </div>
            </div>

            <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-950">Vitals Done</h2>
              <div className="mt-4 space-y-3">
                {queue.waiting?.filter((token) => token.status === "vitals_done").map((token) => (
                  <div key={token._id} className="rounded-lg border border-green-200 bg-green-50 p-4">
                    <p className="font-bold text-green-950">{token.displayToken}</p>
                    <p className="text-sm text-green-800">{token.patientInfo?.name || "Patient"} ready for doctor</p>
                  </div>
                ))}
                {!queue.waiting?.filter((token) => token.status === "vitals_done").length && <p className="text-sm text-gray-500">No completed vitals yet.</p>}
              </div>
            </div>
          </div>
        </section>

        {selectedToken && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <form onSubmit={saveVitals} className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-950 p-6 shadow-xl">
              <h2 className="text-xl font-bold text-gray-950">Record Vitals: {selectedToken.displayToken}</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  ["bp", "BP e.g. 120/80"],
                  ["temperature", "Temperature F"],
                  ["pulse", "Pulse"],
                  ["oxygenSat", "SpO2 %"],
                  ["weight", "Weight kg"],
                  ["height", "Height cm"],
                ].map(([field, label]) => (
                  <input key={field} value={vitals[field]} onChange={(e) => setVitals({ ...vitals, [field]: e.target.value })} placeholder={label} className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-500" />
                ))}
              </div>
              <textarea value={vitals.chiefComplaint} onChange={(e) => setVitals({ ...vitals, chiefComplaint: e.target.value })} placeholder="Chief complaint" className="mt-3 min-h-24 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-500" />
              <div className="mt-5 flex justify-end gap-3">
                <button type="button" onClick={() => setSelectedToken(null)} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium">Cancel</button>
                <button className="inline-flex items-center gap-2 rounded-md bg-red-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white">
                  <Save size={16} />
                  Save Vitals
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </main>
  );
};

export default NursingStation;
