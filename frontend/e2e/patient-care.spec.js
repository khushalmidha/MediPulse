import { test, expect } from "@playwright/test";
import process from "node:process";
const api = "http://127.0.0.1:19080", browserApi = process.env.E2E_API_PROXY === "true" ? "http://127.0.0.1:15173/backend" : api;
const patientId = "000000000000000000000002", visitId = "000000000000000000000011", review = "/review?token=" + visitId + "&patient=" + patientId + "&sig=synthetic-signature";
const patch = (request, data) => request.post(api + "/__fixture/patch", { data });
const state = async request => (await (await request.get(api + "/__fixture/state")).json());
const label = (page, name) => page.getByLabel(name, { exact: true }).or(page.getByLabel(name + " *", { exact: true }));
const button = (page, name) => page.getByRole("button", { name, exact: true });
const open = (page, path) => page.goto(path, { waitUntil: "domcontentloaded" });
const heading = (page, name) => page.getByRole("heading", { name, exact: true });
const pageErrors = new WeakMap();
test.beforeEach(async ({ page, request }) => {
  const errors = []; pageErrors.set(page, errors); page.on("pageerror", error => errors.push(error.message));
  await request.post(api + "/__fixture/reset", { data: { patientCare: true, guest: false } });
  await page.route("**/*", route => { const url = new URL(route.request().url()); return url.hostname === "127.0.0.1" && ["15173", "19080"].includes(url.port) ? route.continue() : route.abort(); });
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

test("initial outages are recoverable and successful empty records are distinct", async ({ page, request }) => {
  await patch(request, { failHospitalSearch: true }); await open(page, "/hospitals"); await expect(button(page, "Retry hospitals")).toBeVisible(); await expect(heading(page, "No hospitals match this search")).toHaveCount(0);
  await patch(request, { failHospitalSearch: false }); await button(page, "Retry hospitals").click(); await expect(heading(page, "Fixture Hospital")).toBeVisible();
  await patch(request, { failPatientRecords: true }); await open(page, "/health-records"); await expect(button(page, "Retry records")).toBeVisible(); await expect(heading(page, "Your care timeline starts here")).toHaveCount(0); await expect(button(page, "Add family member")).toBeDisabled();
  await patch(request, { failPatientRecords: false, emptyPatient: true, patientFamily: [] }); await button(page, "Refresh records").click(); await expect(heading(page, "Your care timeline starts here")).toBeVisible(); await expect(heading(page, "No family profiles yet")).toBeVisible(); await expect(heading(page, "No hospital visits recorded")).toBeVisible();
  for (const status of [401, 404]) { await patch(request, { denyPatientRecords: status }); await page.reload({ waitUntil: "domcontentloaded" }); await expect(heading(page, "Record access unavailable")).toBeVisible(); }
});

test("pre-visit start recovers from failure, and offline routing and reviews do not post", async ({ page, request, context }) => {
  await patch(request, { failTriageStart: true }); await open(page, "/triage/" + visitId); await button(page, "Start questions").click(); await expect(page.getByText("Synthetic questions unavailable", { exact: true })).toBeVisible();
  await patch(request, { failTriageStart: false }); await button(page, "Start questions").click(); await expect(page.getByText("Synthetic first question", { exact: true })).toBeVisible();
  await open(page, "/smart-booking"); await label(page, "Symptoms and concerns").fill("Synthetic offline concern"); await context.setOffline(true); await expect(button(page, "Explore care options")).toBeDisabled(); expect((await state(request)).smartRequests || 0).toBe(0); await context.setOffline(false); await expect(label(page, "Symptoms and concerns")).toHaveValue("Synthetic offline concern");
  await open(page, review); await rate(page); await context.setOffline(true); await expect(button(page, "Submit review")).toBeDisabled(); expect((await state(request)).reviewRequests || 0).toBe(0); await context.setOffline(false);
});

test("patient pages gate guests and doctor accounts without fetching private records", async ({ page, request }) => {
  let reads = 0; page.on("request", req => { if (req.url().includes("/api/patients/me/")) reads++; });
  await patch(request, { guest: true }); await open(page, "/health-records"); await expect(heading(page, "Your patient account is needed")).toBeVisible(); expect(reads).toBe(0);
  await page.getByRole("link", { name: "Patient sign in", exact: true }).click(); await expect(page).toHaveURL(/returnTo=%2Fhealth-records/);
  await patch(request, { guest: false, doctorSession: true }); await open(page, "/health-records"); await expect(heading(page, "Your patient account is needed")).toBeVisible(); expect(reads).toBe(0);
});

test("hospital search retains URL filters, distinguishes outages and supports pagination", async ({ page, request }) => {
  await patch(request, { manyHospitals: true }); await open(page, "/hospitals"); await expect(heading(page, "Fixture Hospital 1")).toBeVisible();
  await button(page, "Next hospitals").click(); await expect(heading(page, "Fixture Hospital 13")).toBeVisible(); await expect(page).toHaveURL(/page=2/); await button(page, "Previous hospitals").click(); await expect(heading(page, "Fixture Hospital 1")).toBeVisible(); await expect(button(page, "Next hospitals")).toBeEnabled();
  await label(page, "City").fill("Missing City"); await button(page, "Search hospitals").click(); await expect(heading(page, "No hospitals match this search")).toBeVisible(); await expect(page).toHaveURL(/city=Missing\+City/);
  await button(page, "Clear filters").click(); await expect(heading(page, "Fixture Hospital 1")).toBeVisible();
  await label(page, "Hospital name").fill("Fixture"); await label(page, "City").fill("Fixture City"); await label(page, "Care system").selectOption("allopathic"); await button(page, "Search hospitals").click(); await expect(page).toHaveURL(/medicineSystem=allopathic/); await expect(heading(page, "Fixture Hospital 1")).toBeVisible();
  await patch(request, { failHospitalSearch: true }); await button(page, "Search hospitals").click(); await expect(page.getByText(/Previously loaded hospitals are shown/)).toBeVisible(); await expect(heading(page, "Fixture Hospital 1")).toBeVisible();
  await patch(request, { failHospitalSearch: false }); await button(page, "Retry hospitals").click(); await expect(button(page, "Retry hospitals")).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" }); await expect(label(page, "City")).toHaveValue("Fixture City"); await expect(page.getByText("No ratings yet").first()).toBeVisible();
});

test("hospital discovery retains the Connect context when opening the hospital product", async ({ page }) => {
  await open(page, "/connect/hospitals"); await page.getByRole("link", { name: "View Fixture Hospital", exact: true }).click(); await expect(page).toHaveURL(/\/hospitals\/fixture$/); await expect(heading(page, "Fixture Hospital")).toBeVisible();
});

test("records filter by person and type, preserve zero values and label drafts", async ({ page }) => {
  await open(page, "/health-records"); await expect(heading(page, "Synthetic hospital record")).toBeVisible(); await label(page, "Person").selectOption("self"); await expect(heading(page, "Synthetic hospital record")).toHaveCount(0); await expect(heading(page, "Synthetic online record")).toBeVisible(); await expect(page.getByText("Not recorded", { exact: true })).toBeVisible();
  await label(page, "Person").selectOption("000000000000000000000009"); await expect(heading(page, "Synthetic hospital record")).toBeVisible(); await expect(heading(page, "Synthetic online record")).toHaveCount(0);
  await button(page, "Open record: Synthetic hospital record").click(); const dialog = page.getByRole("dialog", { name: "Care record", exact: true }); await expect(dialog.getByText("Draft — clinician review needed", { exact: true })).toBeVisible(); await expect(dialog.getByText("This is an unconfirmed model output, not a diagnosis.", { exact: true })).toBeVisible(); await expect(dialog.getByText("0", { exact: true })).toBeVisible(); await page.keyboard.press("Escape"); await expect(button(page, "Open record: Synthetic hospital record")).toBeFocused();
  await label(page, "Person").selectOption("all"); await label(page, "Record type").selectOption("appointment"); await label(page, "Search records").fill("saved consultation"); await expect(heading(page, "Synthetic online record")).toBeVisible(); await button(page, "Open record: Synthetic online record").click();
  const download = page.waitForEvent("download"); await button(page, "Download draft text").click(); expect((await download).suggestedFilename()).toBe("medipulse-consultation-draft.txt");
  expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes("Synthetic saved consultation")))).toBe(false);
});

test("record errors are independent, stale data is explicit, and revoked access closes details", async ({ page, request }) => {
  await patch(request, { failVisitedHospitals: true }); await open(page, "/health-records"); await expect(button(page, "Retry visited hospitals")).toBeVisible(); await expect(heading(page, "Synthetic hospital record")).toBeVisible();
  await patch(request, { failVisitedHospitals: false, failPatientRecords: true }); await button(page, "Refresh records").click(); await expect(page.getByText(/Previously loaded records are shown/)).toBeVisible(); await button(page, "Open record: Synthetic hospital record").click(); await expect(page.getByRole("dialog", { name: "Care record" })).toBeVisible(); await page.keyboard.press("Escape");
  await patch(request, { failPatientRecords: false }); await button(page, "Refresh records").click(); await expect(button(page, "Retry records")).toHaveCount(0); await button(page, "Open record: Synthetic hospital record").click();
  await patch(request, { denyPatientRecords: 403 }); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await expect(heading(page, "Record access unavailable")).toBeVisible(); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByText("Synthetic assistant draft", { exact: true })).toHaveCount(0);
});

test("old account responses are discarded when the patient identity changes", async ({ page, request }) => {
  let release; await page.route(browserApi + "/api/patients/me/health-timeline", async route => { await new Promise(resolve => { release = resolve; }); await route.fulfill({ json: { items: [{ id: "old", type: "appointment", title: "OLD OWNER PRIVATE RECORD", status: "completed" }] } }); }, { times: 1 });
  await open(page, "/health-records"); await expect.poll(() => Boolean(release)).toBe(true);
  const next = { _id: "000000000000000000000099", firstName: "Second Synthetic", familyMembers: [] };
  await patch(request, { patientProfile: next, patientTitle: "NEW OWNER RECORD", patientFamily: [] }); await page.evaluate(result => window.dispatchEvent(new CustomEvent("medipulse:session", { detail: { scope: "account", payload: { role: "user", result } } })), next);
  await expect(heading(page, "NEW OWNER RECORD")).toBeVisible(); release(); await expect(page.getByText("OLD OWNER PRIVATE RECORD")).toHaveCount(0); await expect(page.getByText("Synthetic Child", { exact: true })).toHaveCount(0);
});

test("family saves preserve failed input, omit unknown values and prevent duplicate requests", async ({ page, request }) => {
  await patch(request, { failFamilySave: true }); await open(page, "/health-records"); await button(page, "Add family member").click(); await label(page, "Full name").fill("Synthetic Parent"); await label(page, "Relationship").fill("Parent"); await button(page, "Save family profile").click(); await expect(page.getByText("Synthetic family save outage", { exact: true })).toBeVisible(); await expect(label(page, "Full name")).toHaveValue("Synthetic Parent");
  await patch(request, { failFamilySave: false, patientMutationDelay: 400 }); await button(page, "Save family profile").evaluate(node => { node.form.requestSubmit(node); node.form.requestSubmit(node); }); await expect(button(page, "Saving profile...")).toBeDisabled(); await expect(page.getByRole("dialog")).toHaveCount(0);
  const result = await state(request); expect(result.familySaves).toBe(2); expect(result.familyPayload).toEqual({ name: "Synthetic Parent", relation: "Parent" }); await expect(page.locator(".mp-family-row strong").filter({ hasText: "Synthetic Parent" })).toBeVisible();
  await button(page, "Remove Synthetic Parent").click(); await page.keyboard.press("Escape"); await expect(button(page, "Remove Synthetic Parent")).toBeFocused();
  await patch(request, { failFamilyRemove: true }); await button(page, "Remove Synthetic Parent").click(); await button(page, "Remove profile").click(); await expect(page.getByText("Synthetic profile removal outage", { exact: true })).toBeVisible(); await expect(page.getByRole("dialog")).toBeVisible();
  await patch(request, { failFamilyRemove: false }); await button(page, "Remove profile").click(); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(button(page, "Remove Synthetic Parent")).toHaveCount(0);
});

test("records paginate and offline family changes are blocked", async ({ page, request, context }) => {
  await patch(request, { manyRecords: true }); await open(page, "/health-records"); await expect(heading(page, "Synthetic record 0")).toBeVisible(); await expect(heading(page, "Synthetic record 8")).toHaveCount(0); await button(page, "Next records").click(); await expect(heading(page, "Synthetic record 8")).toBeVisible(); await expect(heading(page, "Synthetic record 0")).toHaveCount(0);
  await context.setOffline(true); await expect(button(page, "Add family member")).toBeDisabled(); await expect(button(page, "Remove Synthetic Child")).toBeDisabled(); expect((await state(request)).familySaves || 0).toBe(0); await context.setOffline(false);
});

test("triage keeps failed answers and saves only a clinician-review draft", async ({ page, request }) => {
  await open(page, "/triage/" + visitId); await label(page, "Question language").selectOption("Hindi"); await button(page, "Start questions").click(); await expect(page.getByText("Synthetic first question", { exact: true })).toBeVisible(); expect((await state(request)).triageLanguage).toBe("Hindi");
  await patch(request, { failTriageSend: true }); await label(page, "Your answer").fill("Synthetic answer"); await button(page, "Send answer").click(); await expect(page.getByText("Synthetic reply unavailable", { exact: true })).toBeVisible(); await expect(label(page, "Your answer")).toHaveValue("Synthetic answer");
  await patch(request, { failTriageSend: false, patientMutationDelay: 400, failTriageComplete: true }); await button(page, "Send answer").evaluate(node => { node.form.requestSubmit(node); node.form.requestSubmit(node); }); await expect(button(page, "Save draft for my doctor")).toBeVisible(); expect((await state(request)).triageMessages).toBe(2);
  await button(page, "Save draft for my doctor").click(); await expect(page.getByText("Synthetic draft save unavailable", { exact: true })).toBeVisible(); await expect(page.getByRole("log")).toBeVisible(); await patch(request, { failTriageComplete: false }); await button(page, "Save draft for my doctor").click(); await expect(page.getByText("Draft saved to your visit", { exact: true })).toBeVisible(); await expect(page.getByText("Draft — clinician review needed", { exact: true })).toBeVisible();
});

test("triage denial hides prior conversation and offline answers remain unsent", async ({ page, request, context }) => {
  await open(page, "/triage/" + visitId); await button(page, "Start questions").click(); await label(page, "Your answer").fill("Synthetic private answer"); await context.setOffline(true); await expect(button(page, "Send answer")).toBeDisabled(); await expect(label(page, "Your answer")).toHaveValue("Synthetic private answer"); await context.setOffline(false);
  await patch(request, { denyTriage: 403 }); await button(page, "Send answer").click(); await expect(heading(page, "Pre-visit questions are unavailable")).toBeVisible(); await expect(page.getByRole("log")).toHaveCount(0); await expect(label(page, "Your answer")).toHaveCount(0);
});

test("symptom routing retains errors, labels demo fees, and suppresses urgent booking", async ({ page, request }) => {
  await patch(request, { failSmart: true }); await open(page, "/smart-booking"); await label(page, "Symptoms and concerns").fill("Synthetic concern"); await button(page, "Explore care options").click(); await expect(page.getByText("Synthetic routing unavailable", { exact: true })).toBeVisible(); await expect(label(page, "Symptoms and concerns")).toHaveValue("Synthetic concern");
  await patch(request, { failSmart: false }); await button(page, "Explore care options").click(); await expect(page.getByText("Draft — clinician review needed", { exact: true })).toBeVisible(); await expect(page.getByText("0 years of recorded experience", { exact: true })).toBeVisible(); await expect(page.getByText("Listed fee in demo credits", { exact: true })).toBeVisible(); await expect(page.getByRole("link", { name: "See availability", exact: true })).toBeVisible();
  await button(page, "Edit my symptoms").click(); await expect(label(page, "Symptoms and concerns")).toHaveValue("Synthetic concern"); await patch(request, { urgentRouting: true }); await button(page, "Explore care options").click(); await expect(page.getByText("Booking through MediPulse does not provide emergency care.", { exact: true })).toBeVisible(); await expect(page.getByRole("link", { name: "See availability", exact: true })).toHaveCount(0);
  await button(page, "Edit my symptoms").click(); await patch(request, { urgentRouting: false, noRoutingProfiles: true }); await button(page, "Explore care options").click(); await expect(heading(page, "No doctor profiles were returned")).toBeVisible(); await expect(page.getByText("This result does not confirm that no care is available.", { exact: true })).toBeVisible();
});

const rate = async page => { for (const name of ["Doctor quality", "Staff behavior", "Value for money", "Wait time", "Cleanliness"]) await page.getByRole("radio", { name: name + " 3 out of 5", exact: true }).check(); };
test("reviews require explicit ratings and retain failed drafts without duplicate posts", async ({ page, request }) => {
  await open(page, "/review"); await expect(heading(page, "A valid visit review link is needed")).toBeVisible(); expect((await state(request)).reviewRequests || 0).toBe(0);
  await patch(request, { failPatientReview: true }); await open(page, review); await expect(page.locator('input[type="radio"]:checked')).toHaveCount(0); await button(page, "Submit review").click(); expect((await state(request)).reviewRequests || 0).toBe(0);
  await rate(page); await label(page, "Visit feedback (optional)").fill("Synthetic experience comment"); await label(page, "Hide my name on the public review").check(); await button(page, "Submit review").click(); await expect(page.getByText("Synthetic review submission outage", { exact: true })).toBeVisible(); await expect(label(page, "Visit feedback (optional)")).toHaveValue("Synthetic experience comment"); await expect(page.locator('input[type="radio"]:checked')).toHaveCount(5);
  await patch(request, { failPatientReview: false, patientMutationDelay: 400 }); await button(page, "Submit review").evaluate(node => { node.form.requestSubmit(node); node.form.requestSubmit(node); }); await expect(heading(page, "Thank you for sharing your experience")).toBeVisible(); const result = await state(request); expect(result.reviewRequests).toBe(2); expect(result.reviewPayload.overallRating).toBe(3); expect(result.reviewPayload.isAnonymous).toBe(true);
});

test("review replay, wrong owner and hospital context use truthful recovery paths", async ({ page, request }) => {
  await open(page, review.replace(patientId, "000000000000000000000099")); await expect(page.getByText("Sign in with the patient account this review link belongs to.", { exact: true })).toBeVisible(); expect((await state(request)).reviewRequests || 0).toBe(0);
  await patch(request, { existingPatientReview: true }); await open(page, "/hospitals/fixture" + review); await rate(page); await button(page, "Submit review").click(); await expect(heading(page, "This visit already has a review")).toBeVisible(); await page.getByRole("link", { name: "Return to my appointments", exact: true }).click(); await expect(page).toHaveURL(/\/hospitals\/fixture\/visits$/);
  await patch(request, { existingPatientReview: false, invalidPatientReview: true }); await open(page, review); await rate(page); await button(page, "Submit review").click(); await expect(heading(page, "A valid visit review link is needed")).toBeVisible(); await expect(page.getByRole("radio")).toHaveCount(0);
});

test("patient routes fit mobile, tablet and desktop and support dark theme", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "One sweep covers all widths.");
  for (const width of [360, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); for (const [name, path, title] of [["records", "/health-records", "Health Records"], ["hospitals", "/hospitals", "Find a Hospital"], ["triage", "/triage/" + visitId, "Pre-visit questions"], ["symptoms", "/smart-booking", "Symptom guide"], ["review", review, "Rate your hospital visit"]]) {
    await open(page, path); await expect(heading(page, title)).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: info.outputPath(name + "-" + width + ".png"), fullPage: true });
  } }
  await button(page, "Use dark theme").click(); await expect(button(page, "Use light theme")).toBeVisible(); await page.screenshot({ path: info.outputPath("review-dark.png"), fullPage: true });
  const radio = page.getByRole("radio", { name: "Doctor quality 1 out of 5", exact: true }); await radio.focus(); await page.keyboard.press("ArrowRight"); await expect(page.getByRole("radio", { name: "Doctor quality 2 out of 5", exact: true })).toBeChecked();
});
