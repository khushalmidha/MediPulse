import { test, expect } from "@playwright/test";
const api = "http://127.0.0.1:19080", browserApi = process.env.E2E_API_PROXY === "true" ? "http://127.0.0.1:15173/backend" : api;
const hospitalId = "000000000000000000000004", invitePath = "/staff/accept-invite?hospital=" + hospitalId + "&token=synthetic-invite";
const patch = (request, data) => request.post(api + "/__fixture/patch", { data });
const state = async request => (await (await request.get(api + "/__fixture/state")).json());
test.beforeEach(async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { guest: true } });
  await page.route("**/*", route => { const url = new URL(route.request().url()); return url.hostname === "127.0.0.1" && ["15173", "19080"].includes(url.port) ? route.continue() : route.abort(); });
});
const byLabel = (page, label) => page.getByLabel(label, { exact: true }).or(page.getByLabel(label + " *", { exact: true }));
const account = async page => { await byLabel(page, "First name").fill("Synthetic"); await byLabel(page, "Email address").fill("fixture@example.invalid"); await byLabel(page, "Password").fill("fixture-password"); await byLabel(page, "Gender").selectOption("other"); };

test("sign-in keeps input after failure and a keyboard retry returns to booking", async ({ page, request }) => {
  await patch(request, { failLogin: true }); await page.goto("/login?returnTo=%2Fappointment%2Fbook%2F000000000000000000000001", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in as User", exact: true }).click(); await byLabel(page, "Email address").fill("fixture@example.invalid"); await byLabel(page, "Password").fill("fixture-password");
  await page.getByRole("button", { name: "Sign in as User", exact: true }).click(); await expect(page.getByText("Synthetic incorrect credentials", { exact: true })).toBeVisible(); await expect(byLabel(page, "Email address")).toHaveValue("fixture@example.invalid");
  await page.getByRole("button", { name: "Show password", exact: true }).click(); await expect(byLabel(page, "Password")).toHaveAttribute("type", "text"); await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await patch(request, { failLogin: false }); await byLabel(page, "Password").press("Enter"); await expect(page).toHaveURL(/\/appointment\/book\//); await expect(page.getByRole("heading", { name: "Book Appointment with Dr. Fixture Doctor", exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.entries(localStorage).some(([key, value]) => /password/i.test(key) || value.includes("fixture-password")))).toBe(false);
});

test("password recovery keeps failed delivery and wrong-code states honest", async ({ page, request }) => {
  await patch(request, { failOtp: true }); await page.goto("/login", { waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: "Sign in as User", exact: true }).click(); await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
  await byLabel(page, "Email address").fill("fixture@example.invalid"); await page.getByRole("button", { name: "Send OTP as User", exact: true }).click(); await expect(page.getByText("OTP email could not be queued", { exact: true })).toBeVisible(); await expect(byLabel(page, "Email OTP")).toHaveCount(0);
  await patch(request, { failOtp: false, failReset: true }); await page.getByRole("button", { name: "Send OTP as User", exact: true }).click(); await expect(page.getByText("Password reset OTP email queued", { exact: true })).toBeVisible(); await byLabel(page, "Email OTP").fill("123456"); await byLabel(page, "New password").fill("fixture-new-password"); await page.getByRole("button", { name: "Reset password", exact: true }).click(); await expect(page.getByText("Incorrect OTP", { exact: true })).toBeVisible(); await expect(byLabel(page, "Email OTP")).toHaveValue("123456");
  await patch(request, { failReset: false }); await page.getByRole("button", { name: "Reset password", exact: true }).click(); await expect(page.getByText("Password reset successfully. Sign in again.", { exact: true })).toBeVisible(); await expect(byLabel(page, "Password")).toHaveValue(""); expect((await state(request)).accountRequests.filter(item => item.kind === "reset")).toHaveLength(2);
});

test("patient signup preserves error input and returns to the chosen care page", async ({ page, request }) => {
  await patch(request, { failSignup: true }); await page.goto("/signup/user?returnTo=%2Fdoctors", { waitUntil: "domcontentloaded" }); await account(page); await page.getByRole("button", { name: "Create User Account", exact: true }).click(); await expect(page.getByText("Synthetic account already exists", { exact: true })).toBeVisible(); await expect(byLabel(page, "First name")).toHaveValue("Synthetic");
  await patch(request, { failSignup: false }); await page.getByRole("button", { name: "Create User Account", exact: true }).click(); await expect(page).toHaveURL(/\/doctors$/); await expect(page.getByRole("heading", { name: "Connect Doctor", exact: true })).toBeVisible(); const payload = (await state(request)).accountRequests.find(item => item.kind === "signup").body; expect(payload.phone).toBeUndefined(); expect(payload.primaryCondition).toBeUndefined();
});

test("doctor signup accepts explicit zero experience and submits professional details", async ({ page, request }) => {
  await page.goto("/signup/doctor?returnTo=%2Fdoctors", { waitUntil: "domcontentloaded" }); await account(page); await byLabel(page, "Specialty").fill("General Medicine"); await byLabel(page, "Years of experience").fill("0"); await page.getByRole("button", { name: "Create Doctor Account", exact: true }).click(); await expect(page).toHaveURL(/\/doctors$/); const body = (await state(request)).accountRequests.find(item => item.kind === "signup").body; expect(body.years).toBe("0"); expect(body.expertise).toBe("General Medicine");
});

test("hospital patient signup stays in its locked patient product", async ({ page }) => {
  await page.goto("/hospitals/fixture/signup?returnTo=%2Fvisits", { waitUntil: "domcontentloaded" }); await expect(page.getByRole("button", { name: "Change profile type", exact: true })).toHaveCount(0); await account(page); await page.getByRole("button", { name: "Create User Account", exact: true }).click(); await expect(page).toHaveURL(/\/hospitals\/fixture\/visits$/); await expect(page.getByRole("heading", { name: "My hospital visits", exact: true })).toBeVisible();
});

test("unauthenticated profile has a sign-in action instead of an endless spinner", async ({ page }) => { await page.goto("/profile/edit", { waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: "Sign in to edit your profile", exact: true })).toBeVisible(); await page.getByRole("link", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/returnTo=%2Fprofile%2Fedit/); });

test("profile save keeps edits after failure and dirty cancellation restores focus", async ({ page, request }) => {
  await patch(request, { guest: false, failProfile: true }); await page.goto("/profile/edit", { waitUntil: "domcontentloaded" }); await byLabel(page, "First name").fill("Updated"); const cancel = page.getByRole("button", { name: "Cancel editing", exact: true }); await cancel.click(); await expect(page.getByRole("dialog", { name: "Discard your profile changes?", exact: true })).toBeVisible(); await page.keyboard.press("Escape"); await expect(cancel).toBeFocused(); await expect(byLabel(page, "First name")).toHaveValue("Updated");
  await page.getByRole("button", { name: "Save Profile", exact: true }).click(); await expect(page.getByText("Synthetic profile save outage", { exact: true })).toBeVisible(); await expect(byLabel(page, "First name")).toHaveValue("Updated"); await patch(request, { failProfile: false }); await page.getByRole("button", { name: "Save Profile", exact: true }).click(); await expect(page.getByText("Profile updated successfully.", { exact: true })).toBeVisible(); expect((await state(request)).patientProfile.firstName).toBe("Updated");
});

test("doctor profile update preserves recorded qualification and clinic metadata", async ({ page, request }) => {
  await patch(request, { guest: false, doctorSession: true, doctorProfile: { gender: "other", experience: { expertise: "General Medicine", years: 0, qualification: "Recorded qualification" }, clinic: { name: "Fixture Clinic", location: "Fixture", pin: 123456, phoneNumber: 9876543210 } } }); await page.goto("/profile/edit", { waitUntil: "domcontentloaded" }); await expect(byLabel(page, "Years of experience")).toHaveValue("0"); await byLabel(page, "Consultation fee (INR)").fill("750.25"); await page.getByRole("button", { name: "Save Profile", exact: true }).click(); await expect(page.getByText("Profile updated successfully.", { exact: true })).toBeVisible(); const result = await state(request); expect(result.doctorProfile.experience.qualification).toBe("Recorded qualification"); expect(result.doctorProfile.clinic.pin).toBe(123456); expect(result.doctorProfile.consultationFee).toBe(750.25);
});

test("offline account forms prevent mutation and resume with preserved input", async ({ page, request, context }) => {
  await page.goto("/signup/user", { waitUntil: "domcontentloaded" }); await account(page); await context.setOffline(true); await expect(page.getByRole("button", { name: "Create User Account", exact: true })).toBeDisabled(); await expect(page.getByText("You are offline. Reconnect to create your account.", { exact: true })).toBeVisible(); expect((await state(request)).accountRequests || []).toHaveLength(0); await context.setOffline(false); await expect(page.getByRole("button", { name: "Create User Account", exact: true })).toBeEnabled(); await expect(byLabel(page, "First name")).toHaveValue("Synthetic");
});

test("staff invite retry and acceptance initialize the nurse workspace once", async ({ page, request }) => {
  await patch(request, { failInviteRead: true }); await page.goto(invitePath, { waitUntil: "domcontentloaded" }); await expect(page.getByText("Synthetic invitation outage", { exact: true })).toBeVisible(); await patch(request, { failInviteRead: false }); await page.getByRole("button", { name: "Retry invitation", exact: true }).click(); await byLabel(page, "Password").fill("fixture-password"); await page.getByRole("button", { name: "Complete setup", exact: true }).click(); await expect(page).toHaveURL(/\/hospital\/nursing-station$/); await expect(page.getByRole("heading", { name: "Nursing Station", exact: true })).toBeVisible(); expect((await state(request)).accountRequests.filter(item => item.kind === "invite")).toHaveLength(1); expect(await page.evaluate(() => sessionStorage.getItem("medipulse.hospitalAdmin").includes("synthetic-invite"))).toBe(false);
});

test("expired, missing and consumed invites expose recovery without an active form", async ({ page, request }) => {
  await page.goto("/staff/accept-invite", { waitUntil: "domcontentloaded" }); await expect(page.getByText("Invite link is missing required details.", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Complete setup", exact: true })).toHaveCount(0);
  await patch(request, { inviteExpired: true }); await page.goto(invitePath, { waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: "Request a new invitation", exact: true })).toBeVisible();
  await patch(request, { inviteExpired: false, failInviteSubmit: true }); await page.reload({ waitUntil: "domcontentloaded" }); await byLabel(page, "Password").fill("fixture-password"); await page.getByRole("button", { name: "Complete setup", exact: true }).click(); await expect(page.getByText("Invite is invalid or already used", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Complete setup", exact: true })).toHaveCount(0);
});

test("staff login selects the role workspace and retains locked context", async ({ page, request }) => {
  await patch(request, { loginStaffRole: "NURSE" }); await page.goto("/hospital/login", { waitUntil: "domcontentloaded" }); await byLabel(page, "Email address").fill("fixture@example.invalid"); await byLabel(page, "Password").fill("fixture-password"); await byLabel(page, "Hospital ID").fill(hospitalId); await expect(page.getByRole("button", { name: "Change profile type", exact: true })).toHaveCount(0); await page.getByRole("button", { name: "Sign in as Hospital Staff", exact: true }).click(); await expect(page).toHaveURL(/\/hospital\/nursing-station$/); await expect(page.getByRole("heading", { name: "Nursing Station", exact: true })).toBeVisible();
});

test("hospital registration validates password and retains the real address on retry", async ({ page, request }) => {
  await patch(request, { failRegister: true }); await page.goto("/hospital/signup", { waitUntil: "domcontentloaded" }); for (const [label, value] of [["Hospital Name", "Synthetic Hospital"], ["Hospital Email", "fixture@example.invalid"], ["Registration / License Number", "SYNTHETIC-REG"], ["Admin Name", "Synthetic Admin"], ["Admin Password", "short"], ["City", "Fixture"], ["State", "Fixture"]]) await byLabel(page, label).fill(value);
  await page.getByRole("button", { name: "Create hospital workspace", exact: true }).click(); expect((await state(request)).accountRequests || []).toHaveLength(0); await byLabel(page, "Admin Password").fill("fixture-password"); await page.getByRole("button", { name: "Create hospital workspace", exact: true }).click(); await expect(page.getByText("Synthetic registration conflict", { exact: true })).toBeVisible(); await expect(byLabel(page, "City")).toHaveValue("Fixture"); await patch(request, { failRegister: false }); await page.getByRole("button", { name: "Create hospital workspace", exact: true }).click(); await expect(page).toHaveURL(/\/hospital\/admin$/); const result = await state(request); expect(result.accountRequests.filter(item => item.kind === "register")).toHaveLength(2); expect(result.accountRequests.find(item => item.kind === "register").body.address.city).toBe("Fixture");
});

test("account routes fit mobile, tablet and desktop in light and dark themes", async ({ page, request }, info) => {
  test.skip(info.project.name === "mobile", "One sweep checks all viewport widths.");
  const screens = [["login", "/login", "Welcome Back"], ["patient-signup", "/signup/user", "Sign up as a Patient"], ["doctor-signup", "/signup/doctor", "Sign up as a Doctor"], ["hospital-login", "/hospital/login", "Sign in as Hospital Staff"], ["hospital-signup", "/hospital/signup", "Create Hospital Admin Portal"], ["invite", invitePath, "Join as NURSE"], ["profile", "/profile/edit", "Edit Profile", true]];
  for (const width of [360, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); for (const [label, path, heading, signedIn] of screens) {
    await patch(request, { guest: !signedIn, nurse: false, doctorSession: false }); await page.goto(path, { waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible(); expect(await page.getByRole("heading", { name: heading, exact: true }).evaluate(node => Number(getComputedStyle(node).fontWeight))).toBeGreaterThanOrEqual(700); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); if (label === "hospital-signup" && width > 400) { const email = await byLabel(page, "Hospital Email").boundingBox(), phone = await byLabel(page, "Phone").boundingBox(); expect(Math.abs(email.y - phone.y)).toBeLessThanOrEqual(1); } await page.screenshot({ path: info.outputPath(label + "-" + width + ".png"), fullPage: true });
  } }
  await page.getByRole("button", { name: "Use dark theme", exact: true }).click(); await expect(page.getByRole("button", { name: "Use light theme", exact: true })).toBeVisible(); expect(await page.getByRole("button", { name: "Profile menu", exact: true }).locator("span").last().evaluate(node => getComputedStyle(node).color === getComputedStyle(document.querySelector(".mp-shell")).color)).toBe(true); await page.screenshot({ path: info.outputPath("profile-dark.png"), fullPage: true });
});


test("repeated signup submissions create one request while the response is pending", async ({ page, request }) => {
  await page.goto("/signup/user?returnTo=%2Fdoctors", { waitUntil: "domcontentloaded" }); await account(page);
  let release; await page.route(browserApi + "/user/signup", async route => { await new Promise(resolve => { release = resolve; }); await route.continue(); });
  await page.getByRole("button", { name: "Create User Account", exact: true }).evaluate(button => { button.form.requestSubmit(button); button.form.requestSubmit(button); });
  await expect(page.getByRole("button", { name: "Creating account...", exact: true })).toBeDisabled(); await expect.poll(() => Boolean(release)).toBe(true); release(); await expect(page).toHaveURL(/\/doctors$/); expect((await state(request)).accountRequests.filter(item => item.kind === "signup")).toHaveLength(1);
});


test("doctor sign-in and password recovery use the doctor account endpoints", async ({ page, request }) => {
  await page.goto("/login?returnTo=%2Fdoctors", { waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: "Sign in as Doctor", exact: true }).click();
  await page.getByRole("button", { name: "Forgot password?", exact: true }).click(); await byLabel(page, "Email address").fill("fixture@example.invalid"); await page.getByRole("button", { name: "Send OTP as Doctor", exact: true }).click(); await expect(page.getByText("Password reset OTP email queued", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Back to sign in", exact: true }).click(); await byLabel(page, "Password").fill("fixture-password"); await page.getByRole("button", { name: "Sign in as Doctor", exact: true }).click(); await expect(page).toHaveURL(/\/doctors$/); expect((await state(request)).accountRequests.filter(item => ["login", "otp"].includes(item.kind)).every(item => item.role === "doctor")).toBe(true);
});

test("hospital signup alias and doctor invitation retain their actual roles", async ({ page, request }) => {
  await page.goto("/signup/hospital-admin", { waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: "Create Hospital Admin Portal", exact: true })).toBeVisible();
  await patch(request, { inviteRole: "DOCTOR", inviteExperience: 5 }); await page.goto(invitePath, { waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: "Join as DOCTOR", exact: true })).toBeVisible(); await expect(byLabel(page, "Qualification")).toHaveValue("Recorded qualification"); await expect(byLabel(page, "Years of experience")).toHaveValue("5"); await byLabel(page, "Years of experience").fill("0"); await byLabel(page, "Password").fill("fixture-password"); await page.getByRole("button", { name: "Complete setup", exact: true }).click(); await expect(page).toHaveURL(/\/hospital\/doctor-opd$/); await expect(page.getByRole("heading", { name: "Doctor OPD Console", exact: true })).toBeVisible(); const result = await state(request); expect(result.accountRequests.find(item => item.kind === "invite").body.doctorProfile.qualification).toBe("Recorded qualification"); expect(result.staffRole).toBe("DOCTOR"); expect(result.inviteProfessionalExperience).toBe(0);
});
