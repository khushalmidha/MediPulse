import { test, expect } from "@playwright/test";
const api = "http://127.0.0.1:19080";
test.beforeEach(async ({ page, request }) => {
  await request.post(`${api}/__fixture/reset`, { data: {} });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && ["15173", "19080"].includes(url.port) ? route.continue() : route.abort();
  });
});
test("landing leaves operational routes unloaded and a deep link loads its own page", async ({ page }) => {
  const modules = [];
  page.on("request", request => modules.push(new URL(request.url()).pathname));
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: /Better care/ })).toBeVisible();
  expect(modules.filter(path => /\/pages\/(?:hospital-staff\/|HospitalAdminDashboard|DoctorAppointments|PatientHealthPortal)/.test(path))).toEqual([]);
  await page.goto("/my-appointments", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "My appointments", exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "My appointments", exact: true })).toBeVisible();
});
test("a failed route import offers focused keyboard recovery without repeating a mutation", async ({ page, request }) => {
  let refuse = true;
  await page.route("**/src/pages/Doctors.jsx*", route => {
    if (refuse) { refuse = false; return route.abort("failed"); }
    return route.continue();
  });
  await page.goto("/doctors", { waitUntil: "domcontentloaded" });
  const heading = page.getByRole("heading", { name: "This page could not load" });
  await expect(heading).toBeVisible(); await expect(heading).toBeFocused();
  const reload = page.getByRole("button", { name: "Reload page", exact: true });
  await reload.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Connect Doctor", exact: true })).toBeVisible();
  expect((await (await request.get(`${api}/__fixture/state`)).json()).bookings).toBe(0);
});
