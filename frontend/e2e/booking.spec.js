import { test, expect } from "@playwright/test";

const api = "http://127.0.0.1:19080";
const browserApi = process.env.E2E_API_PROXY === "true" ? "http://127.0.0.1:15173/backend" : api;
const booking = "/appointment/book/000000000000000000000001";
test.beforeEach(async ({ page, request }) => {
  await request.post(`${api}/__fixture/reset`, { data: {} });
  // Block external requests, including live API, Google, AI and media providers.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && ["15173", "19080"].includes(url.port) ? route.continue() : route.abort();
  });
});

test("booking shows the doctor fee and keyboard confirmation opens synthetic triage", async ({ page, request }) => {
  await page.goto(booking, { waitUntil: "domcontentloaded" });
  const button = page.getByRole("button", { name: "Confirm Booking for ₹500", exact: true });
  await expect(button).toBeEnabled(); await button.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/triage\/000000000000000000000003$/);
  await expect(page.getByText("Fixture question: what brings you here today?", { exact: true }).first()).toBeVisible();
  expect((await (await request.get(`${api}/__fixture/state`)).json()).bookings).toBe(1);
});

test("failed demo payment stays on booking and allows retry", async ({ page, request }) => {
  await request.post(`${api}/__fixture/reset`, { data: { failBooking: true } });
  await page.goto(booking, { waitUntil: "domcontentloaded" });
  const button = page.getByRole("button", { name: "Confirm Booking for ₹500", exact: true });
  await button.click();
  await expect(page.getByText("Synthetic insufficient demo balance")).toBeVisible();
  await expect(button).toBeEnabled(); await expect(page).toHaveURL(new RegExp(`${booking}$`));
});

test("guest booking requires sign-in", async ({ page, request }) => {
  await request.post(`${api}/__fixture/reset`, { data: { guest: true } });
  await page.goto(booking, { waitUntil: "domcontentloaded" }); await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
});

test("booking deep link survives a reload", async ({ page }) => {
  await page.goto(booking, { waitUntil: "domcontentloaded" }); await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Book Appointment with Dr. Fixture Doctor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm Booking for ₹500", exact: true })).toBeEnabled();
});

test("logout uses server CSRF and stays signed out after reload", async ({ page, request }, testInfo) => {
  await page.goto(booking, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Confirm Booking for ₹500", exact: true })).toBeEnabled();
  const menu = page.getByRole("button", { name: testInfo.project.name === "mobile" ? "Toggle mobile menu" : "Profile menu", exact: true });
  await menu.focus(); await page.keyboard.press("Enter");
  const logout = page.getByRole("button", { name: "Log out", exact: true });
  await logout.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  expect((await (await request.get(`${api}/__fixture/state`)).json()).logouts).toBe(1);
  await page.goto(booking, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login$/);
});

test("patient login clears the old staff workspace and HttpOnly tokens stay unreadable", async ({ page, request, context }) => {
  await request.post(`${api}/__fixture/reset`, { data: { nurse: true } });
  await context.addCookies([{ name: "staffToken", value: "fixture-old-staff", url: api, httpOnly: true, sameSite: "Lax" }]);
  let releaseStaffVerify;
  await page.route(`${browserApi}/verify/staff`, async route => {
    const response = await route.fetch();
    await new Promise(resolve => { releaseStaffVerify = resolve; });
    await route.fulfill({ response });
  });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect.poll(() => Boolean(releaseStaffVerify)).toBe(true);
  await page.getByRole("button", { name: /Sign in as User/ }).click();
  await page.getByPlaceholder("you@example.com").fill("fixture@example.invalid");
  const password = page.getByPlaceholder("••••••••", { exact: true });
  await password.fill("fixture-password"); await password.press("Enter");
  await expect(page).toHaveURL(/\/dashboard$/);
  const staleResponse = page.waitForResponse(`${browserApi}/verify/staff`);
  releaseStaffVerify();
  await staleResponse;
  await expect(page.getByText("Fixture Nurse", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("medipulse.hospitalAdmin"))).toBeNull();
  const cookies = await context.cookies(api);
  expect(cookies.find(cookie => cookie.name === "token")?.httpOnly).toBe(true);
  expect(cookies.some(cookie => cookie.name === "staffToken")).toBe(false);
  expect(await page.evaluate(() => document.cookie)).not.toContain("fixture-opaque-session");
});

test("doctor profile, community discovery and chat render summary counts without member IDs", async ({ page, request }, testInfo) => {
  await request.post(`${api}/__fixture/reset`, { data: { communitySummary: true } });
  await page.goto("/doctorsProfile/000000000000000000000001", { waitUntil: "domcontentloaded" });
  const tab = page.getByRole("button", { name: /Communities/ });
  await tab.focus(); await page.keyboard.press("Enter");
  await expect(page.getByText("7 members", { exact: true }).first()).toBeVisible();
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Toggle mobile menu" }).click();
  await page.getByRole("navigation").getByRole("link", { name: "Communities", exact: true }).click();
  const details = page.getByRole("button", { name: "View More", exact: true });
  await details.focus(); await page.keyboard.press("Enter");
  await expect(page.getByText("7 members", { exact: true }).first()).toBeVisible();
  const close = page.getByRole("button", { name: "Close community details", exact: true });
  await close.focus(); await page.keyboard.press("Enter");
  // Use navigation after sign-in has loaded, preserving the shared account context.
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Toggle mobile menu" }).click();
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Browse Communities", exact: true }).click();
  await expect(page.getByText("7 members", { exact: true }).first()).toBeVisible();
});


test("lost booking response retains the request key through a reload and retry", async ({ page, request }) => {
  await request.post(`${api}/__fixture/reset`, { data: { hidePending: true } });
  let dropped = false;
  await page.route(`${browserApi}/appointment/book/000000000000000000000001`, async (route) => {
    if (!dropped) { dropped = true; await route.fetch(); return route.abort(); }
    return route.continue();
  });
  await page.goto(booking, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Confirm Booking for ₹500", exact: true }).click();
  await expect(page.getByText("Network Error", { exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Confirm Booking for ₹500", exact: true }).click();
  await expect(page).toHaveURL(/\/triage\/000000000000000000000003$/);
  const state = await (await request.get(`${api}/__fixture/state`)).json();
  expect(state.bookingKeys).toHaveLength(2); expect(state.bookingKeys[0]).toBe(state.bookingKeys[1]); expect(state.bookings).toBe(1);
});

test("staff confirms physical arrival before the reservation enters the vitals queue", async ({ page, request }) => {
  await request.post(`${api}/__fixture/reset`, { data: { nurse: true } });
  await page.addInitScript(() => sessionStorage.setItem("medipulse.hospitalAdmin", JSON.stringify({
    staff: { _id: "000000000000000000000005", role: "NURSE", hospitalId: "000000000000000000000004", departmentIds: ["000000000000000000000006"] },
    hospital: { _id: "000000000000000000000004" },
  })));
  await page.goto("/hospital/nursing-station", { waitUntil: "domcontentloaded" });
  const reservations = page.getByRole("region", { name: "Reserved visits awaiting arrival" });
  await expect(reservations.getByText("T001", { exact: false })).toBeVisible();
  const checkIn = reservations.getByRole("button", { name: "Confirm arrival" });
  await checkIn.focus(); await page.keyboard.press("Enter");
  await expect(reservations.getByText("No visits awaiting check-in.")).toBeVisible();
  expect((await (await request.get(`${api}/__fixture/state`)).json()).checkedIn).toBe(true);
});

test("doctor selects separate care queues and in-person visits show no video controls", async ({ page, request }) => {
  await request.post(`${api}/__fixture/reset`, { data: { doctorSession: true } });
  await page.goto("/doctor/appointments", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("In-person visit: complete the consultation when care is finished.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Join Call|Start Call|Camera/i })).toHaveCount(0);
  const selector = page.getByRole("combobox", { name: "Care queue" });
  await selector.selectOption("independent:fixture");
  await expect(page.getByText("In-person visit: complete the consultation when care is finished.")).toHaveCount(0);
  await selector.selectOption("hospital:fixture");
  await expect(page.getByText("In-person visit: complete the consultation when care is finished.")).toBeVisible();
});

for (const flow of [
  { path: "/admin/virtual-payments", apiPath: "/vpay/wallet/topup", identity: "Target user id", amount: "Demo top-up amount", button: "Top-up", counter: "topups", keys: "topupKeys", message: "Demo top-up completed" },
  { path: "/wallet/refunds", apiPath: "/vpay/refund", identity: "Original transactionId", amount: "Partial refund amount", button: "Issue Refund", counter: "refunds", keys: "refundKeys", message: "Demo refund completed" },
]) {
  test(`${flow.button} retains its payment key after a lost response and reload`, async ({ page, request }) => {
    let dropped = false;
    await page.route(browserApi + flow.apiPath, async (route) => {
      if (!dropped) { dropped = true; await route.fetch(); return route.abort(); }
      return route.continue();
    });
    const fill = async () => {
      await page.getByRole("textbox", { name: flow.identity, exact: true }).fill("synthetic-payment-target");
      await page.getByRole("spinbutton", { name: flow.amount, exact: true }).fill("1.23");
      const submit = page.getByRole("button", { name: flow.button, exact: true });
      await expect(submit).toBeEnabled(); await submit.focus(); await page.keyboard.press("Enter");
    };
    await page.goto(flow.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Demo INR credits only/)).toBeVisible();
    await fill(); await expect(page.getByText(/Could not confirm/)).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" }); await fill();
    await expect(page.getByText(flow.message, { exact: true })).toBeVisible();
    const state = await (await request.get(`${api}/__fixture/state`)).json();
    expect(state[flow.keys]).toHaveLength(2); expect(state[flow.keys][0]).toBe(state[flow.keys][1]); expect(state[flow.counter]).toBe(1);
  });
}

test("hospital patient ignores stale socket payloads and recovers a missed called notification", async ({ page, request }) => {
  await page.goto("/hospitals/fixture", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Fixture Hospital", exact: true })).toBeVisible();
  await request.post(`${api}/__fixture/stale-opd-hint`);
  await expect(page.getByText(/Your turn!/)).toHaveCount(0);
  await request.post(`${api}/__fixture/reset`, { data: { opdCalled: true } });
  await expect(page.getByText("Token T001 is now in consultation. Please proceed to the consultation room or ask reception for the destination.")).toBeVisible();
  const dismiss = page.getByRole("button", { name: "Got it", exact: true }); await dismiss.focus(); await page.keyboard.press("Enter");
  await expect(page.getByText(/Your turn!/)).toHaveCount(0);
});
