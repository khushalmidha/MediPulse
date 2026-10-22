import { test, expect } from "@playwright/test";
import process from "node:process";
const api = "http://127.0.0.1:19080";
const browserApi = process.env.E2E_API_PROXY === "true" ? "http://127.0.0.1:15173/backend" : api;
const readOnly = { success: true, wards: [], rooms: [], beds: [], cases: [], triages: [], theatreCases: [], invoices: [], tariffs: [], grns: [], stock: [], requisitions: [], preAuths: [], contracts: [], profile: null, audits: [], report: null, logs: [], studies: [], handovers: [] };
const errors = new WeakMap();
test.beforeEach(async ({ page, request }) => {
  const list = []; errors.set(page, list); page.on("pageerror", error => list.push(error.message));
  await request.post(api + "/__fixture/reset", { data: { nurse: true, staffRole: "HOSPITAL_ADMIN", staffAdminAccess: true } });
  await page.route("**/*", route => { const u = new URL(route.request().url()); return u.hostname === "127.0.0.1" && ["15173", "19080"].includes(u.port) ? route.continue() : route.abort(); });
  await page.route(/\/api\/(inpatient|nursing|emergency|theatre|revenue|procurement|integrations|enterprise)\//, route => route.fulfill({ status: route.request().method() === "GET" ? 200 : 405, json: readOnly }));
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

test("enterprise review: new consoles fit viewports and use the shared theme", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "Desktop sweep covers all viewport widths");
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/hospital/inpatient", "/hospital/emergency", "/hospital/revenue", "/hospital/integrations"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main").last()).toBeVisible();
      await expect(page.locator("main h1").last()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${path} at ${width}`).toBe(true);
    }
  }
  await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use light theme", exact: true })).toBeVisible();
});

test("enterprise review: denied reload removes contracts and shows the server reason", async ({ page }) => {
  let denied = false;
  await page.route(browserApi + "/api/integrations/contracts", route => route.fulfill({ status: denied ? 403 : 200, json: denied ? { message: "Synthetic integration permission revoked" } : { success: true, contracts: [{ _id: "synthetic", interfaceType: "LIS_HL7", contractVersion: "fixture", endpointUrl: "https://SYNTHETIC-CONTRACT.invalid", status: "configured" }] } }));
  await page.goto("/hospital/integrations", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("https://SYNTHETIC-CONTRACT.invalid", { exact: true })).toBeVisible();
  denied = true; await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Synthetic integration permission revoked", { exact: true })).toBeVisible();
  await expect(page.getByText("https://SYNTHETIC-CONTRACT.invalid", { exact: true })).toHaveCount(0);
});

test("enterprise review: nurse opens imaging without administrative integration reads", async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { nurse: true, staffRole: "NURSE" } });
  const paths = []; page.on("request", req => { if (req.url().includes("/api/integrations/")) paths.push(req.url()); });
  await page.goto("/hospital/integrations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "PACS / DICOM Diagnostic Studies" })).toBeVisible();
  await expect.poll(() => paths.length).toBeGreaterThan(0);
  expect(paths.every(path => path.includes("/pacs/"))).toBe(true);
  await expect(page.getByRole("button", { name: "Interface Contracts", exact: true })).toHaveCount(0);
});


test("enterprise review: cookie writes use staff CSRF and receipt retry retains its command identity", async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { nurse: true, staffRole: "LAB_TECH" } });
  const packets = [];
  await page.route(browserApi + "/api/integrations/lis/inbound", async route => {
    packets.push({ data: route.request().postDataJSON(), csrf: route.request().headers()["x-csrf-token"] });
    await route.fulfill({ status: packets.length === 1 ? 503 : 201, json: packets.length === 1 ? { message: "Synthetic receipt outage; retry safely" } : { success: true, status: "received", processingImplemented: false } });
  });
  await page.goto("/hospital/lis", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Record LIS Receipt", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Record LIS Receipt" });
  await dialog.getByLabel(/^Accession Number/).fill("SYNTHETIC-ACCESSION");
  await dialog.getByLabel(/^Message Payload/).fill('{"sample":"synthetic"}');
  await dialog.getByRole("button", { name: "Ingest Message", exact: true }).click();
  await expect(dialog.getByText("Synthetic receipt outage; retry safely", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Ingest Message", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(packets).toHaveLength(2);
  expect(packets.every(packet => packet.csrf === "fixture-staff-csrf")).toBe(true);
  expect(packets[0].data.messageControlId).toBeTruthy();
  expect(packets[1].data).toEqual(packets[0].data);
  await expect(page.getByText(/recorded.*Clinical processing is not active/)).toBeVisible();
});
