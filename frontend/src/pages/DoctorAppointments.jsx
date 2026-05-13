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
            <div className="mt-4">
              <AppointmentVideoCall appointmentId={queueData.activeAppointment._id} />
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
