/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { useProduct } from "../context/ProductContext";
import useFormTask from "../hooks/useFormTask";
import { Banner, Button, Card, Field } from "../components/ui";
import { AccountPage, Feedback, PasswordField, ProfileChoice } from "../components/account/AccountUI";
import GoogleButton from "../components/account/GoogleButton";
import { safeReturnPath } from "../utils/appointments";
import { staffDestination } from "../utils/accountForms";
import { BACKEND_URL } from "../utils";

export default function Login({ initialType, lockProfile = false }) {
  const [type, setType] = useState(initialType || "select"), [mode, setMode] = useState("login"), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [hospitalId, setHospitalId] = useState(""), [remember, setRemember] = useState(false);
  const [otpSent, setOtpSent] = useState(false), [otp, setOtp] = useState(""), [newPassword, setNewPassword] = useState("");
  const auth = useAuth(), product = useProduct(), task = useFormTask(), navigate = useNavigate(), location = useLocation();
  const returnTo = safeReturnPath(new URLSearchParams(location.search).get("returnTo")), label = type === "doctor" ? "Doctor" : type === "hospital-admin" ? "Hospital Staff" : "User";
  useEffect(() => { if (auth.isAuth && type !== "hospital-admin") navigate(returnTo, { replace: true }); }, [auth.isAuth, type, navigate, returnTo]);
  const destination = response => {
    if (!response.data?.result) throw new Error("Sign-in response is incomplete.");
    if (type === "hospital-admin") {
      auth.syncStaffSession({ data: response.data.result, role: response.data.result.role, hospital: response.data.hospital || { _id: response.data.result.hospitalId } });
      const target = staffDestination(response.data.result);
      if (product.kind === "staff") navigate(target, { replace: true });
      else window.location.replace((["localhost", "127.0.0.1"].includes(window.location.hostname) ? "" : "https://" + (import.meta.env.VITE_BASE_DOMAIN || "medipulse.live")) + target);
    } else { auth.setUser(response.data.result); auth.setRole(response.data.role || type); auth.setIsAuth(true); navigate(returnTo, { replace: true }); }
  };
  const submit = event => {
    event.preventDefault();
    if (mode === "forgot") {
      void task.run(signal => axios.post(`${BACKEND_URL}/${type}/forgot-password/${otpSent ? "reset" : "send-otp"}`, otpSent ? { email: email.trim(), otp, newPassword } : { email: email.trim() }, { signal }), response => {
        if (otpSent) { setMode("login"); setOtpSent(false); setOtp(""); setNewPassword(""); setPassword(""); task.setFeedback({ message: response.data.message || "Password reset. Sign in again.", tone: "info" }); }
        else { setOtpSent(true); task.setFeedback({ message: response.data.message || "Password reset email is queued. Check your inbox for the code.", tone: "info" }); }
      }); return;
    }
    void task.run(signal => axios.post(`${BACKEND_URL}/${type === "hospital-admin" ? "user/staff" : type}/login`, { email: email.trim(), password, rememberMe: remember, ...(type === "hospital-admin" ? { hospitalId: hospitalId.trim() } : {}) }, { signal }), destination);
  };
  const choose = value => { setType(value); setPassword(""); setOtp(""); setNewPassword(""); setOtpSent(false); setMode("login"); task.setFeedback(null); };
  const google = credential => { if (!credential?.credential) { task.setFeedback({ message: "Google sign-in did not return a credential.", tone: "error" }); return; } void task.run(signal => axios.post(`${BACKEND_URL}/${type}/google-auth`, { credential: credential.credential, role: type, rememberMe: remember }, { signal }), destination); };
  const signup = "/signup" + (lockProfile ? "" : "/" + (type === "select" ? "user" : type)) + "?returnTo=" + encodeURIComponent(returnTo);
  return <AccountPage wide={type === "select"} title={type === "select" ? "Welcome Back" : mode === "forgot" ? "Reset your password" : "Sign in as " + label} description={type === "select" ? "Choose the account you use for care or hospital work." : type === "hospital-admin" ? "Use your hospital ID and staff credentials." : "Continue your care journey."}>
    <Feedback feedback={task.feedback} />{!task.online && <Banner>You are offline. Reconnect to continue.</Banner>}
    {type === "select" ? <><ProfileChoice onChoose={choose} /><p className="mp-account-footnote">New to MediPulse? <Button to="/signup" variant="ghost">Create an account</Button></p></> : <Card as="form" onSubmit={submit} className="mp-stack" aria-busy={task.busy}>
      <Field label="Email address" type="email" autoComplete="email" required placeholder="you@example.com" value={email} disabled={task.busy || (mode === "forgot" && otpSent)} onChange={event => setEmail(event.target.value)} />
      {mode === "login" ? <><PasswordField required autoComplete="current-password" placeholder="••••••••" value={password} disabled={task.busy} onChange={event => setPassword(event.target.value)} />{type === "hospital-admin" && <Field label="Hospital ID" required pattern="[a-fA-F0-9]{24}" hint="Use the hospital ID provided by your administrator." value={hospitalId} disabled={task.busy} onChange={event => setHospitalId(event.target.value)} />}<label className="mp-checkbox"><input type="checkbox" checked={remember} disabled={task.busy} onChange={event => setRemember(event.target.checked)} />Keep me signed in</label></> : otpSent && <><Field label="Email OTP" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} value={otp} disabled={task.busy} onChange={event => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} /><PasswordField label="New password" required minLength={8} maxLength={128} autoComplete="new-password" hint="At least 8 characters." value={newPassword} disabled={task.busy} onChange={event => setNewPassword(event.target.value)} /></>}
      <Button type="submit" disabled={task.busy || !task.online}>{task.busy ? "Processing..." : mode === "forgot" ? otpSent ? "Reset password" : "Send OTP as " + label : "Sign in as " + label}</Button>
      {mode === "forgot" ? <div className="mp-actions"><Button variant="ghost" disabled={task.busy} onClick={() => { setMode("login"); setOtp(""); setNewPassword(""); setOtpSent(false); task.setFeedback(null); }}>Back to sign in</Button>{otpSent && <Button variant="secondary" disabled={task.busy} onClick={() => { setOtpSent(false); setOtp(""); setNewPassword(""); task.setFeedback(null); }}>Change email or request a new code</Button>}</div> : <>{type !== "hospital-admin" ? <><Button variant="ghost" disabled={task.busy} onClick={() => { setMode("forgot"); task.setFeedback(null); }}>Forgot password?</Button><GoogleButton role={type} disabled={task.busy || !task.online} onCredential={google} /><Button to={signup} variant="secondary" disabled={task.busy}>Create an account</Button></> : <><p className="mp-field-hint">For staff password recovery, contact your hospital administrator for a new invitation.</p><Button to="/hospital/signup" variant="secondary" disabled={task.busy}>Register a hospital</Button></>}{!lockProfile && <Button variant="ghost" disabled={task.busy} onClick={() => choose("select")}>Change profile type</Button>}</>}
    </Card>}
  </AccountPage>;
}
