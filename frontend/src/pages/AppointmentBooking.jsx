import { useEffect, useState } from "react";
import axios from "axios";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BACKEND_URL } from "../utils";
import { useAuth } from "../context/AuthContext";
import AppointmentVideoCall from "../components/AppointmentVideoCall";

const AppointmentBooking = () => {
  const { doctorId } = useParams();
  const navigate = useNavigate();
  const { isAuth, loader, role } = useAuth();
  const [doctor, setDoctor] = useState(null);
  const [status, setStatus] = useState(null);
  const [booking, setBooking] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    const [doctorResponse, statusResponse] = await Promise.all([
      axios.get(`${BACKEND_URL}/doctor/${doctorId}`, { withCredentials: true }),
      axios.get(`${BACKEND_URL}/appointment/doctor/${doctorId}/pending`, {
        withCredentials: true,
      }),
    ]);
    setDoctor(doctorResponse.data.user);
    setStatus(statusResponse.data);
  };

  useEffect(() => {
    if (loader) return;
    if (!isAuth) {
      navigate("/login");
      return;
    }
    if (role !== "user") {
      navigate("/doctor/appointments");
      return;
    }

    fetchStatus()
      .catch(() => setMessage("Could not load appointment details for this doctor"))
      .finally(() => setLoading(false));
  }, [doctorId, isAuth, loader, navigate, role]);

  useEffect(() => {
    if (!isAuth || role !== "user") return;
    const interval = setInterval(() => {
      fetchStatus().catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [doctorId, isAuth, role]);

  const handleBook = async () => {
    setBooking(true);
    setMessage("");
    try {
      const response = await axios.post(
        `${BACKEND_URL}/appointment/book/${doctorId}`,
        {},
        { withCredentials: true },
      );
      setMessage(response.data.message);
      await fetchStatus();
    } catch (error) {
      setMessage(
        error.response?.data?.message || "Unable to book appointment. Please try again",
      );
      await fetchStatus();
    }
    setBooking(false);
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 px-4 py-8">Loading appointment data...</div>;
  }

  const myAppointment = status?.myAppointment;
  const canBook = !myAppointment;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">
            Book Appointment with Dr. {doctor?.firstName} {doctor?.lastName || ""}
          </h1>
          <p className="mt-2 text-gray-600">
            Current pending queue: <span className="font-semibold">{status?.pendingCount ?? 0}</span>
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleBook}
              disabled={!canBook || booking}
              className="rounded-md bg-blue-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {booking ? "Booking..." : "Book Appointment"}
            </button>
            <Link to="/doctors" className="rounded-md border border-gray-300 px-4 py-2 text-gray-700">
              Back to doctors
            </Link>
          </div>

          {message && <p className="mt-3 text-sm text-blue-700">{message}</p>}
        </div>

        {myAppointment?.status === "queued" && (
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Your queue status</h2>
            <p className="mt-2 text-gray-700">
              Position in queue: <span className="font-semibold">{myAppointment.queuePosition}</span>
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Please stay on this page. The doctor will start appointments one by one.
            </p>
          </div>
        )}

        {myAppointment?.status === "active" && (
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Appointment in progress</h2>
            <p className="mt-2 text-sm text-gray-600">
              The call auto-ends in 5 minutes, or earlier if the doctor ends it.
            </p>
            <div className="mt-4">
              <AppointmentVideoCall appointmentId={myAppointment._id} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AppointmentBooking;
