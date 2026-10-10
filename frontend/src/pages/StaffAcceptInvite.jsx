import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { Banner, Button, Card, EmptyState, Field, LoadingState } from "../components/ui";
import { AccountPage, Feedback, PasswordField } from "../components/account/AccountUI";
import useFormTask from "../hooks/useFormTask";
import { invitationDoctorProfile, staffDestination } from "../utils/accountForms";
import { BACKEND_URL } from "../utils";
export default function StaffAcceptInvite() {
  const [params] = useSearchParams(), hospitalId = params.get("hospital") || "", token = params.get("token") || "", scope = hospitalId + ":" + token;
  return <InviteForm key={scope} hospitalId={hospitalId} token={token} />;
}
/* eslint-disable react/prop-types */
function InviteForm({ hospitalId, token }) {
  const [invite, setInvite] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [expired, setExpired] = useState(false);
  const [form, setForm] = useState({ name: "", password: "", profilePhoto: "", specialization: "", qualification: "", experience: "" }), task = useFormTask(), navigate = useNavigate();
  useEffect(() => {
    if (!hospitalId || !token) { setLoading(false); setError("Invite link is missing required details."); return undefined; }
    const controller = new AbortController(); setLoading(true); setError("");
    axios.get(`${BACKEND_URL}/api/hospitals/${encodeURIComponent(hospitalId)}/staff/invite/accept?token=${encodeURIComponent(token)}`, { signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      if (!response.data.staff) throw new Error("Invite details are unavailable.");
      setInvite(response.data.staff); setForm(current => ({ ...current, name: current.name || response.data.staff.name || "", specialization: current.specialization || response.data.staff.doctorProfile?.specialization || "", qualification: current.qualification || response.data.staff.doctorProfile?.qualification || "", experience: current.experience || String(response.data.staff.doctorProfile?.experience ?? "") })); setLoading(false);
    }).catch(failure => { if (!controller.signal.aborted) { setError(failure.response?.data?.message || "Unable to check this invitation. Please retry."); if ([403, 404, 410].includes(failure.response?.status)) { setInvite(null); setExpired(true); } setLoading(false); } });
    return () => controller.abort();
  }, [hospitalId, token, attempt]);
  const update = key => event => setForm(previous => ({ ...previous, [key]: event.target.value }));
  const field = (key, label, props = {}) => <Field key={key} label={label} value={form[key]} onChange={update(key)} disabled={task.busy} {...props} />;
  const submit = event => {
    event.preventDefault();
    void task.run(async signal => {
      try { return await axios.post(`${BACKEND_URL}/api/auth/staff/set-password`, { hospitalId, token, password: form.password, name: form.name.trim(), ...(form.profilePhoto ? { profilePhoto: form.profilePhoto } : {}), ...(invite.role === "DOCTOR" ? { doctorProfile: invitationDoctorProfile(form) } : {}) }, { signal }); }
      catch (failure) { if ([403, 404, 410].includes(failure.response?.status)) { setExpired(true); setInvite(null); setForm(previous => ({ ...previous, password: "" })); } throw failure; }
    }, response => { if (!response.data.result) throw new Error("Staff setup response is incomplete."); navigate(staffDestination(response.data.result), { replace: true }); });
  };
  return <AccountPage wide title={invite ? "Join as " + invite.role.replaceAll("_", " ") : "Complete staff setup"} eyebrow="Hospital staff invitation" description="Review your invitation and create the password for your hospital workspace."><Feedback feedback={task.feedback} />{loading ? <LoadingState>Checking your invitation...</LoadingState> : error ? <Banner action={!expired && hospitalId && token ? <Button onClick={() => setAttempt(value => value + 1)}>Retry invitation</Button> : undefined}>{error}</Banner> : null}{expired && <Card><EmptyState title="Request a new invitation">Ask your hospital administrator for a new link. An expired or accepted link cannot be used again.</EmptyState><Button to="/hospital/login" variant="secondary">Staff sign in</Button></Card>}
    {invite && !expired && <Card as="form" className="mp-stack" onSubmit={submit} aria-busy={task.busy}><dl className="mp-details"><div><dt>Invited email</dt><dd>{invite.email}</dd></div><div><dt>Role</dt><dd>{invite.role.replaceAll("_", " ")}</dd></div></dl>{!task.online && <Banner>You are offline. Reconnect to accept your invitation.</Banner>}{field("name", "Name", { required: true, pattern: ".*[^ ].*", autoComplete: "name" })}<PasswordField required minLength={8} hint="At least 8 characters." autoComplete="new-password" value={form.password} disabled={task.busy} onChange={update("password")} />{field("profilePhoto", "Profile photo URL", { type: "url", pattern: "https?://.*", hint: "Optional · use an HTTPS image URL." })}{invite.role === "DOCTOR" && <><h2>Professional details</h2>{field("specialization", "Specialty")}{field("qualification", "Qualification")}{field("experience", "Years of experience", { type: "number", min: 0, step: 1 })}</>}<Button type="submit" disabled={task.busy || !task.online}>{task.busy ? "Joining..." : "Complete setup"}</Button></Card>}
  </AccountPage>;
}
