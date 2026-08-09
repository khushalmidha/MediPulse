import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Link, useNavigate, useParams } from "react-router-dom";
import jsPDF from "jspdf";
import { BACKEND_URL } from "../utils";
import { useAuth } from "../context/AuthContext";
import AppointmentVideoCall from "../components/AppointmentVideoCall";
import TriageChat from "../components/TriageChat";
import { getSocket } from "../socket";

const APPOINTMENT_FEE_INR = Number(import.meta.env.VITE_APPOINTMENT_BOOKING_FEE_INR || 5);

const AppointmentBooking = () => {
  const { doctorId } = useParams();
  const navigate = useNavigate();
  const { isAuth, loader, role, user } = useAuth();
  const [doctor, setDoctor] = useState(null);
  const [status, setStatus] = useState(null);
  const [booking, setBooking] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [appointmentHistory, setAppointmentHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [callStartedPopup, setCallStartedPopup] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const previousAppointmentStatusRef = useRef(null);

  const fetchStatus = async () => {
    try {
      const doctorResponse = await axios.get(`${BACKEND_URL}/doctor/${doctorId}`, { withCredentials: true }).catch(() => null);
      if (doctorResponse?.data?.user) {
        setDoctor(doctorResponse.data.user);
      }
      
      const statusResponse = await axios.get(`${BACKEND_URL}/appointment/doctor/${doctorId}/pending`, {
        withCredentials: true,
      }).catch(() => null);
      if (statusResponse?.data) {
        setStatus(statusResponse.data);
      }
    } catch (error) {
      console.error("Failed to load status:", error);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await axios.get(`${BACKEND_URL}/appointment/history`, {
        withCredentials: true,
        params: { doctorId },
      });
      setAppointmentHistory(response.data.appointments || []);
    } finally {
      setHistoryLoading(false);
    }
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
    if (role === "user" && user && !user.triageProfile?.agentSummary) {
      navigate("/opd/triage");
      return;
    }

    Promise.all([fetchStatus(), fetchHistory()])
      .finally(() => setLoading(false));
  }, [doctorId, isAuth, loader, navigate, role]);

  useEffect(() => {
    const nextStatus = status?.myAppointment?.status || null;
    const previousStatus = previousAppointmentStatusRef.current;

    if (previousStatus === "queued" && nextStatus === "active") {
      setCallStartedPopup(true);
      setMessage("Your doctor has started the appointment.");
      fetchHistory().catch(() => {});
    }

    if (previousStatus === "active" && nextStatus === null) {
      setCallStartedPopup(false);
      fetchHistory().catch(() => {});
    }

    previousAppointmentStatusRef.current = nextStatus;
  }, [status?.myAppointment?.status]);

  useEffect(() => {
    if (!isAuth || role !== "user") return;
    const socket = getSocket();
    if (!socket.connected) {
      socket.connect();
    }

    const handleUserStatus = (payload) => {
      if (payload.doctorId !== doctorId) return;
      setStatus((current) => ({
        ...(current || {}),
        pendingCount: payload.pendingCount,
        myAppointment: {
          ...(current?.myAppointment || {}),
          _id: payload.appointmentId,
          status: payload.status,
          queuePosition: payload.queuePosition,
          startedAt: payload.startedAt,
          endsAt: payload.endsAt,
        },
      }));
    };

    const handleEnded = ({ appointmentId }) => {
      setStatus((current) => {
        if (current?.myAppointment?._id !== appointmentId) return current;
        return { ...(current || {}), myAppointment: null };
      });
      fetchHistory().catch(() => {});
    };

    socket.on("appointment:user-status", handleUserStatus);
    socket.on("appointment:ended", handleEnded);

    const interval = setInterval(() => {
      fetchStatus().catch(() => {});
    }, 5000);
    return () => {
      clearInterval(interval);
      socket.off("appointment:user-status", handleUserStatus);
      socket.off("appointment:ended", handleEnded);
    };
  }, [doctorId, isAuth, role]);

  const handleBookDirectly = async () => {
    setBooking(true);
    setMessage("");
    try {
      const response = await axios.post(
        `${BACKEND_URL}/appointment/book/${doctorId}`,
        {},
        { withCredentials: true },
      );

      setMessage(response.data.message);
      await Promise.all([fetchStatus(), fetchHistory()]);
    } catch (error) {
      setMessage(
        error.response?.data?.message ||
          error.message ||
          "Unable to complete booking. Please try again",
      );
    } finally {
      setBooking(false);
    }
  };

  const loadImageAsDataUrl = async (path) => {
    const response = await fetch(path);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const drawHeader = (doc, width) => {
    doc.setFillColor(18, 62, 132);
    doc.rect(0, 0, width, 82, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.setTextColor(255, 255, 255);
    doc.text("MediPulse", 96, 40);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("Healthcare Appointment Receipt", 96, 60);
  };

  const downloadReceipt = async (appointment) => {
    if (!appointment.receiptText) return;

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();

    drawHeader(doc, width);

    try {
      const logoData = await loadImageAsDataUrl("/heart.svg");
      doc.addImage(logoData, "SVG", 42, 18, 34, 34);
    } catch {
      doc.setFillColor(255, 255, 255);
      doc.circle(60, 35, 14, "F");
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(62);
    doc.setTextColor(233, 238, 246);
    doc.text("MEDIPULSE", width / 2, height / 2 + 20, { align: "center", angle: 35 });

    const doctorName = `Dr. ${doctor?.firstName || ""} ${doctor?.lastName || ""}`.trim();
    const patientName = `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "MediPulse User";

    doc.setTextColor(26, 34, 54);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Receipt Metadata", 42, 112);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(79, 89, 109);
    doc.text(`Website: ${window.location.origin}`, 42, 132);
    doc.text(`Doctor: ${doctorName}`, 42, 148);
    doc.text(`Patient: ${patientName}`, 42, 164);
    doc.text(`Appointment ID: ${appointment._id}`, 42, 180);
    doc.text(`Booked At: ${new Date(appointment.createdAt).toLocaleString()}`, 42, 196);
    if (appointment.startedAt) {
      doc.text(`Started At: ${new Date(appointment.startedAt).toLocaleString()}`, 42, 212);
    }
    if (appointment.endedAt) {
      doc.text(`Ended At: ${new Date(appointment.endedAt).toLocaleString()}`, 42, 228);
    }

    doc.setDrawColor(204, 214, 230);
    doc.line(42, 250, width - 42, 250);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(25, 33, 52);
    doc.text("Consultation Summary", 42, 276);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(70, 78, 95);
    const lines = doc.splitTextToSize(appointment.receiptText, width - 84);
    let cursorY = 298;

    lines.forEach((line) => {
      if (cursorY > height - 120) {
        doc.addPage();
        drawHeader(doc, width);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.setTextColor(70, 78, 95);
        cursorY = 112;
      }
      doc.text(line, 42, cursorY);
      cursorY += 16;
    });

    const footerY = height - 78;
    doc.setDrawColor(214, 224, 240);
    doc.line(42, footerY, width - 42, footerY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(90, 100, 120);
    doc.text("Doctor Signature", 42, footerY + 26);
    doc.line(130, footerY + 18, 290, footerY + 18);

    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("This document was generated digitally by MediPulse.", width - 42, footerY + 26, {
      align: "right",
    });

    doc.save(`medipulse-receipt-${appointment._id}.pdf`);
  };

  const previousAppointments = appointmentHistory.filter((appointment) =>
    ["completed", "cancelled"].includes(appointment.status),
  );

  if (loading) {
    return <div className="min-h-screen bg-gray-50 dark:bg-slate-900 px-4 py-8">Loading appointment data...</div>;
  }

  const myAppointment = status?.myAppointment;
  const canBook = !myAppointment;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-8">
          <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Book Appointment with {(doctor?.fullName || doctor?.firstName)?.startsWith("Dr.") ? "" : "Dr. "}{doctor?.fullName || `${doctor?.firstName || ""} ${doctor?.lastName || ""}`.trim() || "Doctor"}
            </h1>
            
            {doctor?.sourceType === "hospital" ? (
              <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="font-medium text-amber-900 mb-2">In-Person Appointments Only</p>
                <p className="text-sm text-amber-800 mb-4">
                  This doctor is affiliated with a hospital and only accepts in-person OPD token bookings. Video consultations are not available.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`/hospital/${doctor.hospitalContext?.hospitalSlug}/book-opd`, { state: { preSelectedDoctorId: doctor._id } })}
                  className="rounded-md bg-amber-600 px-4 py-2 text-white hover:bg-amber-700"
                >
                  Book OPD Token Now
                </button>
              </div>
            ) : (
              <>
                <p className="mt-2 text-gray-600">
                  Current pending queue: <span className="font-semibold">{status?.pendingCount ?? 0}</span>
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleBookDirectly}
                    disabled={!canBook || booking}
                    className="rounded-md bg-red-600 dark:bg-red-700 px-6 py-2.5 font-medium text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                  >
                    {booking ? "Processing..." : `Confirm Booking for ₹${APPOINTMENT_FEE_INR}`}
                  </button>
                  <Link to="/doctors" className="rounded-md border border-gray-300 dark:border-red-900/40 bg-white dark:bg-slate-900 px-6 py-2.5 font-medium text-gray-700 dark:text-slate-200 shadow-sm hover:bg-gray-50">
                    Back to doctors
                  </Link>
                </div>

                {message && <p className="mt-4 text-sm font-medium text-red-600">{message}</p>}
              </>
            )}
          </div>

        {callStartedPopup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-950 p-6 shadow-xl">
              <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Doctor Started the Appointment</h2>
              <p className="mt-2 text-sm text-gray-600">
                The doctor has started your booking. Join the active appointment now.
              </p>
              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                onClick={() => setCallStartedPopup(false)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:bg-slate-900"
                >
                  Close
                </button>
                <button
                  type="button"
                onClick={() => setCallStartedPopup(false)}
                  className="rounded-md bg-red-600 dark:bg-red-700 px-4 py-2 text-sm text-white hover:bg-blue-700"
                >
                  View Call
                </button>
              </div>
            </div>
          </div>
        )}

        {triageOpen && myAppointment?._id && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-2xl">
              <div className="mb-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setTriageOpen(false)}
                  className="rounded-full bg-white dark:bg-slate-950 px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:bg-slate-900"
                >
                  Close
                </button>
              </div>
              <TriageChat
                appointmentId={myAppointment._id}
                onCompleted={async () => {
                  await Promise.all([fetchStatus(), fetchHistory()]);
                  setTriageOpen(false);
                }}
              />
            </div>
          </div>
        )}

        {myAppointment?.status === "active" && (
          <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Active Appointment</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Your doctor has started the consultation. The session auto-ends after 5 minutes.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <AppointmentVideoCall appointmentId={myAppointment._id} />
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Not Started Bookings</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Bookings that are still waiting for the doctor to start them.
                </p>
              </div>
            </div>

            {!myAppointment ? (
              <p className="mt-4 text-sm text-gray-500">No pending bookings yet.</p>
            ) : myAppointment.status === "queued" ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="font-medium text-amber-900">
                  Waiting for doctor to start
                </p>
                <p className="text-sm text-amber-800">
                  Booked on {new Date(status?.myAppointment?.createdAt || Date.now()).toLocaleString()}
                </p>
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-amber-700">
                    Position in queue: {myAppointment.queuePosition}
                  </p>
                  {myAppointment.patientBrief ? (
                    <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-800">
                      Health summary submitted ✓
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setTriageOpen(true)}
                      className="rounded-md bg-red-600 dark:bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Prepare for Appointment →
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="font-medium text-blue-900">Appointment active</p>
                <p className="text-sm text-blue-800">
                  Started at {myAppointment.startedAt ? new Date(myAppointment.startedAt).toLocaleString() : "Just now"}
                </p>
                <p className="mt-2 text-sm text-blue-700">Join the call from the active appointment section above.</p>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Previous Bookings</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Completed appointments and doctor-generated receipts.
                </p>
              </div>
            </div>

            {historyLoading ? (
              <p className="mt-4 text-sm text-gray-500">Loading previous bookings...</p>
            ) : previousAppointments.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">No previous bookings found for this doctor.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {previousAppointments.map((appointment) => (
                  <div key={appointment._id} className="rounded-lg border border-gray-200 dark:border-red-900/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-slate-100">
                          Dr. {doctor?.firstName} {doctor?.lastName || ""}
                        </p>
                        <p className="text-sm text-gray-500">
                          Status: {appointment.status} | Booked on {new Date(appointment.createdAt).toLocaleString()}
                        </p>
                        {appointment.startedAt && (
                          <p className="text-sm text-gray-500">
                            Visit time: {new Date(appointment.startedAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                      {appointment.receiptText && (
                        <button
                          type="button"
                          onClick={() => downloadReceipt(appointment)}
                          className="rounded-md bg-red-600 dark:bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        >
                          Download Receipt
                        </button>
                      )}
                    </div>

                    {appointment.receiptText ? (
                      <div className="mt-4 rounded-md bg-gray-50 dark:bg-slate-900 p-4 text-sm text-gray-700 whitespace-pre-wrap">
                        {appointment.receiptText}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-gray-500">
                        Receipt not generated yet. Ask the doctor to save notes and generate it.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppointmentBooking;
