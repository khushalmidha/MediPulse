import { test, expect } from "@playwright/test";
const api = "http://127.0.0.1:19080", path = "/hospital/pharmacy";
const state = async request => (await (await request.get(api + "/__fixture/state")).json());
const patch = (request, data) => request.post(api + "/__fixture/patch", { data });
test.beforeEach(async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { pharmacy: true, nurse: true, staffRole: "PHARMACIST" } });
  await page.route("**/*", route => { const url = new URL(route.request().url()); return url.hostname === "127.0.0.1" && ["15173", "19080"].includes(url.port) ? route.continue() : route.abort(); });
});
const openFill = async page => { await page.getByRole("button", { name: "Dispense Medication", exact: true }).click(); await page.getByLabel("Quantity to Dispense", { exact: true }).first().fill("2"); };

test("patient and unassigned staff cannot hydrate the pharmacy workspace", async ({ page, request }) => {
  for (const data of [{ nurse: false }, { nurse: true, staffRole: "NURSE" }]) {
    await patch(request, data); await page.goto(path);
    await expect(page.getByRole("heading", { name: "Hospital pharmacy access is needed" })).toBeVisible();
  }
  expect((await state(request)).pharmacyReads || 0).toBe(0);
});

test("partial dispensing skips zero rows, closes on success and records the actual batch", async ({ page, request }) => {
  await page.goto(path); await openFill(page);
  await page.getByRole("button", { name: "Confirm Dispensing", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible(); await expect(page.getByText("Dispensing recorded", { exact: true })).toBeVisible();
  await expect(page.getByText("Held: 2 / 6 · Returned: 0", { exact: true })).toBeVisible();
  await expect(page.getByText("Dispensed: SYN-BATCH × 2", { exact: true })).toBeVisible();
  await expect(page.getByText(/Prescribed by: Dr\. Synthetic Clinician/)).toBeVisible();
  const saved = await state(request); expect(saved.pharmacyRequests).toHaveLength(1); expect(saved.pharmacyRequests[0].body.items).toHaveLength(1);
  expect(saved.pharmacyRequests[0].body.expectedRevision).toBe(0); expect(saved.pharmacyRecord.status).toBe("partially_dispensed");
});

test("a lost response survives reload and retries the identical saved command once", async ({ page, request }) => {
  await patch(request, { pharmacyLoseResponse: true }); await page.goto(path); await openFill(page);
  await page.getByRole("button", { name: "Confirm Dispensing", exact: true }).click();
  await expect(page.getByText(/The response was not confirmed/)).toBeVisible();
  await expect(page.getByLabel("Quantity to Dispense", { exact: true }).first()).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload(); await expect(page.getByRole("button", { name: "Dispense Medication", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Resume operation", exact: true }).click();
  await expect(page.getByText(/Saved dispensing quantities: 2/)).toBeVisible();
  await page.getByRole("button", { name: "Retry Same Dispensing", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const saved = await state(request); expect(saved.pharmacyRequests).toHaveLength(2); expect(saved.pharmacyRequests[0]).toEqual(saved.pharmacyRequests[1]);
  expect(saved.pharmacyAvailable).toBe(8); expect(saved.pharmacyRecord.fulfillmentOperations).toHaveLength(1);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("medipulse.pharmacy.pending")).length)).toBe(0);
});

test("returns select an original batch allocation and increase quarantine only", async ({ page, request }) => {
  await page.goto(path); await openFill(page); await page.getByRole("button", { name: "Confirm Dispensing", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible(); await page.getByRole("button", { name: "Process Return", exact: true }).click();
  await page.getByLabel("Mandatory Reason for Return").fill("Synthetic return for reviewed disposal");
  await page.getByLabel("Return quantity for Synthetic Medication, batch SYN-BATCH").fill("1");
  await page.getByRole("button", { name: "Confirm Return", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible(); await expect(page.getByText("Medication return recorded in quarantine", { exact: true })).toBeVisible();
  const saved = await state(request); expect(saved.pharmacyRequests[1].body.items[0].allocationId).toBeTruthy();
  expect(saved.pharmacyAvailable).toBe(8); expect(saved.pharmacyQuarantined).toBe(1);
  await expect(page.getByText("Returned to quarantine: SYN-BATCH × 1", { exact: true })).toBeVisible();
});

test("a stale command shows the server conflict and clears the rejected pending command", async ({ page, request }) => {
  await patch(request, { pharmacyStale: true }); await page.goto(path); await openFill(page);
  await page.getByRole("button", { name: "Confirm Dispensing", exact: true }).click();
  await expect(page.getByText("Prescription changed; refresh before starting another operation", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).not.toBeVisible();
  expect((await state(request)).pharmacyRecord.fulfillmentOperations).toHaveLength(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("medipulse.pharmacy.pending")).length)).toBe(0);
});

test("unavailable pending-command storage prevents sending a stock mutation", async ({ page, request }) => {
  await page.addInitScript(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith("medipulse.pharmacy.pending")) throw new Error("Synthetic unavailable storage"); return original.call(this, key, value); }; });
  await page.goto(path); await openFill(page); await page.getByRole("button", { name: "Confirm Dispensing", exact: true }).click();
  await expect(page.getByText(/Session storage is unavailable\. This operation was not sent/)).toBeVisible();
  expect((await state(request)).pharmacyRequests || []).toHaveLength(0);
});

for (const theme of ["light", "dark"]) test(`pharmacy dialogs fit mobile/tablet/desktop with keyboard focus in ${theme}`, async ({ page }, testInfo) => {
  await page.addInitScript(themeValue => localStorage.setItem("theme", themeValue), theme);
  for (const width of [360,768,1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(path);
    await expect(page.getByRole("heading", { name: "Hospital Pharmacy Operations" })).toBeVisible();
    const nameBounds = await page.getByRole("heading", { name: "Synthetic Pharmacy Patient", exact: true }).boundingBox();
    expect(nameBounds.width).toBeGreaterThan(140); expect(nameBounds.height).toBeLessThan(70);
    await openFill(page); await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Dispense Medication", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(theme === "dark");
    if ((width === 360 && theme === "dark") || (width === 1440 && theme === "light")) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: testInfo.outputPath(`pharmacy-${theme}-${width}.png`), fullPage: true }); }
  }
});
