import { useEffect, useState } from "react";
import axios from "axios";
import { GraduationCap, Stethoscope } from "lucide-react";
import { BACKEND_URL } from "../utils";
import { formatDoctorName } from "../utils/appointments";
import { Banner, Button, Card, EmptyState, LoadingState } from "./ui";

export default function RecommendationDoctors() {
  const [state, setState] = useState({ loading: true, doctors: [], error: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, doctors: [], error: "" });
    axios.get(`${BACKEND_URL}/doctor`, { withCredentials: true, signal: controller.signal }).then(({ data }) => {
      const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      if (!controller.signal.aborted) setState({ loading: false, doctors: items.slice(0, 6), error: "" });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ loading: false, doctors: [], error: "Doctor profiles are unavailable. Please try again." });
    });
    return () => controller.abort();
  }, [attempt]);
  if (state.loading) return <LoadingState>Loading doctor profiles...</LoadingState>;
  if (state.error) return <Banner action={<Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>Retry doctors</Button>}>{state.error}</Banner>;
  if (!state.doctors.length) return <Card><EmptyState title="No doctor profiles returned" action={<Button to="/doctors">Browse the directory</Button>} /></Card>;
  return <div className="mp-doctor-grid">{state.doctors.map(doctor => <Card key={doctor._id} className="mp-dashboard-doctor">
    <div className="mp-doctor-summary mp-doctor-summary--compact"><span className="mp-doctor-avatar"><Stethoscope aria-hidden="true" size={24} /></span><div><h3>{formatDoctorName(doctor)}</h3><p>{doctor.experience?.expertise || doctor.doctorProfile?.specialization || "Specialty not recorded"}</p></div></div>
    <div className="mp-stack">{Number.isFinite(doctor.experience?.years) && <p className="mp-field-hint">{doctor.experience.years} years of recorded experience</p>}{doctor.experience?.qualification && <p className="mp-dashboard-detail"><GraduationCap size={16} aria-hidden="true" />{doctor.experience.qualification}</p>}{doctor.clinic?.name && <p className="mp-field-hint">{doctor.clinic.name}</p>}</div>
    <Button to={doctor.sourceType === "hospital" && doctor.hospitalContext?.hospitalSlug ? `/hospitals/${doctor.hospitalContext.hospitalSlug}` : `/doctorsProfile/${doctor._id}`} variant="secondary">{doctor.sourceType === "hospital" ? "View hospital care" : "View doctor profile"}</Button>
  </Card>)}</div>;
}
