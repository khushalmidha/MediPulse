import { test, expect } from "@playwright/test";
import process from "node:process";
const api = "http://127.0.0.1:19080", browserApi = process.env.E2E_API_PROXY === "true" ? "http://127.0.0.1:15173/backend" : api;
const patch = (request, data) => request.post(api + "/__fixture/patch", { data });
const state = async request => (await (await request.get(api + "/__fixture/state")).json());
const open = (page, path = "/doctor/appointments") => page.goto(path, { waitUntil: "domcontentloaded" });
const button = (page, name) => page.getByRole("button", { name, exact: true });
const active = page => page.getByRole("region", { name: "Current consultation", exact: true });
const errors = new WeakMap();
test.beforeEach(async ({ page, request }) => {
  const list = []; errors.set(page, list); page.on("pageerror", error => list.push(error.message));
  await request.post(api + "/__fixture/reset", { data: { clinical: true, doctorSession: true } });
  await page.route("**/*", route => { const url = new URL(route.request().url()); return url.hostname === "127.0.0.1" && ["15173", "19080"].includes(url.port) ? route.continue() : route.abort(); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

test("queue responses slower than polling still complete the initial load", async ({ page }) => {
  await page.route("**/appointment/doctor/queue*", async route => {
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 5500));
    if (!page.isClosed()) await route.fulfill({ response });
  });
  await open(page);
  await expect(active(page).getByRole("heading", { name: "Synthetic Family Patient" })).toBeVisible({ timeout: 12000 });
});

test("queue polling times out a stalled request and permits a successful retry", async ({ page }) => {
  let stalled = true;
  await page.route("**/appointment/doctor/queue*", route => {
    if (!stalled) return route.continue();
  });
  await open(page);
  await expect(page.getByText("Queue refresh timed out. Please try again.", { exact: true })).toBeVisible({ timeout: 18000 });
  stalled = false;
  await button(page, "Retry queue").click();
  await expect(active(page).getByRole("heading", { name: "Synthetic Family Patient" })).toBeVisible();
});

test("a background queue poll keeps the first patient startable and cannot overwrite a successful start", async ({ page, request }) => {
  await patch(request, { clinicalIdle: true });
  let holdNext = false, release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route("**/appointment/doctor/queue*", async route => {
    const response = await route.fetch();
    if (holdNext) { holdNext = false; await held; }
    if (!page.isClosed()) await route.fulfill({ response });
  });
  try {
    await open(page);
    const start = button(page, "Start Appointment").first();
    await expect(start).toBeEnabled();
    await expect.poll(() => page.evaluate(async () => (await import("/src/socket.js")).getSocket("account").connected)).toBe(true);
    await expect(button(page, "Refresh queue")).toBeEnabled();
    holdNext = true;
    await expect(page.getByText(/Last successful refresh.*Refreshing/)).toBeVisible({ timeout: 7000 });
    await expect(start).toBeEnabled({ timeout: 1000 });
    await start.click();
    await expect(active(page)).toBeVisible();
    release();
    await expect(active(page)).toBeVisible();
    const starts = (await state(request)).clinicalRequests.filter(row => row.path.endsWith("/start"));
    expect(starts).toHaveLength(1);
    expect(starts[0].body.revision).toBe(4);
  } finally { release(); }
});

test("a failed background queue poll retains patients but pauses actions until recovery", async ({ page, request }) => {
  await patch(request, { clinicalIdle: true }); await open(page);
  const start = button(page, "Start Appointment").first();
  await expect(start).toBeEnabled();
  await patch(request, { clinicalReadStatus: 503 });
  await expect(page.getByText(/Previously loaded records are shown/)).toBeVisible({ timeout: 7000 });
  await expect(start).toBeDisabled();
  await patch(request, { clinicalReadStatus: null });
  await button(page, "Retry queue").click();
  await expect(start).toBeEnabled();
});

test("reconnecting during a background poll pauses actions until a fresh snapshot arrives", async ({ page, request }) => {
  await patch(request, { clinicalIdle: true });
  let holdNext = false, release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route("**/appointment/doctor/queue*", async route => {
    const response = await route.fetch();
    if (holdNext) { holdNext = false; await held; }
    if (!page.isClosed()) await route.fulfill({ response });
  });
  try {
    await open(page);
    await expect.poll(() => page.evaluate(async () => (await import("/src/socket.js")).getSocket("account").connected)).toBe(true);
    await expect(button(page, "Refresh queue")).toBeEnabled();
    holdNext = true;
    await expect(page.getByText(/Last successful refresh.*Refreshing/)).toBeVisible({ timeout: 7000 });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(button(page, "Start Appointment").first()).toBeDisabled();
    await patch(request, { clinicalIdle: false, clinicalQueueRevision: 11 });
    release();
    await expect(active(page)).toBeVisible();
    await expect(button(page, "Start Appointment").first()).toBeDisabled();
    expect((await state(request)).clinicalRequests || []).toHaveLength(0);
  } finally { release(); }
});

test("clinician pages reject patients and stale saved staff identity", async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { clinical: true } });
  await page.addInitScript(() => sessionStorage.setItem("medipulse.hospitalAdmin", JSON.stringify({ staff: { _id: "000000000000000000000005", role: "DOCTOR", hospitalId: "000000000000000000000004" } })));
  await open(page); await expect(page.getByRole("heading", { name: "Your doctor account is needed" })).toBeVisible();
  await open(page, "/hospital/doctor-opd"); await expect(page.getByRole("heading", { name: "Hospital doctor access is needed" })).toBeVisible();
  expect((await state(request)).clinicalQueueReads || 0).toBe(0);
});
test("queue errors distinguish initial outage from empty care and hide revoked records", async ({ page, request }) => {
  await patch(request, { clinicalReadStatus: 503 }); await open(page);
  await expect(page.getByRole("heading", { name: "Queue not available" })).toBeVisible();
  await button(page, "Retry queue").click(); await patch(request, { clinicalReadStatus: null }); await expect(active(page).getByRole("heading", { name: "Synthetic Family Patient" })).toBeVisible();
  await patch(request, { clinicalReadStatus: 503 }); await button(page, "Refresh queue").click();
  await expect(page.getByText(/Previously loaded records are shown/)).toBeVisible(); await expect(button(page, "Complete consultation")).toBeDisabled();
  await patch(request, { clinicalReadStatus: 401 }); await button(page, "Retry queue").click(); await expect(page.getByText("Synthetic Family Patient", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Queue not available" })).toBeVisible();
});
test("family patient identity, zero vitals and unconfirmed drafts remain truthful", async ({ page }) => {
  await open(page); await expect(active(page).getByRole("heading", { name: "Synthetic Family Patient" })).toBeVisible();
  await expect(page.getByText("Synthetic Account Owner", { exact: true })).toHaveCount(0);
  await expect(active(page).getByText("0", { exact: true })).toBeVisible();
  await expect(active(page).getByText("Draft — clinician review needed", { exact: true })).toBeVisible();
  await expect(page.getByText("ROUTINE", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Join Call|Start Call|Camera/i })).toHaveCount(0);
});
test("unsaved doctor notes survive refresh and queue switching requires explicit discard", async ({ page }) => {
  await open(page); const notes = page.getByRole("textbox", { name: "Doctor notes", exact: true }); await notes.fill("Synthetic unsaved clinical draft");
  await button(page, "Refresh queue").click(); await expect(notes).toHaveValue("Synthetic unsaved clinical draft");
  const queue = page.getByRole("combobox", { name: "Care queue", exact: true }); await queue.focus(); await queue.selectOption("independent:clinical");
  const dialog = page.getByRole("dialog", { name: "Switch care queue?", exact: true }); await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(queue).toBeFocused(); await expect(notes).toHaveValue("Synthetic unsaved clinical draft");
  await queue.selectOption("independent:clinical"); await button(page, "Discard draft and switch").click(); await expect(notes).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No current consultation" })).toBeVisible();
});
test("notes changed by another editor retain the local draft and require reconciliation", async ({ page, request }) => {
  await open(page); const notes = page.getByRole("textbox", { name: "Doctor notes", exact: true }); await notes.fill("Synthetic local draft");
  await patch(request, { clinicalNotes: "Synthetic newer saved note", clinicalQueueRevision: 11 }); await button(page, "Refresh queue").click();
  await expect(page.getByText(/Saved notes changed while you were editing/)).toBeVisible(); await expect(notes).toHaveValue("Synthetic local draft");
  await expect(button(page, "Save Notes")).toBeDisabled(); await button(page, "Use latest saved notes").click(); await expect(notes).toHaveValue("Synthetic newer saved note");
});
test("failed notes and optional assistant drafts preserve input without duplicate posts", async ({ page, request }) => {
  await open(page); const notes = page.getByRole("textbox", { name: "Doctor notes", exact: true }); await notes.fill("Synthetic reviewed note");
  await patch(request, { clinicalWriteStatus: 503 }); await button(page, "Save Notes").click(); await expect(page.getByText("Synthetic clinician write refused", { exact: true })).toBeVisible(); await expect(notes).toHaveValue("Synthetic reviewed note");
  await patch(request, { clinicalWriteStatus: null, clinicalWriteDelay: 600 }); await button(page, "Save Notes").click(); await expect(button(page, "Save Notes")).toBeDisabled();
  await expect(page.getByText("Doctor notes saved.", { exact: true })).toBeVisible(); expect((await state(request)).clinicalRequests.filter(row => row.path.endsWith("/notes"))).toHaveLength(2);
  await page.getByText("Optional clinician assistant", { exact: true }).click(); await button(page, "Ask Co-Pilot").click(); await expect(page.getByText("Synthetic optional assistant draft", { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })); expect(stored).not.toContain("Synthetic reviewed note"); expect(stored).not.toContain("Synthetic optional assistant draft");
});
test("offline clinician actions retain drafts and do not mutate", async ({ page, request }) => {
  await open(page); const notes = page.getByRole("textbox", { name: "Doctor notes", exact: true }); await notes.fill("Synthetic offline draft");
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }); window.dispatchEvent(new Event("offline")); });
  await expect(button(page, "Save Notes")).toBeDisabled(); await expect(button(page, "Complete consultation")).toBeDisabled(); expect((await state(request)).clinicalRequests || []).toHaveLength(0); await expect(notes).toHaveValue("Synthetic offline draft");
});
test("ready queue filtering preserves order and only the first actual patient can start", async ({ page, request }) => {
  await patch(request, { clinicalIdle: true, clinicalMany: true }); await open(page); const ready = page.getByRole("region", { name: "Ready consultation queue", exact: true });
  await expect(ready.getByRole("button", { name: "Start Appointment", exact: true }).first()).toBeEnabled(); await expect(ready.getByRole("button", { name: "Start Appointment", exact: true }).nth(1)).toBeDisabled();
  await page.getByRole("searchbox", { name: "Search ready patients" }).fill("Synthetic Ready 2"); await expect(ready.getByRole("heading", { name: "2. Synthetic Ready 2", exact: true })).toBeVisible(); await expect(ready.getByRole("button", { name: "Start Appointment", exact: true })).toBeDisabled();
  await page.getByRole("searchbox", { name: "Search ready patients" }).fill(""); await button(page, "Next patients").click(); await expect(ready.getByRole("heading", { name: "9. Synthetic Ready 9" })).toBeVisible();
  await button(page, "Previous patients").click(); await ready.getByRole("button", { name: "Start Appointment", exact: true }).first().click(); await expect(active(page)).toBeVisible();
  expect((await state(request)).clinicalRequests.find(row => row.path.endsWith("/start")).body.revision).toBe(4);
});
test("reservations paginate separately without entering the ready queue", async ({ page, request }) => {
  await patch(request, { clinicalManyReservations: true }); await open(page);
  const held = page.getByRole("region", { name: "Reservations awaiting admission", exact: true });
  await expect(held.getByRole("heading", { name: "Synthetic Reserved 1", exact: true })).toBeVisible();
  await button(page, "Next reservations").click(); await expect(held.getByRole("heading", { name: "Synthetic Reserved 9", exact: true })).toBeVisible();
  await expect(held.getByRole("heading", { name: "Synthetic Reserved 1", exact: true })).toHaveCount(0);
  await expect(held.getByRole("button", { name: /Start|Check in/ })).toHaveCount(0);
  await button(page, "Previous reservations").click(); await expect(held.getByRole("heading", { name: "Synthetic Reserved 1", exact: true })).toBeVisible();
});

test("demo refund confirms the actual queued visit and reports pending reconciliation", async ({ page, request }) => {
  await patch(request, { clinicalRefundPending: true }); await open(page); await button(page, "Refund demo credits").first().click();
  const dialog = page.getByRole("dialog", { name: "Refund this appointment’s demo credits?", exact: true }); await expect(dialog).toBeVisible(); await expect(button(page, "Confirm demo refund")).toBeDisabled();
  await page.getByRole("textbox", { name: "Refund reason" }).fill("Synthetic rescheduling request"); await button(page, "Confirm demo refund").click();
  await expect(page.getByText(/Demo refund is pending reconciliation/)).toBeVisible(); expect((await state(request)).clinicalRefunds).toBe(1);
  const body = (await state(request)).clinicalRequests.find(row => row.path.endsWith("/refund")).body; expect(body.revision).toBe(4); expect(body.reason).toBe("Synthetic rescheduling request");
});
test("older snapshots cannot replace current clinician data or permit stale actions", async ({ page, request }) => {
  await patch(request, { clinicalQueueRevision: 20, clinicalName: "Synthetic newest patient" }); await open(page); await expect(active(page).getByRole("heading", { name: "Synthetic newest patient" })).toBeVisible();
  await patch(request, { clinicalQueueRevision: 19, clinicalName: "Synthetic stale patient" }); await button(page, "Refresh queue").click(); await expect(page.getByText(/A previous queue revision was returned/)).toBeVisible(); await expect(active(page).getByRole("heading", { name: "Synthetic newest patient" })).toBeVisible(); await expect(button(page, "Complete consultation")).toBeDisabled();
});
test("hospital doctor uses verified identity, real wait values and revision-aware completion", async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { clinical: true, nurse: true, staffRole: "DOCTOR", clinicalWriteStatus: 503 } }); await open(page, "/hospital/doctor-opd");
  await expect(page.getByRole("heading", { name: "Doctor OPD Console" })).toBeVisible(); await expect(page.getByText("Recorded estimate: 0 min", { exact: true })).toBeVisible(); await expect(page.getByText("Wait estimate unavailable", { exact: true })).toBeVisible(); await expect(button(page, "No-show")).toHaveCount(0);
  const notes = page.getByRole("textbox", { name: "Doctor notes", exact: true }); await notes.fill("Synthetic hospital clinician note"); await button(page, "Complete consultation").click(); await button(page, "Confirm completion").click(); await expect(page.getByRole("dialog").getByText("Synthetic clinician write refused", { exact: true })).toBeVisible(); await expect(notes).toHaveValue("Synthetic hospital clinician note");
  await patch(request, { clinicalWriteStatus: null, clinicalWriteDelay: 600 }); await button(page, "Confirm completion").click(); await expect(button(page, "Recording...")).toBeDisabled(); await expect(page.getByRole("heading", { name: "No current consultation" })).toBeVisible();
  const writes = (await state(request)).clinicalRequests.filter(row => row.path.endsWith("/complete")); expect(writes).toHaveLength(2); expect(writes[1].body).toEqual({ revision: 4, notes: "Synthetic hospital clinician note" });
});
test("doctor identity change disposes old notes and delayed queue responses", async ({ page, request }) => {
  await open(page); await page.getByRole("textbox", { name: "Doctor notes", exact: true }).fill("Synthetic old account draft");
  let release, held = false; await page.route(browserApi + "/appointment/doctor/queue", async route => { if (held) return route.continue(); held = true; const response = await route.fetch(); await new Promise(resolve => { release = resolve; }); await route.fulfill({ response }); });
  await button(page, "Refresh queue").click(); await expect.poll(() => Boolean(release)).toBe(true); await patch(request, { clinicalName: "Synthetic new account patient", clinicalNotes: "Synthetic new account saved note" });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("medipulse:session", { detail: { scope: "account", payload: { role: "doctor", result: { _id: "000000000000000000000099", firstName: "Synthetic new doctor" } } } })));
  await expect(active(page).getByRole("heading", { name: "Synthetic new account patient" })).toBeVisible(); release();
  await expect(page.getByRole("textbox", { name: "Doctor notes", exact: true })).toHaveValue("Synthetic new account saved note"); await expect(page.getByText("Synthetic Family Patient", { exact: true })).toHaveCount(0);
});
test("clinical pages fit mobile, tablet and desktop with accessible dialogs and dark mode", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Viewport sweep is already executed by the desktop project.");
  for (const hospital of [false, true]) {
    await request.post(api + "/__fixture/reset", { data: { clinical: true, ...(hospital ? { nurse: true, staffRole: "DOCTOR" } : { doctorSession: true }) } });
    for (const width of [360, 768, 1440]) { await page.setViewportSize({ width, height: 960 }); await open(page, hospital ? "/hospital/doctor-opd" : "/doctor/appointments"); await expect(active(page)).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`clinical-${hospital ? "hospital" : "connect"}-${width}.png`), fullPage: true }); }
  }
  await page.evaluate(() => document.documentElement.classList.add("dark")); await page.screenshot({ path: testInfo.outputPath("clinical-hospital-dark.png"), fullPage: true });
  const finish = button(page, "Complete consultation"); await finish.focus(); await page.keyboard.press("Enter"); await expect(page.getByRole("dialog", { name: "Complete this consultation?" })).toBeVisible(); await page.keyboard.press("Escape"); await expect(finish).toBeFocused();
});
