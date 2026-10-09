/* eslint-disable react/prop-types */
import { Building2, GraduationCap, MapPin, Stethoscope, UserRound } from "lucide-react";
import { doctorName } from "../../utils/appointments";
export default function DoctorSummary({ doctor, compact = false }) {
  const profile = doctor?.doctorProfile || doctor?.experience || {};
  return <div className={"mp-doctor-summary " + (compact ? "mp-doctor-summary--compact" : "")}><span className="mp-doctor-avatar">{doctor?.profilePhoto ? <img src={doctor.profilePhoto} alt="" /> : <UserRound size={32} aria-hidden="true" />}</span><div><p className="mp-eyebrow">{doctor?.hospitalId || doctor?.hospitalContext ? "Hospital doctor" : "Independent care"}</p><h2>Dr. {doctorName(doctor)}</h2><p><Stethoscope size={15} aria-hidden="true" />{profile.expertise || profile.specialization || doctor?.specialization || "Specialty not recorded"}</p>{profile.qualification && <p><GraduationCap size={15} aria-hidden="true" />{profile.qualification}</p>}{doctor?.clinic?.name && <p><Building2 size={15} aria-hidden="true" />{doctor.clinic.name}</p>}{doctor?.clinic?.location && <p><MapPin size={15} aria-hidden="true" />{doctor.clinic.location}</p>}<span className="mp-field-hint">{["verified", "approved"].includes(doctor?.verificationStatus) ? "Professional verification recorded" : "Professional verification not recorded"}</span></div></div>;
}
