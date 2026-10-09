import { test, expect } from "@playwright/test";
const api = "http://127.0.0.1:19080", browserApi = process.env.E2E_API_PROXY === "true" ? "http://127.0.0.1:15173/backend" : api;
const booking = "/appointment/book/000000000000000000000001";
const serviceDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 2 * 86400000));
const state = async request => (await (await request.get(api + "/__fixture/state")).json());
const patch = (request, data) => request.post(api + "/__fixture/patch", { data });
test.beforeEach(async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { schedule: true, scheduleDate: serviceDate } });
  await page.route("**/*", route => { const url = new URL(route.request().url()); return url.hostname === "127.0.0.1" && ["15173", "19080"].includes(url.port) ? route.continue() : route.abort(); });
});
const choose = async (page, { family = false, hospital = false } = {}) => {
  if (hospital) { await page.goto("/hospitals/fixture", { waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: "Book with doctor", exact: true }).click(); }
  else await page.goto(booking, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Service date", { exact: true }).fill(serviceDate);
  if (family) { await expect(page.getByLabel("Patient", { exact: true })).toBeEnabled(); await page.getByLabel("Patient", { exact: true }).selectOption({ label: "Fixture Child · child" }); }
  await expect(page.getByRole("radio", { name: /places available/ }).first()).toBeEnabled();
  await page.getByRole("radio", { name: /places available/ }).first().check();
};
const hold = async (page, options) => { await choose(page, options); await page.getByRole("button", { name: "Hold slot and review", exact: true }).click(); await expect(page.getByRole("heading", { name: "Review your reservation", exact: true })).toBeVisible(); };
const confirm = async (page, options) => { await hold(page, options); await page.getByRole("button", { name: "Confirm reservation", exact: true }).click(); await expect(page.getByRole("heading", { name: "Your visit is confirmed", exact: true })).toBeVisible(); };

test("family appointment follows actual availability, fee review and private confirmation", async ({ page, request }) => {
  await hold(page, { family: true }); await expect(page.getByText("Fixture Child", { exact: true })).toBeVisible();
  await expect(page.getByText(/₹500/).first()).toBeVisible(); expect((await state(request)).schedulePayments || 0).toBe(0);
  const button = page.getByRole("button", { name: "Confirm reservation", exact: true }); await button.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/appointments\/reservations\/00000000000000000000012c$/);
  await expect(page.getByRole("heading", { name: "Your visit is confirmed" })).toBeVisible();
  await expect(page.getByText("Not checked in", { exact: true })).toBeVisible(); await expect(page.getByText("Not available before queue admission", { exact: true })).toBeVisible();
  const result = await state(request); expect(result.schedulePayments).toBe(1); expect(result.scheduleVisits[0].reservation.familyMemberId).toBe("000000000000000000000020");
  const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Download calendar reminder", exact: true }).click(); expect((await downloaded).suggestedFilename()).toBe("medipulse-visit.ics");
});
test("guest can choose actual care and returns to it after patient sign-in", async ({ page, request }) => {
  await patch(request, { guest: true }); await choose(page);
  await expect(page.getByRole("button", { name: "Hold slot and review", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Patient sign in to continue", exact: true }).click(); await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByRole("button", { name: /Sign in as User/ }).click();
  await page.locator('input[type="email"]').fill("fixture@example.invalid"); await page.locator('input[type="password"]').fill("fixture-password");
  await page.locator('button[type="submit"]').click(); await expect(page).toHaveURL(/\/appointment\/book\//);
  await expect(page.getByLabel("Service date", { exact: true })).toHaveValue(serviceDate); await expect(page.getByRole("radio", { name: /places available/ }).first()).toBeChecked();
  await expect(page.getByRole("button", { name: "Hold slot and review", exact: true })).toBeEnabled();
});
test("unpublished availability produces no fabricated selectable slots", async ({ page, request }) => {
  await patch(request, { schedule: false }); await page.goto(booking, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("No configured availability on this date.", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: /places available/ })).toHaveCount(0); await expect(page.getByRole("button", { name: "Hold slot and review", exact: true })).toBeDisabled();
});
test("stale slot capacity leaves patient/date intact and takes no demo payment", async ({ page, request }) => {
  await choose(page, { family: true }); await patch(request, { slotFull: true });
  await page.getByRole("button", { name: "Hold slot and review", exact: true }).click(); await expect(page.getByText("Slot is full; refresh availability", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Patient", { exact: true })).toHaveValue("000000000000000000000020"); await expect(page.getByLabel("Service date", { exact: true })).toHaveValue(serviceDate);
  expect((await state(request)).schedulePayments || 0).toBe(0);
});
test("insufficient balance retains the held reservation and retry confirms once", async ({ page, request }) => {
  await hold(page); await patch(request, { failConfirmation: true }); await page.getByRole("button", { name: "Confirm reservation", exact: true }).click();
  await expect(page.getByText("Synthetic insufficient demo balance", { exact: true })).toBeVisible(); expect((await state(request)).schedulePayments || 0).toBe(0);
  await patch(request, { failConfirmation: false }); await page.getByRole("button", { name: "Confirm reservation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your visit is confirmed" })).toBeVisible(); const result = await state(request);
  expect(result.schedulePayments).toBe(1); expect(result.scheduleConfirmKeys[0]).toBe(result.scheduleConfirmKeys[1]);
});
test("pending confirmation is never presented as paid or confirmed", async ({ page, request }) => {
  await hold(page); await patch(request, { pendingConfirmation: true }); await page.getByRole("button", { name: "Confirm reservation", exact: true }).click();
  await expect(page.getByText("Synthetic confirmation pending", { exact: true })).toBeVisible(); await expect(page.getByRole("heading", { name: "Your visit is confirmed" })).toHaveCount(0);
  expect((await state(request)).schedulePayments || 0).toBe(0); await patch(request, { pendingConfirmation: false });
  await page.getByRole("button", { name: "Confirm reservation", exact: true }).click(); await expect(page.getByRole("heading", { name: "Your visit is confirmed" })).toBeVisible(); expect((await state(request)).schedulePayments).toBe(1);
});
test("lost hold response survives reload and replays its original slot/family request", async ({ page, request }) => {
  let dropped = false; await page.route(browserApi + "/api/scheduling/holds", async route => { if (!dropped) { dropped = true; await route.fetch(); return route.abort(); } return route.continue(); });
  await choose(page, { family: true }); await page.getByRole("button", { name: "Hold slot and review", exact: true }).click(); await expect(page.getByText("Network Error", { exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: "Retry previous hold", exact: true }).click(); await expect(page.getByRole("heading", { name: "Review your reservation" })).toBeVisible();
  const result = await state(request); expect(result.scheduleVisits).toHaveLength(1); expect(result.scheduleHoldKeys).toHaveLength(2); expect(result.scheduleHoldKeys[0]).toBe(result.scheduleHoldKeys[1]); expect(result.scheduleVisits[0].reservation.familyMemberId).toBe("000000000000000000000020");
});
test("lost confirmation and tracking outage recover the committed payment after reload", async ({ page, request }) => {
  await hold(page); await patch(request, { failTracking: true }); let dropped = false;
  await page.route(browserApi + "/api/scheduling/reservations/*/confirm", async route => { if (!dropped) { dropped = true; await route.fetch(); return route.abort(); } return route.continue(); });
  await page.getByRole("button", { name: "Confirm reservation", exact: true }).click(); await expect(page.getByText("Network Error", { exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByText("Synthetic tracking outage", { exact: false }).first()).toBeVisible();
  await patch(request, { failTracking: false }); await expect(page.getByRole("heading", { name: "Your visit is confirmed" })).toBeVisible();
  const result = await state(request); expect(result.schedulePayments).toBe(1); expect(result.scheduleConfirmKeys).toHaveLength(1);
});
test("expired hold requires new availability rather than reusing confirmation", async ({ page, request }) => {
  await hold(page); await patch(request, { holdExpired: true });
  await expect(page.getByText("This hold is no longer available.", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Confirm reservation", exact: true })).toHaveCount(0);
  expect((await state(request)).schedulePayments || 0).toBe(0); await page.getByRole("button", { name: "Choose another slot", exact: true }).click(); await expect(page.getByLabel("Service date", { exact: true })).toHaveValue(serviceDate);
});
test("rescheduling uses real target capacity, current revision and the original paid visit", async ({ page, request }) => {
  await confirm(page); await page.getByRole("button", { name: "Reschedule visit", exact: true }).click();
  const replacement = page.getByRole("radio", { name: /available/ }).last(); await expect(replacement).toBeEnabled(); await replacement.check(); await page.getByRole("button", { name: "Confirm new slot", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden(); await expect(page.getByText("Your visit change is confirmed.", { exact: true })).toBeVisible();
  const result = await state(request); expect(result.schedulePayments).toBe(1); expect(result.scheduleActions[0].action).toBe("reschedule"); expect(result.scheduleActions[0].body.revision).toBe(1); expect(result.scheduleVisits[0].reservation.revision).toBe(2);
});
test("lost rescheduling acknowledgement is recovered through tracking without another move", async ({ page, request }) => {
  await confirm(page); await page.route(browserApi + "/api/scheduling/reservations/*/reschedule", async route => { await route.fetch(); return route.abort(); });
  await page.getByRole("button", { name: "Reschedule visit", exact: true }).click(); await page.getByRole("radio", { name: /available/ }).last().check(); await page.getByRole("button", { name: "Confirm new slot", exact: true }).click();
  await expect(page.getByText("Your visit change is confirmed.", { exact: true })).toBeVisible(); await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: "Your visit is confirmed" })).toBeVisible();
  expect((await state(request)).scheduleActions.filter(item => item.action === "reschedule")).toHaveLength(1); expect((await state(request)).schedulePayments).toBe(1);
});
test("explicit cancellation reports the completed demo refund", async ({ page, request }) => {
  await confirm(page); await page.getByRole("button", { name: "Cancel reservation", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Cancel this reservation?", exact: true }); await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm cancellation", exact: true }).click(); await expect(page.getByText("Demo-credit refund completed", { exact: true })).toBeVisible();
  expect((await state(request)).scheduleActions.filter(item => item.action === "cancel")).toHaveLength(1);
});
test("hospital scheduling opens its own tracker and active in-person visits have no video", async ({ page, request }) => {
  await confirm(page, { hospital: true }); await expect(page).toHaveURL(/\/hospitals\/fixture\/reservations\//); await expect(page.getByRole("heading", { name: "Token S001", exact: true })).toBeVisible();
  await expect(page.getByText("In person at the hospital", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Check in online", exact: true })).toHaveCount(0);
  await patch(request, { reservationActive: true }); await page.getByRole("button", { name: "Refresh visit", exact: true }).click(); await expect(page.getByText("Check-in recorded", { exact: true })).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
});
test("offline tracking prevents mutations and signed-out reload hides private details", async ({ page, request, context }) => {
  await confirm(page); await context.setOffline(true); await expect(page.getByText(/You are offline/)).toBeVisible(); await expect(page.getByRole("button", { name: "Cancel reservation", exact: true })).toBeDisabled();
  await context.setOffline(false); await expect(page.getByRole("button", { name: "Cancel reservation", exact: true })).toBeEnabled();
  await patch(request, { guest: true }); await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: "Sign in to follow your visit" })).toBeVisible(); await expect(page.getByText(/Demo-credit payment confirmed/)).toHaveCount(0);
});
test("appointment pages render at 360px, tablet and desktop without page overflow", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "One sweep checks all three viewport widths.");
  await confirm(page); const tracking = new URL(page.url()).pathname;
  const screens = [["discovery", "/doctors", "Connect Doctor"], ["profile", "/doctorsProfile/000000000000000000000001", "Doctor profile"], ["booking", booking, "Book Appointment with Dr. Fixture Doctor"], ["tracking", tracking, "Your visit is confirmed"], ["history", "/my-appointments", "My appointments"]];
  for (const width of [360, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); for (const [label, path, heading] of screens) {
    await page.goto(path, { waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: info.outputPath(label + "-" + width + ".png"), fullPage: true });
  } }
});


test("revoked visit access clears previously rendered private details", async ({ page, request }) => {
  await confirm(page, { family: true }); await patch(request, { denyTracking: true });
  await page.getByRole("button", { name: "Refresh visit", exact: true }).click();
  await expect(page.getByText("Synthetic visit access revoked", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo-credit payment confirmed", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel reservation", exact: true })).toHaveCount(0);
  await expect(page.getByText("Selected family member", { exact: true })).toHaveCount(0);
});

test("legacy queue cancellation retains pending request and reports one completed refund", async ({ page, request }) => {
  await patch(request, { legacyVisit: true, pendingLegacyRefund: true }); await page.goto("/my-appointments", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Cancel queue visit", exact: true }).click();
  await page.getByRole("button", { name: "Confirm queue cancellation", exact: true }).click();
  await expect(page.getByText("Demo refund is pending. Refresh the visit or retry this request.").first()).toBeVisible(); expect((await state(request)).refunds).toBe(0);
  await page.reload({ waitUntil: "domcontentloaded" }); await patch(request, { pendingLegacyRefund: false });
  await page.getByRole("button", { name: "Retry queue cancellation", exact: true }).click();
  await page.getByRole("button", { name: "Confirm queue cancellation", exact: true }).click();
  await expect(page.getByText("Demo-credit refund completed.").first()).toBeVisible(); await expect(page.getByRole("button", { name: "Cancel queue visit", exact: true })).toHaveCount(0);
  const result = await state(request); expect(result.refunds).toBe(1); expect(result.legacyRefundRequests).toHaveLength(2); expect(result.legacyRefundRequests[0]).toEqual(result.legacyRefundRequests[1]); expect(result.legacyRefundRequests[0].revision).toBe(1);
});


test("online OPD uses its capacity window and online arrival updates the live queue", async ({ page, request }, info) => {
  await choose(page); await page.getByRole("radio", { name: "Online OPD window", exact: true }).check();
  const slot = page.getByRole("radio", { name: /places available/ }).first(); await expect(slot).toBeEnabled(); await slot.check();
  await page.getByRole("button", { name: "Hold slot and review", exact: true }).click(); await expect(page.getByRole("heading", { name: "Review your reservation", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("online-opd-review.png"), fullPage: true });
  await page.getByRole("button", { name: "Confirm reservation", exact: true }).click(); await expect(page.getByRole("heading", { name: "Your visit is confirmed", exact: true })).toBeVisible();
  await expect(page.getByText("The OPD window is a queue session. The consultation time depends on the live queue.", { exact: true })).toBeVisible();
  const visit = (await state(request)).scheduleVisits[0]; expect(visit.session.appointmentType).toBe("online_opd");
  await page.clock.setFixedTime(new Date(Date.parse(visit.reservation.startsAt) - 14 * 60000)); await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Check in online", exact: true }).click(); await expect(page.getByText("Check-in recorded", { exact: true })).toBeVisible(); await expect(page.getByText("#1", { exact: true })).toBeVisible();
  const result = await state(request); expect(result.schedulePayments).toBe(1); expect(result.scheduleActions.filter(item => item.action === "check-in")).toHaveLength(1); await expect(page.locator("video")).toHaveCount(0);
});

test("hospital doctor profiles and direct booking retain the actual hospital care context", async ({ page, request }) => {
  await patch(request, { hospitalDoctor: true }); await page.goto("/doctorsProfile/000000000000000000000001", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Book hospital care", exact: true })).toBeVisible(); await expect(page.getByText("Fixture Hospital", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "See availability", exact: true }).click(); await expect(page).toHaveURL(/\/hospitals\/fixture\?doctor=/); await expect(page.getByRole("dialog", { name: "Book OPD Token", exact: true })).toBeVisible();
  await page.goto(booking, { waitUntil: "domcontentloaded" }); await expect(page).toHaveURL(/\/hospitals\/fixture\?doctor=/); await expect(page.getByRole("radio", { name: "Hospital visit", exact: true })).toBeChecked();
});

test("hospital booking review contains actual fee and fits its single modal", async ({ page }, info) => {
  await hold(page, { hospital: true }); await expect(page.getByRole("dialog")).toHaveCount(1); await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/₹500/).first()).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.getByRole("heading", { name: "Review your reservation", exact: true }).evaluate(node => { const bounds = node.getBoundingClientRect(); return bounds.top >= 0 && bounds.bottom <= innerHeight; })).toBe(true);
  await page.getByRole("dialog").screenshot({ path: info.outputPath("hospital-review.png") }); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
});


test("retrying live visit status retains the newer queue revision", async ({ page }) => {
  let phase = 0, olderReads = 0;
  await page.route(browserApi + "/appointment/doctor/000000000000000000000001/pending", route => {
    if (phase === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Synthetic queue refresh outage" }) });
    if (phase === 2) olderReads++;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ queueKey: "independent:fixture", queueRevision: phase === 2 ? 3 : 4, myAppointment: { _id: "000000000000000000000003", status: "queued", queuePosition: phase === 2 ? 9 : 2 } }) });
  });
  await page.goto(booking, { waitUntil: "domcontentloaded" }); await expect(page.getByText("Queue position: #2", { exact: true })).toBeVisible();
  phase = 1; await page.evaluate(() => window.dispatchEvent(new Event("online"))); await expect(page.getByText("Synthetic queue refresh outage", { exact: true })).toBeVisible();
  phase = 2; const read = page.waitForResponse(response => response.url().endsWith("/pending") && response.status() === 200);
  await page.getByRole("button", { name: "Retry visit status", exact: true }).click(); await read;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(olderReads).toBeGreaterThan(0); await expect(page.getByText("Queue position: #2", { exact: true })).toBeVisible(); await expect(page.getByText("Queue position: #9", { exact: true })).toHaveCount(0);
});
