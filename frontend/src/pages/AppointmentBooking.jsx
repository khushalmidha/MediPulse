import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Link, useNavigate, useParams } from "react-router-dom";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { BACKEND_URL } from "../utils";
import { useAuth } from "../context/AuthContext";
import AppointmentVideoCall from "../components/AppointmentVideoCall";

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
  const [approvalPopup, setApprovalPopup] = useState(false);
  const previousAppointmentStatusRef = useRef(null);

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

    Promise.all([fetchStatus(), fetchHistory()])
      .catch(() => setMessage("Could not load appointment details for this doctor"))
      .finally(() => setLoading(false));
  }, [doctorId, isAuth, loader, navigate, role]);

  useEffect(() => {
    const nextStatus = status?.myAppointment?.status || null;
    const previousStatus = previousAppointmentStatusRef.current;

    if (previousStatus === "queued" && nextStatus === "active") {
      setApprovalPopup(true);
      setMessage("Your appointment has been approved and is now active.");
      fetchHistory().catch(() => {});
    }

    if (previousStatus === "active" && nextStatus === null) {
      setApprovalPopup(false);
      fetchHistory().catch(() => {});
    }

    previousAppointmentStatusRef.current = nextStatus;
  }, [status?.myAppointment?.status]);

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
      await Promise.all([fetchStatus(), fetchHistory()]);
    } catch (error) {
      setMessage(
        error.response?.data?.message || "Unable to book appointment. Please try again",
      );
      await fetchStatus();
    }
    setBooking(false);
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

    const qrPayload = JSON.stringify({
      source: "MediPulse",
      website: window.location.origin,
      appointmentId: appointment._id,
      doctor: doctorName,
      patient: patientName,
      generatedAt: new Date().toISOString(),
    });

    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 170,
      color: {
        dark: "#143e84",
        light: "#ffffff",
      },
    });

    const qrX = width - 185;
    const qrY = 112;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(qrX - 10, qrY - 12, 150, 170, 10, 10, "F");
    doc.setDrawColor(210, 220, 236);
    doc.roundedRect(qrX - 10, qrY - 12, 150, 170, 10, 10, "S");
    doc.addImage(qrDataUrl, "PNG", qrX, qrY, 130, 130);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(27, 52, 97);
    doc.text("Scan to verify", qrX + 65, qrY + 146, { align: "center" });

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

        {approvalPopup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <h2 className="text-xl font-bold text-gray-900">Appointment Approved</h2>
              <p className="mt-2 text-sm text-gray-600">
                The doctor has started your booking. Join the active appointment now.
              </p>
              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setApprovalPopup(false)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => setApprovalPopup(false)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
                >
                  View Call
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Not Started Bookings</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Bookings that are still waiting for the doctor to start them.
                </p>
              </div>
            </div>

            {!myAppointment ? (
              <p className="mt-4 text-sm text-gray-500">No pending bookings yet.</p>
            ) : myAppointment.status === "queued" ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="font-medium text-amber-900">Waiting for approval</p>
                <p className="text-sm text-amber-800">
                  Booked on {new Date(status?.myAppointment?.createdAt || Date.now()).toLocaleString()}
                </p>
                <p className="mt-2 text-sm text-amber-700">
                  Position in queue: {myAppointment.queuePosition}
                </p>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="font-medium text-blue-900">Approved and active</p>
                <p className="text-sm text-blue-800">
                  Started at {myAppointment.startedAt ? new Date(myAppointment.startedAt).toLocaleString() : "Just now"}
                </p>
                <p className="mt-2 text-sm text-blue-700">Join the call from the active appointment section above.</p>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Previous Bookings</h2>
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
                  <div key={appointment._id} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-gray-900">
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
                          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        >
                          Download Receipt
                        </button>
                      )}
                    </div>

                    {appointment.receiptText ? (
                      <div className="mt-4 rounded-md bg-gray-50 p-4 text-sm text-gray-700 whitespace-pre-wrap">
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
