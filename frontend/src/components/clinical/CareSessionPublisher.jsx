/* eslint-disable react/prop-types */
import { useState } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { BACKEND_URL } from "../../utils";
import { Banner, Button, Card, Field } from "../ui";
import { CalendarPlus, Clock, AlertTriangle } from "lucide-react";

export default function CareSessionPublisher({ hospital = false, onPublished }) {
  const auth = useAuth();
  const staff = auth.staffUser;
  const hospitalId = staff?.hospitalId || auth.staffHospital?._id;
  const staffDoctorId = staff?._id || staff?.id;

  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [careContext, setCareContext] = useState(hospital ? "hospital" : "independent");
  const [serviceDate, setServiceDate] = useState(today);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [appointmentType, setAppointmentType] = useState(hospital ? "hospital_in_person" : "scheduled_online");
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async event => {
    event.preventDefault();
    setMessage(null);

    if (!serviceDate) {
      setMessage({ tone: "error", text: "Service date is required." });
      return;
    }
    if (!startTime || !endTime) {
      setMessage({ tone: "error", text: "Start time and end time are required." });
      return;
    }

    const startIso = new Date(`${serviceDate}T${startTime}:00`).toISOString();
    const endIso = new Date(`${serviceDate}T${endTime}:00`).toISOString();

    if (new Date(endIso) <= new Date(startIso)) {
      setMessage({ tone: "error", text: "End time must be after start time." });
      return;
    }

    setBusy(true);
    try {
      if (careContext === "hospital") {
        const departmentId = staff?.departmentIds?.[0] || staff?.departmentId;
        const payload = {
          hospitalId,
          departmentId,
          doctorId: staffDoctorId,
          appointmentType: "hospital_in_person",
          startsAt: startIso,
          endsAt: endIso,
          slotDurationMinutes: Number(slotDurationMinutes),
        };
        await axios.post(`${BACKEND_URL}/api/scheduling/hospital/sessions`, payload, {
          withCredentials: true,
        });
      } else {
        const payload = {
          doctorId: auth.user?._id,
          appointmentType,
          startsAt: startIso,
          endsAt: endIso,
          slotDurationMinutes: Number(slotDurationMinutes),
        };
        await axios.post(`${BACKEND_URL}/api/scheduling/sessions`, payload, {
          withCredentials: true,
        });
      }

      setMessage({
        tone: "positive",
        text: `CareSession published successfully for ${serviceDate} (${startTime} - ${endTime}).`,
      });
      if (typeof onPublished === "function") {
        onPublished();
      }
    } catch (error) {
      const status = error.response?.status;
      const responseMsg = error.response?.data?.message;

      if (status === 409) {
        setMessage({
          tone: "error",
          conflict: true,
          text: responseMsg || "Schedule conflict: Doctor already has an overlapping session during this time window. Independent and hospital sessions must not overlap.",
        });
      } else if (status === 403) {
        setMessage({
          tone: "error",
          text: responseMsg || "Publishing blocked: Doctor credentials must be verified and independent practice published before creating care sessions.",
        });
      } else {
        setMessage({
          tone: "error",
          text: responseMsg || "Failed to publish care session. Please check your schedule and try again.",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mp-care-session-publisher" aria-label="Publish Care Session">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
            <CalendarPlus size={20} aria-hidden="true" />
            Publish Care Session
          </h2>
          <p className="mp-field-hint" style={{ margin: "4px 0 0" }}>
            Create separated, conflict-checked availability slots for independent online or hospital in-person care.
          </p>
        </div>
        <Button
          variant="secondary"
          size="small"
          onClick={() => {
            setOpen(prev => !prev);
            setMessage(null);
          }}
        >
          {open ? "Hide Publisher" : "Open Schedule Publisher"}
        </Button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} style={{ marginTop: "16px", display: "grid", gap: "16px" }}>
          {message && (
            <Banner tone={message.tone === "positive" ? "info" : "error"}>
              {message.conflict && <AlertTriangle size={18} style={{ marginRight: "6px", verticalAlign: "middle" }} />}
              {message.text}
            </Banner>
          )}

          <div className="mp-form-row">
            <Field
              as="select"
              label="Care Context"
              value={careContext}
              disabled={busy}
              onChange={e => {
                const ctx = e.target.value;
                setCareContext(ctx);
                if (ctx === "hospital") {
                  setAppointmentType("hospital_in_person");
                } else {
                  setAppointmentType("scheduled_online");
                }
              }}
            >
              <option value="independent">Independent Practice (Online Consultation)</option>
              {hospital && <option value="hospital">Hospital OPD (In-person Clinical)</option>}
            </Field>

            <Field
              as="select"
              label="Appointment Type"
              value={appointmentType}
              disabled={busy || careContext === "hospital"}
              onChange={e => setAppointmentType(e.target.value)}
            >
              {careContext === "independent" ? (
                <>
                  <option value="scheduled_online">Scheduled Online (Reserved Slots)</option>
                  <option value="online_opd">Online OPD Window (Virtual Queue)</option>
                </>
              ) : (
                <option value="hospital_in_person">Hospital In-Person Consultation</option>
              )}
            </Field>
          </div>

          <div className="mp-form-row">
            <Field
              type="date"
              label="Service Date"
              value={serviceDate}
              min={today}
              disabled={busy}
              required
              onChange={e => setServiceDate(e.target.value)}
            />
            <Field
              as="select"
              label="Slot Duration"
              value={slotDurationMinutes}
              disabled={busy}
              onChange={e => setSlotDurationMinutes(Number(e.target.value))}
            >
              <option value={15}>15 minutes</option>
              <option value={20}>20 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>60 minutes</option>
            </Field>
          </div>

          <div className="mp-form-row">
            <Field
              type="time"
              label="Session Start Time"
              value={startTime}
              disabled={busy}
              required
              onChange={e => setStartTime(e.target.value)}
            />
            <Field
              type="time"
              label="Session End Time"
              value={endTime}
              disabled={busy}
              required
              onChange={e => setEndTime(e.target.value)}
            />
          </div>

          <div className="mp-actions" style={{ justifyContent: "flex-end" }}>
            <Button type="submit" disabled={busy}>
              <Clock size={16} aria-hidden="true" style={{ marginRight: "6px" }} />
              {busy ? "Publishing Schedule..." : "Publish Session Slots"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
