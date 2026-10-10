/* eslint-disable react/prop-types */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { Banner, Button, Card, Dialog, EmptyState, Field, LoadingState } from "../components/ui";
import { AccountPage, Feedback, GenderField } from "../components/account/AccountUI";
import useFormTask from "../hooks/useFormTask";
import { profileDraft, profilePayload } from "../utils/accountForms";
import { BACKEND_URL } from "../utils";
export default function EditProfile() {
  const auth = useAuth();
  if (auth.loader) return <main className="mp-page"><LoadingState>Loading your profile...</LoadingState></main>;
  if (!auth.isAuth || !auth.user || !["user", "doctor"].includes(auth.role)) return <main className="mp-page"><EmptyState title="Sign in to edit your profile" action={<Button to="/login?returnTo=%2Fprofile%2Fedit">Sign in</Button>}>Profile details are available to your account.</EmptyState></main>;
  return <ProfileForm key={auth.role + ":" + auth.user._id} user={auth.user} role={auth.role} setUser={auth.setUser} />;
}
function ProfileForm({ user, role, setUser }) {
  const [form, setForm] = useState(() => profileDraft(user)), [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false), task = useFormTask(), navigate = useNavigate();
  const update = key => event => { setForm(previous => ({ ...previous, [key]: event.target.value })); setDirty(true); };
  const field = (key, label, props = {}) => <Field key={key} label={label} name={key} value={form[key]} onChange={update(key)} disabled={task.busy} {...props} />;
  const submit = event => {
    event.preventDefault(); let body;
    try { body = profilePayload(form, user, role); } catch (error) { task.setFeedback({ message: error.message, tone: "error" }); return; }
    void task.run(signal => axios.put(BACKEND_URL + "/" + (role === "doctor" ? "doctor" : "user"), body, { signal }), response => {
      if (response.data?._id !== user._id) throw new Error("Profile response is incomplete.");
      setUser(response.data); setForm(profileDraft(response.data)); setDirty(false); task.setFeedback({ message: "Profile updated successfully.", tone: "info" });
    });
  };
  return <AccountPage wide title="Edit Profile" description="Keep your account information up to date."><Feedback feedback={task.feedback} />{!task.online && <Banner>You are offline. Your edits are kept on this page until you reconnect.</Banner>}<Card as="form" onSubmit={submit} className="mp-stack" aria-busy={task.busy}><h2>Personal details</h2><div className="mp-form-row">{field("firstName", "First name", { required: true, pattern: ".*[^ ].*", autoComplete: "given-name" })}{field("lastName", "Last name", { autoComplete: "family-name" })}</div><div className="mp-form-row"><GenderField value={form.gender} disabled={task.busy} onChange={update("gender")} />{field("phoneNumber", "Phone number", { type: "tel", pattern: "[1-9][0-9]{9}", hint: "10 digits. Leave blank to keep the recorded number." })}</div>{field("bio", "About you", { as: "textarea", rows: 4 })}
    {role === "doctor" && <><h2>Independent practice</h2><div className="mp-form-row">{field("expertise", "Specialty", { required: true, pattern: ".*[^ ].*" })}{field("years", "Years of experience", { type: "number", min: 0, step: 1, hint: "Leave blank to keep recorded experience." })}</div>{field("clinicName", "Clinic name")}{field("clinicLocation", "Clinic location")}{field("consultationFee", "Consultation fee (INR)", { type: "number", min: 0, step: "0.01", hint: "Independent immediate bookings use this amount in demo credits. Existing scheduled bookings retain their confirmed fee." })}<p className="mp-field-hint">Other professional details and hospital memberships are preserved.</p></>}
    {dirty && <p role="status" className="mp-field-hint">You have unsaved changes.</p>}<div className="mp-actions"><Button type="submit" disabled={task.busy || !task.online}>{task.busy ? "Saving..." : "Save Profile"}</Button><Button variant="secondary" disabled={task.busy} onClick={() => dirty ? setDiscard(true) : navigate("/dashboard")}>Cancel editing</Button></div></Card><Dialog open={discard} title="Discard your profile changes?" onClose={() => setDiscard(false)}><div className="mp-stack"><p>Your unsaved edits will be lost.</p><Button variant="danger" onClick={() => navigate("/dashboard")}>Discard changes</Button><Button variant="secondary" onClick={() => setDiscard(false)}>Keep editing</Button></div></Dialog></AccountPage>;
}
