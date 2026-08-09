import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Building2, Lock, UserRound } from "lucide-react";
import { BACKEND_URL } from "../utils";

const StaffAcceptInvite = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const hospitalId = params.get("hospital") || "";
  const token = params.get("token") || "";
  const [invite, setInvite] = useState(null);
  const [form, setForm] = useState({ name: "", password: "", profilePhoto: "", specialization: "", qualification: "", experience: "" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hospitalId || !token) {
      setMessage("Invite link is missing required details");
      return;
    }
    axios
      .get(`${BACKEND_URL}/api/hospitals/${hospitalId}/staff/invite/accept?token=${encodeURIComponent(token)}`)
      .then((response) => {
        setInvite(response.data.staff);
        setForm((current) => ({ ...current, name: response.data.staff?.name || "" }));
      })
      .catch((error) => setMessage(error.response?.data?.message || "Invite is invalid or expired"));
  }, [hospitalId, token]);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/auth/staff/set-password`,
        {
          hospitalId,
          token,
          password: form.password,
          name: form.name,
          profilePhoto: form.profilePhoto,
          doctorProfile: invite?.role === "DOCTOR"
            ? {
                specialization: form.specialization,
                qualification: form.qualification,
                experience: Number(form.experience || 0),
              }
            : undefined,
        },
        { withCredentials: true },
      );
      sessionStorage.setItem("medipulse.hospitalAdmin", JSON.stringify({ staff: response.data.result, hospital: response.data.hospital || { _id: hospitalId } }));
      navigate(invite?.role === "DOCTOR" ? "/hospital/doctor-opd" : "/hospital/staff-communication");
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not complete staff setup");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white dark:bg-slate-950 p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:text-red-500"><Building2 /></div>
          <div>
            <p className="text-sm font-bold uppercase text-blue-600 dark:text-red-500">Hospital Staff Invite</p>
            <h1 className="text-2xl font-black text-slate-950">{invite ? `Join as ${invite.role.replace("_", " ")}` : "Complete staff setup"}</h1>
          </div>
        </div>
        {message && <p className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p>}
        {invite && (
          <form onSubmit={submit} className="mt-6 grid gap-4">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Name</span>
              <div className="relative mt-1">
                <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pl-10 text-sm outline-none focus:border-blue-500" />
              </div>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Password</span>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pl-10 text-sm outline-none focus:border-blue-500" />
              </div>
            </label>
            <input value={form.profilePhoto} onChange={(e) => setForm({ ...form, profilePhoto: e.target.value })} placeholder="Profile photo URL (optional)" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            {invite.role === "DOCTOR" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <input value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} placeholder="Specialization" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                <input value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} placeholder="Qualification" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                <input value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} type="number" placeholder="Experience" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </div>
            )}
            <button disabled={loading} className="rounded-lg bg-blue-600 dark:bg-red-700 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-400">
              {loading ? "Joining..." : "Complete setup"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
};

export default StaffAcceptInvite;
