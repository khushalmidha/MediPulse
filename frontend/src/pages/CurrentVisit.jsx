import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCareResource } from "../hooks/useCareResource";
import { Banner, Button, Card, EmptyState, LoadingState, StatusBadge } from "../components/ui";
import { PatientAccess } from "../components/patient/PatientUI";
import CallPanel from "../components/appointments/CallPanel";
import { formatDoctorName } from "../utils/appointments";

export default function CurrentVisit() { return <PatientAccess><Visit /></PatientAccess>; }
function Visit() {
  const { appointmentId } = useParams(), { user } = useAuth();
  const valid = /^[a-f\d]{24}$/i.test(appointmentId || "");
  const resource = useCareResource(valid ? "/appointment/" + appointmentId : null, user?._id, 5000), visit = resource.data;
  if (!valid) return <main className="mp-page"><EmptyState title="A valid visit link is needed" action={<Button to="/my-appointments">My appointments</Button>} /></main>;
  if (!visit || visit._id !== appointmentId) return <main className="mp-page"><h1>Your current visit</h1>{resource.error
    ? <Banner action={<Button onClick={resource.refresh}>Retry visit</Button>}>{resource.error}</Banner>
    : resource.loading ? <LoadingState>Loading your visit...</LoadingState> : <EmptyState title="Visit not available" />}</main>;
  if (visit.scheduleReservationId) return <Navigate to={"/appointments/reservations/" + visit.scheduleReservationId} replace />;
  return <main className="mp-page mp-page--patient">
    <div className="mp-section-heading"><div><p className="mp-eyebrow">Your consultation</p><h1>Your current visit</h1><p>{formatDoctorName(visit.doctor)}</p></div><div className="mp-actions"><Button to="/my-appointments" variant="secondary">All my visits</Button><Button onClick={resource.refresh} disabled={resource.refreshing}>Refresh visit</Button></div></div>
    {resource.error && <Banner action={<Button onClick={resource.refresh}>Retry visit</Button>}>{resource.error} Last confirmed visit information is shown.</Banner>}
    <Card><StatusBadge status={visit.status} /><p>{visit.visitMode === "in_person" ? "This is an in-person visit. Follow your hospital's arrival instructions."
      : visit.status === "active" ? "Your doctor is ready for your online consultation."
      : visit.status === "queued" ? "You are in the care queue. Your consultation will appear here when your doctor starts the visit."
      : "This visit is no longer waiting for an online consultation. Check My appointments for its recorded status."}</p></Card>
    {visit.status === "active" && visit.visitMode === "online" && <CallPanel key={appointmentId} appointmentId={appointmentId} onRefresh={resource.refresh} />}
  </main>;
}
