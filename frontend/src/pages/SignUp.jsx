/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import useFormTask from "../hooks/useFormTask";
import { Banner, Button, Card, Field } from "../components/ui";
import { AccountPage, Feedback, GenderField, PasswordField, ProfileChoice } from "../components/account/AccountUI";
import GoogleButton from "../components/account/GoogleButton";
import { safeReturnPath } from "../utils/appointments";
import { signupPayload } from "../utils/accountForms";
import { BACKEND_URL } from "../utils";
const empty = { firstName: "", lastName: "", email: "", password: "", gender: "", phone: "", bio: "", primaryCondition: "", emergencyContact: "", emergencyRelation: "", emergencyPhone: "", years: "", expertise: "", clinicName: "", clinicLocation: "", clinicPhone: "" };
export default function SignUp({ initialType, lockProfile = false }) {
  const params = useParams(), location = useLocation(), navigate = useNavigate(), auth = useAuth();
  const initial = initialType || params.type || "select", [type, setType] = useState(["user", "doctor", "select"].includes(initial) ? initial : "select");
  const [form, setForm] = useState(empty), task = useFormTask(), returnTo = safeReturnPath(new URLSearchParams(location.search).get("returnTo"));
  useEffect(() => { if (auth.isAuth) navigate(returnTo, { replace: true }); }, [auth.isAuth, navigate, returnTo]);
  const update = key => event => setForm(previous => ({ ...previous, [key]: event.target.value }));
  const field = (key, label, props = {}) => <Field key={key} label={label} name={key} value={form[key]} onChange={update(key)} disabled={task.busy} {...props} />;
  const success = response => { if (!response.data?.result) throw new Error("Signup response is incomplete."); auth.setUser(response.data.result); auth.setRole(response.data.role || type); auth.setIsAuth(true); navigate(returnTo, { replace: true }); };
  const submit = event => { event.preventDefault(); void task.run(signal => axios.post(`${BACKEND_URL}/${type}/signup`, signupPayload(form), { signal }), success); };
  const google = response => {
    if (!response?.credential || !form.firstName.trim() || (type === "doctor" && (!form.expertise.trim() || form.years === ""))) { task.setFeedback({ message: "Enter your first name and, for doctors, specialty and experience before Google signup.", tone: "error" }); return; }
    void task.run(signal => axios.post(`${BACKEND_URL}/${type}/google-auth`, { credential: response.credential, role: type, profile: signupPayload({ ...form, password: "" }) }, { signal }), success);
  };
  const choose = value => { if (value === "hospital-admin") { navigate("/signup/hospital-admin"); return; } setType(value); setForm(empty); task.setFeedback(null); };
  return <AccountPage wide title={type === "select" ? "Create your account" : type === "doctor" ? "Sign up as a Doctor" : "Sign up as a Patient"} description="Choose your account and add the details needed to get started.">
    <Feedback feedback={task.feedback} />{!task.online && <Banner>You are offline. Reconnect to create your account.</Banner>}
    {type === "select" ? <ProfileChoice signup onChoose={choose} /> : <Card as="form" onSubmit={submit} className="mp-stack" aria-busy={task.busy}>
      <h2>Account details</h2><div className="mp-form-row">{field("firstName", "First name", { required: true, autoComplete: "given-name", pattern: ".*[^ ].*" })}{field("lastName", "Last name", { autoComplete: "family-name" })}</div>
      <div className="mp-form-row">{field("email", "Email address", { required: true, type: "email", autoComplete: "email" })}<PasswordField required minLength={8} label="Password" autoComplete="new-password" hint="At least 8 characters." value={form.password} disabled={task.busy} onChange={update("password")} /></div>
      <div className="mp-form-row"><GenderField value={form.gender} disabled={task.busy} onChange={update("gender")} />{field("phone", "Phone number", { type: "tel", autoComplete: "tel-national", pattern: "[1-9][0-9]{9}", hint: "Optional · 10 digits." })}</div>
      {field("bio", "About you", { as: "textarea", rows: 3, hint: "Optional." })}
      {type === "doctor" ? <><h2>Professional details</h2><div className="mp-form-row">{field("expertise", "Specialty", { required: true, pattern: ".*[^ ].*" })}{field("years", "Years of experience", { required: true, type: "number", min: 0, step: 1 })}</div><h2>Clinic details <span className="mp-field-hint">Optional</span></h2>{field("clinicName", "Clinic name")}{field("clinicLocation", "Clinic location")} {field("clinicPhone", "Clinic phone", { type: "tel", pattern: "[1-9][0-9]{9}" })}<p className="mp-field-hint">Creating an account does not verify professional qualifications.</p></> : <details className="mp-account-details"><summary>Optional health and emergency details</summary><div className="mp-stack">{field("primaryCondition", "Primary condition")}{field("emergencyContact", "Emergency contact name")}{field("emergencyRelation", "Relationship")}{field("emergencyPhone", "Emergency contact phone", { type: "tel", pattern: "[1-9][0-9]{9}" })}</div></details>}
      <Button type="submit" disabled={task.busy || !task.online}>{task.busy ? "Creating account..." : type === "doctor" ? "Create Doctor Account" : "Create User Account"}</Button>
      <GoogleButton signup role={type} disabled={task.busy || !task.online} onCredential={google} />
      <div className="mp-actions"><Button to={"/login?returnTo=" + encodeURIComponent(returnTo)} disabled={task.busy} variant="secondary">Already have an account? Sign in</Button>{!lockProfile && <Button disabled={task.busy} variant="ghost" onClick={() => choose("select")}>Change profile type</Button>}</div>
    </Card>}
  </AccountPage>;
}
