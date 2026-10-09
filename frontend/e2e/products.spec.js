import { test, expect } from "@playwright/test";
const api = "http://127.0.0.1:19080";
const hosts = ["medipulse.live", "connect.medipulse.live", "app.medipulse.live", "fixture.medipulse.live", "missing.medipulse.live", "api.medipulse.live", "care.example.test", "unclaimed.example.test"];
test.beforeEach(async ({ page, request }) => {
  await request.post(`${api}/__fixture/reset`, { data: { guest: true } });
  // Serve the real application under synthetic host URLs without outbound DNS/HTTP.
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" && ["15173", "19080"].includes(url.port)) return route.continue();
    if (hosts.includes(url.hostname) && ["15173", ""].includes(url.port)) {
      url.protocol = "http:"; url.hostname = "127.0.0.1"; url.port = "15173";
      const response = await route.fetch({ url: url.href }); return route.fulfill({ response });
    }
    return route.abort();
  });
});
const open = (page, host, path = "/") => page.goto(`http://${host}:15173${path}`, { waitUntil: "domcontentloaded" });
test("company routes into Connect using keyboard and retains the fallback basename", async ({ page }) => {
  await open(page, "medipulse.live");
  const connect = page.getByRole("link", { name: "Explore Connect", exact: true }); await connect.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/connect$/);
  await expect(page.getByRole("heading", { name: "MediPulse Connect", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Find independent doctors", exact: true }).click(); await expect(page).toHaveURL(/\/connect\/doctors$/);
  await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: "Connect Doctor", exact: true })).toBeVisible(); await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
});
test("Connect and staff hosts render distinct sign-in contexts", async ({ page }) => {
  await open(page, "connect.medipulse.live", "/login"); await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
  await open(page, "app.medipulse.live", "/login"); await expect(page.getByRole("heading", { name: "Sign in as Hospital Staff", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change profile type" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Sign in as Hospital Staff", exact: true })).toBeVisible();
});
test("hospital path supports nested patient login and visits", async ({ page, request }) => {
  await page.goto("/hospitals/fixture/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Sign in as User", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change profile type" })).toBeHidden();
  await page.getByRole("link", { name: "My visits", exact: true }).click(); await expect(page).toHaveURL(/\/hospitals\/fixture\/visits$/);
  await expect(page.getByRole("heading", { name: "My hospital visits" })).toBeVisible();
  await request.post(`${api}/__fixture/reset`, { data: {} });
  await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: "Token T001", exact: true })).toBeVisible();
});
test("branded hospital and verified custom host retain nested routes after reload", async ({ page }) => {
  for (const host of ["fixture.medipulse.live", "care.example.test"]) {
    await open(page, host, "/login"); await expect(page.getByRole("heading", { name: "Sign in as User", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "My visits", exact: true }).click(); await expect(page).toHaveURL(/\/visits$/);
    await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: "My hospital visits" })).toBeVisible();
    await page.getByRole("link", { name: "Hospital home", exact: true }).first().click(); await expect(page.getByRole("heading", { name: "Fixture Hospital", exact: true }).first()).toBeVisible();
  }
});
test("unknown, reserved and unclaimed hosts fail closed", async ({ page }) => {
  for (const host of ["missing.medipulse.live", "api.medipulse.live", "unclaimed.example.test"]) {
    await open(page, host, "/login"); await expect(page.getByRole("heading", { name: "Website unavailable", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome Back" })).toHaveCount(0);
  }
});
test("staff fallback remains available without subdomain DNS", async ({ page }) => {
  await page.goto("/hospital", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Hospital workspace" })).toBeVisible();
  await page.getByRole("link", { name: "Staff sign in", exact: true }).click(); await expect(page).toHaveURL(/\/hospital\/login$/);
  await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: "Sign in as Hospital Staff", exact: true })).toBeVisible();
});

test("Connect does not hydrate a staff workspace from a shared-origin staff session", async ({ page, request }) => {
  await request.post(`${api}/__fixture/reset`, { data: { nurse: true } });
  await page.goto("/connect", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "MediPulse Connect", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nursing Station", exact: true })).toHaveCount(0);
  await page.goto("/connect/hospital/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
});

test("hospital visit deep links select an owned family visit and hide missing tokens", async ({ page, request }) => {
  await request.post(`${api}/__fixture/reset`, { data: { secondToken: true } });
  await page.goto("/hospitals/fixture/visits", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Token T001", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Token T002", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open this visit", exact: true }).nth(1).click();
  await expect(page).toHaveURL(/\/visits\/000000000000000000000007$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Token T002", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Token T001", exact: true })).toHaveCount(0);
  await page.goto("/hospitals/fixture/visits/000000000000000000000099", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("No active visit found at this hospital.")).toBeVisible();
});

test("hospital booking uses the hospital context and opens its nested visit tracking", async ({ page, request }) => {
  await request.post(`${api}/__fixture/reset`, { data: {} });
  await page.goto("/hospitals/fixture", { waitUntil: "domcontentloaded" });
  const book = page.getByRole("button", { name: "Book with doctor", exact: true });
  await book.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Book OPD Token", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeHidden();
  await book.click();
  await page.getByRole("radio", { name: "Today’s hospital queue", exact: true }).check();
  await expect(page.getByText(/Consultation charges use demo credits; no real money is collected/)).toBeVisible();
  await page.getByRole("textbox", { name: "Reason for visit" }).fill("Synthetic routine follow-up");
  await page.getByRole("button", { name: "Confirm OPD Token", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByText("Token Confirmed!", { exact: true })).toBeVisible();
  await expect(page.getByText("Reserved — check in at reception to join the queue", { exact: true })).toBeVisible();
  const state = await (await request.get(`${api}/__fixture/state`)).json();
  expect(state.hospitalBooking.practiceType).toBe("hospital"); expect(state.hospitalBooking.visitMode).toBe("in_person");
  expect(state.hospitalBooking.hospitalId).toBe("000000000000000000000004");
  await page.getByRole("button", { name: "Track this hospital visit", exact: true }).click();
  await expect(page).toHaveURL(/\/hospitals\/fixture\/visits\/000000000000000000000003$/);
  await expect(page.getByRole("heading", { name: "Token T001", exact: true })).toBeVisible();
});

test("revoked hospital queue clears clinical UI and returns to independent practice", async ({ page, request }) => {
  await request.post(`${api}/__fixture/reset`, { data: { doctorSession: true } });
  await page.goto("/doctor/appointments", { waitUntil: "domcontentloaded" });
  const queue = page.getByRole("combobox", { name: "Care queue", exact: true });
  await queue.selectOption("independent:fixture"); await expect(queue).toHaveValue("independent:fixture");
  await request.post(`${api}/__fixture/reset`, { data: { doctorSession: true, revokeHospitalQueue: true } });
  await queue.selectOption("hospital:fixture");
  await expect(page.getByText("This hospital queue is unavailable. The independent practice has been selected.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Care queue", exact: true })).toHaveValue("independent:fixture");
  await expect(page.getByText("In-person visit: complete the consultation when care is finished.", { exact: true })).toHaveCount(0);
});

test("Connect hospital discovery opens the branded patient product across path and host contexts", async ({ page }) => {
  for (const source of ["http://127.0.0.1:15173/connect/hospitals", "http://connect.medipulse.live:15173/hospitals"]) {
    await page.goto(source, { waitUntil: "domcontentloaded" });
    const hospital = page.getByRole("link", { name: /Fixture Hospital/ });
    await hospital.focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/hospitals\/fixture$/);
    await expect(page.getByRole("heading", { name: "Fixture Hospital", exact: true }).first()).toBeVisible();
    await page.getByRole("link", { name: "My visits", exact: true }).click();
    await expect(page).toHaveURL(/\/hospitals\/fixture\/visits$/);
    await expect(page.getByRole("heading", { name: "My hospital visits", exact: true })).toBeVisible();
  }
});
