import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCareResource } from "../hooks/useCareResource";
import { Banner, Button, Card, LoadingState, StatusBadge } from "../components/ui";
import BookingFlow from "../components/appointments/BookingFlow";
import DoctorSummary from "../components/appointments/DoctorSummary";
import CallPanel from "../components/appointments/CallPanel";
import { doctorName } from "../utils/appointments";
export default function AppointmentBooking() {
  const { doctorId } = useParams(), { user, isAuth, role } = useAuth();
  const doctor = useCareResource("/doctor/" + doctorId), owner = isAuth && role === "user" ? user?._id : null;
  const current = useCareResource(owner ? "/appointment/doctor/" + doctorId + "/pending" : null, owner, 5000), visit = current.data?.myAppointment;
  if (!doctor.data?.user) return <main className="mp-page"><h1>Book an appointment</h1>{doctor.error ? <Banner action={<Button onClick={doctor.refresh}>Retry doctor profile</Button>}>{doctor.error}</Banner> : <LoadingState>Loading the doctor profile...</LoadingState>}</main>;
  if (doctor.data.user.hospitalContext) return doctor.data.user.hospitalContext.hospitalSlug ? <Navigate to={"/hospitals/" + doctor.data.user.hospitalContext.hospitalSlug + "?doctor=" + doctorId} replace /> : <main className="mp-page"><Banner>The hospital booking website is not published for this doctor.</Banner></main>;
  return <main className="mp-page mp-page--patient"><div className="mp-section-heading"><div><p className="mp-eyebrow">Independent online care</p><h1>Book Appointment with Dr. {doctorName(doctor.data.user)}</h1><p>Choose care and patient, review actual availability, then confirm your visit.</p></div><Button to="/doctors" variant="ghost">Back to doctors</Button></div>{current.error && <Banner action={<Button onClick={current.refresh}>Retry visit status</Button>}>{current.error}</Banner>}
    {visit && <Card><div className="mp-card-heading"><h2>Current online visit</h2><StatusBadge status={visit.status} /></div><p>{visit.status === "active" ? "Your doctor is ready for consultation." : "You are in the current care queue. The doctor will call you when ready."}</p>{visit.status === "queued" && <><p>Queue position: {visit.queuePosition > 0 ? "#" + visit.queuePosition : "Not available"}</p><Button to={"/triage/" + visit._id} variant="secondary">Prepare for your visit</Button></>}<Button to="/my-appointments" variant="ghost">All my visits</Button></Card>}
    {visit?.status === "active" && visit.visitMode !== "in_person" && <CallPanel key={visit._id} appointmentId={visit._id} onRefresh={current.refresh} />}
    <div className="mp-booking-layout"><Card><BookingFlow key={doctorId + ":" + (owner || "guest")} doctor={doctor.data.user} /></Card><aside className="mp-stack"><Card><DoctorSummary doctor={doctor.data.user} compact /></Card><Card><h2>Before you book</h2><p>Online consultations need a working microphone. An online OPD window uses a live queue; a scheduled appointment has a reserved slot.</p><p className="mp-field-hint">Times and cancellation rules come from the selected practice. Charges use demo credits.</p></Card></aside></div>
  </main>;
}
