/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import { Building2, Eye, EyeOff, Heart, Stethoscope, UserRound } from "lucide-react";
import { Banner, Button, Card, Field } from "../ui";

export function Feedback({ feedback }) {
  const ref = useRef(null);
  useEffect(() => { if (feedback?.message) ref.current?.focus(); }, [feedback]);
  return feedback ? <div ref={ref} tabIndex={-1}><Banner tone={feedback.tone || "error"}>{feedback.message}</Banner></div> : null;
}
export function AccountPage({ title, eyebrow = "Your MediPulse account", description, children, wide = false }) {
  return <main className={"mp-page mp-account-page " + (wide ? "mp-account-page--wide" : "")}><header className="mp-account-heading"><span className="mp-account-mark"><Heart aria-hidden="true" size={26} /></span><p className="mp-eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p>{description}</p>}</header>{children}</main>;
}
export function ProfileChoice({ signup = false, onChoose }) {
  return <div className="mp-account-choices" aria-label="Choose your profile type">{[["user", "User", UserRound, "Appointments, family care and communities"], ["doctor", "Doctor", Stethoscope, "Independent practice and patient care"], ["hospital-admin", "Hospital Staff", Building2, signup ? "Register your hospital workspace" : "Your hospital team workspace"]].map(([value, label, Icon, description]) => <Card key={value}><Icon aria-hidden="true" size={27} /><h2>{label === "User" ? "Patient" : label}</h2><p>{description}</p><Button variant="secondary" onClick={() => onChoose(value)}>{signup ? "Join as " : "Sign in as "}{label}</Button></Card>)}</div>;
}
export function PasswordField({ label = "Password", disabled, ...props }) {
  const [show, setShow] = useState(false);
  return <div className="mp-password-field"><Field {...props} disabled={disabled} type={show ? "text" : "password"} label={label} /><Button disabled={disabled} variant="ghost" aria-label={(show ? "Hide " : "Show ") + label.toLowerCase()} aria-pressed={show} onClick={() => setShow(value => !value)}>{show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</Button></div>;
}
export function GenderField(props) { return <Field as="select" label="Gender" required {...props}><option value="">Select gender</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other / prefer not to say</option></Field>; }
