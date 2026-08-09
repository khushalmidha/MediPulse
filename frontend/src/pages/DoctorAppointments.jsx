/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { BACKEND_URL } from "../utils";
import { useAuth } from "../context/AuthContext";
import AppointmentVideoCall from "../components/AppointmentVideoCall";
import { getSocket } from "../socket";

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
  const [voiceConsent, setVoiceConsent] = useState(null);

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
    const socket = getSocket();
    if (!socket.connected) {
      socket.connect();
    }

    const handleQueueUpdated = (payload) => {
      setQueueData(payload);
    };

    const handleAppointmentEnded = () => {
      fetchQueue().catch(() => {});
    };

    const handleBriefReady = () => {
      fetchQueue().catch(() => {});
    };

    socket.on("appointment:queue-updated", handleQueueUpdated);
    socket.on("appointment:ended", handleAppointmentEnded);
    socket.on("appointment:brief-ready", handleBriefReady);

    const interval = setInterval(() => {
      fetchQueue().catch(() => {});
    }, 4000);
    return () => {
      clearInterval(interval);
      socket.off("appointment:queue-updated", handleQueueUpdated);
      socket.off("appointment:ended", handleAppointmentEnded);
      socket.off("appointment:brief-ready", handleBriefReady);
    };
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
      setActionMessage(`${response.data.message}. SOAP note automatically generated.`);
      await fetchQueue();
    } catch (error) {
      setActionMessage(error.response?.data?.message || "Could not end appointment");
    }
  };

  const refundAppointment = async (appointmentId) => {
    setActionMessage("");
    try {
      const response = await axios.post(
        `${BACKEND_URL}/appointment/${appointmentId}/refund`,
        { reason: "doctor-requested-refund" },
        { withCredentials: true },
      );
      setActionMessage(response.data.message);
      await fetchQueue();
    } catch (error) {
      setActionMessage(error.response?.data?.message || "Could not process refund");
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
        { 
          doctorNotes,
          voiceConsentRecorded: voiceConsent?.detected || false,
          voiceConsentKeywords: voiceConsent?.keywords || [],
          voiceConsentTimestamp: voiceConsent?.timestamp || null,
        },
        { withCredentials: true },
      );
      setDoctorNotes(response.data.doctorNotes || "");
      setActionMessage(response.data.message);
      await fetchQueue();
    } catch (error) {
      setActionMessage(error.response?.data?.message || "Could not generate receipt");
    }
  };

  const handleVoiceConsentDetected = (consentData) => {
    setVoiceConsent(consentData);
    setActionMessage("✓ Voice consent detected successfully!");
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 dark:bg-slate-900 px-4 py-8">Loading appointment queue...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Doctor Appointment Queue</h1>
          <p className="mt-2 text-gray-600">
            Pending appointments: <span className="font-semibold">{queueData.pendingCount}</span>
          </p>
          {actionMessage && <p className="mt-3 text-sm text-blue-700">{actionMessage}</p>}
        </div>

        {queueData.activeAppointment && (
          <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Active Appointment</h2>
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
            <PatientBriefCard brief={queueData.activeAppointment.user?.triageProfile} />
            <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
              <div>
                <AppointmentVideoCall
                  appointmentId={queueData.activeAppointment._id}
                  doctorNotes={doctorNotes}
                  onConsentDetected={handleVoiceConsentDetected}
                  onSoapSaved={() => setActionMessage("SOAP note saved successfully")}
                />
                {voiceConsent?.detected && (
                  <p className="mt-2 text-sm text-green-700">
                    Voice consent recorded for this appointment.
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-red-900/40 bg-gray-50 dark:bg-slate-900 p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Doctor Notes</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Add short clinical notes for the receipt before ending the appointment.
                </p>
                <textarea
                  value={doctorNotes}
                  onChange={(event) => setDoctorNotes(event.target.value)}
                  placeholder="Symptoms, advice, follow-up, medicines, warnings..."
                  className="mt-3 min-h-40 w-full rounded-md border border-gray-300 bg-white dark:bg-slate-950 p-3 text-sm outline-none focus:border-red-500"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => saveDoctorNotes(queueData.activeAppointment._id)}
                    className="rounded-md border border-red-600 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-red-50"
                  >
                    Save Notes
                  </button>
                  <button
                    type="button"
                    onClick={() => generateReceipt(queueData.activeAppointment._id)}
                    className="rounded-md bg-red-600 dark:bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
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

        <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Queued Appointments</h2>
          {queueData.queue.length === 0 ? (
            <p className="mt-3 text-gray-600">No patients are waiting right now.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {queueData.queue.map((appointment, index) => (
                <div
                  key={appointment._id}
                  className="flex flex-wrap items-center justify-between rounded-lg border border-gray-200 dark:border-red-900/40 p-4"
                >
                  <div>
                    <p className="font-medium text-gray-900 dark:text-slate-100">
                      {index + 1}. {appointment.user?.firstName} {appointment.user?.lastName || ""}
                    </p>
                    <p className="text-sm text-gray-500">
                      Booked at {new Date(appointment.createdAt).toLocaleTimeString()}
                    </p>
                    {appointment.user?.triageProfile ? (
                      <p className="mt-1 text-sm font-medium text-green-700">
                        AI patient brief ready
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-gray-500">
                        AI brief not submitted yet
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => refundAppointment(appointment._id)}
                      className="rounded-md border border-red-300 px-4 py-2 text-red-700 hover:bg-red-50"
                    >
                      Refund
                    </button>
                    <button
                      type="button"
                      onClick={() => startAppointment(appointment._id)}
                      disabled={index !== 0 || Boolean(queueData.activeAppointment)}
                      className="rounded-md bg-red-600 dark:bg-red-700 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                      Start Appointment
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const urgencyStyles = {
  ROUTINE: {
    label: "🟢 ROUTINE",
    className: "bg-green-50 text-green-800 border-green-200",
  },
  URGENT: {
    label: "🟡 URGENT",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
  EMERGENCY: {
    label: "🔴 EMERGENCY",
    className: "bg-red-50 text-red-800 border-red-200",
  },
};

const PatientBriefCard = ({ brief }) => {
  if (!brief) {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 dark:border-red-900/40 bg-gray-50 dark:bg-slate-900 p-4 text-sm text-gray-600">
        AI Patient Brief has not been submitted for this appointment yet.
      </div>
    );
  }

  const urgency = urgencyStyles[brief.urgencyLevel] || urgencyStyles.ROUTINE;

  return (
    <div className="mt-4 rounded-xl border border-blue-100 bg-red-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-bold text-blue-950">🤖 AI Patient Brief</h3>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${urgency.className}`}>
          {urgency.label}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-gray-900 dark:text-slate-100">Chief Complaint</dt>
          <dd className="mt-1 text-gray-700">{brief.chiefComplaint || "Not provided"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-gray-900 dark:text-slate-100">Duration</dt>
          <dd className="mt-1 text-gray-700">{brief.symptomDuration || "Not provided"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-gray-900 dark:text-slate-100">Severity</dt>
          <dd className="mt-1 text-gray-700">{brief.severity || "Not provided"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-gray-900 dark:text-slate-100">Relevant History</dt>
          <dd className="mt-1 text-gray-700">{brief.relevantHistory || "Not provided"}</dd>
        </div>
      </dl>
      <div className="mt-4 rounded-lg bg-white/80 dark:bg-slate-950/80 p-3 text-sm text-gray-800 dark:text-slate-200">
        <span className="font-semibold text-gray-950">Summary: </span>
        {brief.agentSummary || "Not provided"}
      </div>
      {brief.predictedDisease && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-indigo-200 bg-red-50 p-3">
          <span className="text-xl">🩺</span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-900">
              ML Disease Prediction
            </p>
            <p className="mt-0.5 text-sm font-semibold text-indigo-800">
              {brief.predictedDisease}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default DoctorAppointments;
