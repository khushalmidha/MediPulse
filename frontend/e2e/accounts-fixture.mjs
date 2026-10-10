// Synthetic account form contracts. No real mail, Google, database or patient records.
export async function handleAccounts({ req, state, reply, doctor, staff, hospitalId }) {
  const url = new URL(req.url, "http://127.0.0.1:19080"), path = url.pathname;
  const respond = (body, code = 200) => { reply(body, code); return true; };
  if (path === `/api/hospitals/${hospitalId}/staff/invite/accept`) return state.failInviteRead ? respond({ message: "Synthetic invitation outage" }, 503) : state.inviteExpired ? respond({ message: "Invite is invalid or expired" }, 410) : respond({ staff: { ...staff, role: state.inviteRole || "NURSE", email: "fixture@example.invalid", doctorProfile: { specialization: "General Medicine", qualification: "Recorded qualification", experience: state.inviteExperience ?? 0 } } });
  const signup = /^\/(user|doctor)\/signup$/.test(path), login = path === "/doctor/login" || path === "/user/staff/login" || path === "/user/login" && state.failLogin;
  const reset = /^\/(user|doctor)\/forgot-password\/(send-otp|reset)$/.test(path), profile = ["/user", "/doctor"].includes(path) && req.method === "PUT";
  const invite = path === "/api/auth/staff/set-password", register = path === "/api/hospitals/register";
  if (!signup && !login && !reset && !profile && !invite && !register) return false;
  let raw = ""; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw || "{}");
  const kind = signup ? "signup" : login ? "login" : reset ? path.endsWith("reset") ? "reset" : "otp" : profile ? "profile" : invite ? "invite" : "register";
  state.accountRequests ||= []; state.accountRequests.push({ kind, role: path.startsWith("/doctor") ? "doctor" : "user", body: { ...body, password: body.password ? "[synthetic-redacted]" : undefined, adminPassword: body.adminPassword ? "[synthetic-redacted]" : undefined, newPassword: body.newPassword ? "[synthetic-redacted]" : undefined, token: undefined } });
  if (state.failLogin && login) return respond({ message: "Synthetic incorrect credentials" }, 401);
  if (state.failSignup && signup) return respond({ message: "Synthetic account already exists" }, 409);
  if (state.failProfile && profile) return respond({ message: "Synthetic profile save outage" }, 503);
  if (state.failRegister && register) return respond({ message: "Synthetic registration conflict" }, 409);
  if (state.failOtp && reset && !path.endsWith("reset")) return respond({ message: "OTP email could not be queued" }, 503);
  if (state.failReset && reset && path.endsWith("reset")) return respond({ message: "Incorrect OTP" }, 401);
  if (reset) return respond({ message: path.endsWith("reset") ? "Password reset successfully. Sign in again." : "Password reset OTP email queued", ...(path.endsWith("reset") ? {} : { deliveryStatus: "queued" }) });
  if (profile) {
    if (state.guest || req.headers["x-csrf-token"] !== "fixture-account-csrf") return respond({ message: "Patient/doctor session required" }, 403);
    const isDoctor = path === "/doctor", result = { ...(isDoctor ? doctor : { _id: "000000000000000000000002", firstName: "Fixture", lastName: "Patient" }), ...(isDoctor ? state.doctorProfile : state.patientProfile), ...body };
    state[isDoctor ? "doctorProfile" : "patientProfile"] = result; return respond(result);
  }
  if (invite && (state.inviteExpired || state.failInviteSubmit)) return respond({ message: "Invite is invalid or already used" }, 410);
  if (register || invite || path.includes("/staff/login")) {
    const role = register ? "HOSPITAL_ADMIN" : invite ? state.inviteRole || "NURSE" : state.loginStaffRole || "NURSE", result = { ...staff, role, name: body.name || body.adminName || staff.name };
    if (invite && role === "DOCTOR") state.inviteProfessionalExperience = Number(body.doctorProfile?.experience || state.inviteExperience || 0);
    state.nurse = true; state.guest = false; state.staffRole = role;
    const hospital = { _id: hospitalId, name: "Fixture Hospital", slug: "fixture", status: "pending" };
    return respond({ csrfToken: "fixture-staff-csrf", ...(register ? { staff: result } : { result }), hospital }, register ? 201 : 200);
  }
  const isDoctor = path.startsWith("/doctor"); state.guest = false; state.nurse = false; state.doctorSession = isDoctor;
  return respond({ csrfToken: "fixture-account-csrf", role: isDoctor ? "doctor" : "user", result: isDoctor ? doctor : { _id: "000000000000000000000002", firstName: body.firstName || "Fixture", lastName: body.lastName || "Patient" } }, 201);
}
