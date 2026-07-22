import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Building2, ClipboardList, MessageSquare, Send, Stethoscope, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { BACKEND_URL } from "../utils";

const HospitalAdminDashboard = () => {
  const saved = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem("medipulse.hospitalAdmin") || "null");
    } catch {
      return null;
    }
  }, []);

  const hospital = saved?.hospital;
  const [analytics, setAnalytics] = useState(null);
  const [staff, setStaff] = useState([]);
  const [message, setMessage] = useState("");
  const [department, setDepartment] = useState({ name: "", consultationFee: "" });
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

  const hospitalId = hospital?._id;

  const loadPortal = async () => {
    if (!hospitalId) return;
    const [analyticsRes, staffRes] = await Promise.all([
      axios.get(`${BACKEND_URL}/api/hospitals/${hospitalId}/analytics`, { withCredentials: true }),
      axios.get(`${BACKEND_URL}/api/hospitals/${hospitalId}/staff`, { withCredentials: true }),
    ]);
    setAnalytics(analyticsRes.data);
    setStaff(staffRes.data.items || []);
  };

  useEffect(() => {
    loadPortal().catch((error) => setMessage(error.response?.data?.message || "Unable to load hospital portal"));
  }, [hospitalId]);

  const addDepartment = async (event) => {
    event.preventDefault();
    setMessage("");
    try {
      await axios.post(
        `${BACKEND_URL}/api/hospitals/${hospitalId}/departments`,
        {
          name: department.name,
          opd: { consultationFee: Number(department.consultationFee || 0) },
        },
        { withCredentials: true },
      );
      setDepartment({ name: "", consultationFee: "" });
      setMessage("Department added successfully");
      await loadPortal();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not add department");
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
      setInvite({
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
      setMessage("Staff invite sent");
      await loadPortal();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not invite staff");
    }
  };

  if (!hospitalId) {
    return (
      <main className="min-h-screen bg-gray-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">Hospital portal not found</h1>
          <p className="mt-2 text-gray-600">Create a hospital admin account first.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase text-blue-600">Hospital Admin Portal</p>
              <h1 className="mt-1 text-3xl font-extrabold text-gray-950">{hospital.name}</h1>
              <p className="mt-2 text-gray-600">
                Status: <span className="font-semibold">{hospital.status}</span> | Public slug: {hospital.slug}
              </p>
            </div>
            <div className="rounded-xl bg-blue-50 p-4 text-blue-900">
              <Building2 size={24} />
              <p className="mt-2 text-sm">Trial workspace created</p>
            </div>
          </div>
          {message && <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{message}</p>}
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            ["Tokens Today", analytics?.today?.tokensIssued || 0, ClipboardList],
            ["Completed", analytics?.today?.completed || 0, Stethoscope],
            ["No Shows", analytics?.today?.noShows || 0, Users],
            ["Revenue", `INR ${analytics?.today?.revenue || 0}`, Building2],
          ].map(([label, value, Icon]) => (
            <div key={label} className="rounded-xl bg-white p-5 shadow-sm">
              <Icon className="text-blue-600" size={22} />
              <p className="mt-3 text-sm text-gray-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-gray-950">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Link to="/hospital/nursing-station" className="rounded-2xl bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <ClipboardList className="text-blue-600" size={26} />
            <h2 className="mt-4 text-xl font-bold text-gray-950">Nursing Station</h2>
            <p className="mt-2 text-sm text-gray-600">Issue OPD tokens, record vitals, and keep the doctor queue moving in real time.</p>
          </Link>
          <Link to="/hospital/doctor-opd" className="rounded-2xl bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <Stethoscope className="text-blue-600" size={26} />
            <h2 className="mt-4 text-xl font-bold text-gray-950">Doctor OPD Console</h2>
            <p className="mt-2 text-sm text-gray-600">Start consultations, complete visits, and mark no-shows from the live queue.</p>
          </Link>
          <Link to="/hospital/staff-communication" className="rounded-2xl bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <MessageSquare className="text-blue-600" size={26} />
            <h2 className="mt-4 text-xl font-bold text-gray-950">Staff Communication</h2>
            <p className="mt-2 text-sm text-gray-600">Share patient updates, department messages, and lab alerts across hospital teams.</p>
          </Link>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={addDepartment} className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-950">Add Department</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <input
                value={department.name}
                onChange={(event) => setDepartment({ ...department, name: event.target.value })}
                required
                placeholder="Cardiology"
                className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
              <input
                value={department.consultationFee}
                onChange={(event) => setDepartment({ ...department, consultationFee: event.target.value })}
                required
                type="number"
                placeholder="Consultation fee"
                className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <button className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Add Department</button>
          </form>

          <form onSubmit={inviteStaff} className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-950">Invite Staff</h2>
            <div className="mt-4 grid gap-4">
              <input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} required placeholder="Staff name" className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              <input value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required type="email" placeholder="staff@hospital.com" className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              <input value={invite.profilePhoto} onChange={(e) => setInvite({ ...invite, profilePhoto: e.target.value })} type="url" placeholder="Profile photo URL" className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                {["DOCTOR", "NURSE", "LAB_TECH", "RECEPTIONIST", "PHARMACIST", "DEPARTMENT_HEAD"].map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
              {invite.role === "DOCTOR" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <input value={invite.specialization} onChange={(e) => setInvite({ ...invite, specialization: e.target.value })} placeholder="Specialization" className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                  <input value={invite.qualification} onChange={(e) => setInvite({ ...invite, qualification: e.target.value })} placeholder="Qualification" className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                  <input value={invite.experience} onChange={(e) => setInvite({ ...invite, experience: e.target.value })} type="number" placeholder="Experience years" className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                  <input value={invite.consultationFee} onChange={(e) => setInvite({ ...invite, consultationFee: e.target.value })} type="number" placeholder="Consultation fee" className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                  <textarea value={invite.bio} onChange={(e) => setInvite({ ...invite, bio: e.target.value })} placeholder="Doctor bio" className="min-h-20 rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 sm:col-span-2" />
                </div>
              )}
            </div>
            <button className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">
              <Send size={16} />
              Send Invite
            </button>
          </form>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-950">Staff Members</h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
            {staff.map((member) => (
              <div key={member._id} className="grid gap-2 border-b border-gray-100 p-4 last:border-b-0 md:grid-cols-4">
                <span className="font-medium text-gray-900">{member.name}</span>
                <span className="text-sm text-gray-600">{member.email}</span>
                <span className="text-sm text-gray-600">{member.role}</span>
                <span className="flex items-center gap-2 text-sm text-gray-500">
                  {member.profilePhoto && <img src={member.profilePhoto} alt={member.name} className="h-8 w-8 rounded-full object-cover" />}
                  {member.inviteStatus}
                </span>
              </div>
            ))}
            {!staff.length && <p className="p-4 text-sm text-gray-500">No staff members yet.</p>}
          </div>
        </section>
      </div>
    </main>
  );
};

export default HospitalAdminDashboard;
