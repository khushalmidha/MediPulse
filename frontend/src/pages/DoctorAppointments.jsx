import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { BACKEND_URL } from "../utils";
import { useAuth } from "../context/AuthContext";
import AppointmentVideoCall from "../components/AppointmentVideoCall";

const DoctorAppointments = () => {
  const navigate = useNavigate();
  const { isAuth, loader, role } = useAuth();
  const [queueData, setQueueData] = useState({
    pendingCount: 0,
    queue: [],
    activeAppointment: null,
  });
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const [doctorNotes, setDoctorNotes] = useState("");

  useEffect(() => {
    setDoctorNotes(queueData.activeAppointment?.doctorNotes || "");
  }, [queueData.activeAppointment?._id, queueData.activeAppointment?.doctorNotes]);

  const fetchQueue = async () => {
    const response = await axios.get(`${BACKEND_URL}/appointment/doctor/queue`, {
      withCredentials: true,
    });
    setQueueData(response.data);
  };

  useEffect(() => {
    if (loader) return;
    if (!isAuth) {
      navigate("/login");
      return;
    }
    if (role !== "doctor") {
      navigate("/dashboard");
      return;
    }

    fetchQueue()
      .catch(() => setActionMessage("Unable to load doctor queue right now"))
      .finally(() => setLoading(false));
  }, [isAuth, loader, navigate, role]);

  useEffect(() => {
    if (!isAuth || role !== "doctor") return;
    const interval = setInterval(() => {
      fetchQueue().catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, [isAuth, role]);

  const startAppointment = async (appointmentId) => {
    setActionMessage("");
    try {
      const response = await axios.post(
        `${BACKEND_URL}/appointment/${appointmentId}/start`,
        {},
        { withCredentials: true },
      );
      setActionMessage(response.data.message);
      await fetchQueue();
    } catch (error) {
      setActionMessage(
        error.response?.data?.message || "Could not start appointment. Please retry",
      );
    }
  };

  const endAppointment = async (appointmentId) => {
    setActionMessage("");
    try {
      const response = await axios.post(
        `${BACKEND_URL}/appointment/${appointmentId}/end`,
        {},
        { withCredentials: true },
      );
      setActionMessage(response.data.message);
      await fetchQueue();
    } catch (error) {
      setActionMessage(error.response?.data?.message || "Could not end appointment");
    }
  };

  const saveDoctorNotes = async (appointmentId) => {
    setActionMessage("");
    try {
      const response = await axios.patch(
        `${BACKEND_URL}/appointment/${appointmentId}/notes`,
        { doctorNotes },
        { withCredentials: true },
      );
      setActionMessage(response.data.message);
      await fetchQueue();
    } catch (error) {
      setActionMessage(error.response?.data?.message || "Could not save notes");
    }
  };

  const generateReceipt = async (appointmentId) => {
    setActionMessage("");
    try {
      const response = await axios.post(
        `${BACKEND_URL}/appointment/${appointmentId}/receipt`,
        { doctorNotes },
        { withCredentials: true },
      );
      setDoctorNotes(response.data.doctorNotes || "");
      setActionMessage(response.data.message);
      await fetchQueue();
    } catch (error) {
      setActionMessage(error.response?.data?.message || "Could not generate receipt");
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 px-4 py-8">Loading appointment queue...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">Doctor Appointment Queue</h1>
          <p className="mt-2 text-gray-600">
            Pending appointments: <span className="font-semibold">{queueData.pendingCount}</span>
          </p>
          {actionMessage && <p className="mt-3 text-sm text-blue-700">{actionMessage}</p>}
        </div>

        {queueData.activeAppointment && (
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Active Appointment</h2>
                <p className="mt-1 text-gray-700">
                  Patient: {queueData.activeAppointment.user?.firstName}{" "}
                  {queueData.activeAppointment.user?.lastName || ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => endAppointment(queueData.activeAppointment._id)}
                className="rounded-md bg-red-600 px-4 py-2 text-white hover:bg-red-700"
              >
                End Appointment
              </button>
            </div>

            <p className="mt-3 text-sm text-gray-600">
              This call auto-ends in 5 minutes if you do not end it manually.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
              <div>
                <AppointmentVideoCall appointmentId={queueData.activeAppointment._id} />
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h3 className="text-sm font-semibold text-gray-900">Doctor Notes</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Add short clinical notes for the receipt before ending the appointment.
                </p>
                <textarea
                  value={doctorNotes}
                  onChange={(event) => setDoctorNotes(event.target.value)}
                  placeholder="Symptoms, advice, follow-up, medicines, warnings..."
                  className="mt-3 min-h-40 w-full rounded-md border border-gray-300 bg-white p-3 text-sm outline-none focus:border-blue-500"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => saveDoctorNotes(queueData.activeAppointment._id)}
                    className="rounded-md border border-blue-600 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                  >
                    Save Notes
                  </button>
                  <button
                    type="button"
                    onClick={() => generateReceipt(queueData.activeAppointment._id)}
                    className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Generate Receipt
                  </button>
                </div>
                {queueData.activeAppointment.receiptGeneratedAt && (
                  <p className="mt-3 text-xs text-green-700">
                    Receipt generated on {new Date(queueData.activeAppointment.receiptGeneratedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Queued Appointments</h2>
          {queueData.queue.length === 0 ? (
            <p className="mt-3 text-gray-600">No patients are waiting right now.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {queueData.queue.map((appointment, index) => (
                <div
                  key={appointment._id}
                  className="flex flex-wrap items-center justify-between rounded-lg border border-gray-200 p-4"
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {index + 1}. {appointment.user?.firstName} {appointment.user?.lastName || ""}
                    </p>
                    <p className="text-sm text-gray-500">
                      Booked at {new Date(appointment.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startAppointment(appointment._id)}
                    disabled={index !== 0 || Boolean(queueData.activeAppointment)}
                    className="rounded-md bg-blue-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-gray-400"
                  >
                    Start Appointment
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DoctorAppointments;
