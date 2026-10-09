import { test, expect } from "@playwright/test";
const api = "http://127.0.0.1:19080", booking = "/appointment/book/000000000000000000000001";
const protect = async context => context.route("**/*", route => {
  const url = new URL(route.request().url());
  return url.hostname === "127.0.0.1" && ["15173", "19080"].includes(url.port) ? route.continue() : route.abort();
});
const remoteLive = page => page.locator("video").first().evaluate(video => Boolean(video.srcObject?.getVideoTracks().some(track => track.readyState === "live") && video.videoWidth > 0));
test("both participants exchange real media, recover doctor disconnect, leave/rejoin and end once", async ({ browser, request }, info) => {
  await request.post(`${api}/__fixture/reset`, { data: { callMode: true } });
  const options = { baseURL: "http://127.0.0.1:15173", viewport: info.project.use.viewport, permissions: ["camera", "microphone"] };
  const doctor = await browser.newContext(options), patient = await browser.newContext(options);
  try {
    await protect(doctor); await protect(patient);
    await doctor.addCookies([{ name: "fixtureRole", value: "doctor", url: "http://127.0.0.1:15173", httpOnly: true }]);
    const doc = await doctor.newPage(), user = await patient.newPage();
    await doc.goto("/doctor/appointments", { waitUntil: "domcontentloaded" }); await user.goto(booking, { waitUntil: "domcontentloaded" });
    await expect(doc.getByText("Connected", { exact: true })).toBeVisible(); await expect(user.getByText("Connected", { exact: true })).toBeVisible();
    await expect.poll(() => remoteLive(doc)).toBe(true); await expect.poll(() => remoteLive(user)).toBe(true);
    const connections = (await (await request.get(`${api}/__fixture/state`)).json()).doctorConnections;
    await request.post(`${api}/__fixture/disconnect-doctor`);
    await expect.poll(async () => (await (await request.get(`${api}/__fixture/state`)).json()).doctorConnections).toBeGreaterThan(connections);
    await expect.poll(() => remoteLive(doc)).toBe(true); await expect.poll(() => remoteLive(user)).toBe(true);
    expect((await (await request.get(`${api}/__fixture/state`)).json()).callEnded).toBeFalsy();
    await user.locator("video").nth(1).evaluate(video => { window.fixtureLocalTracks = video.srcObject.getTracks(); });
    if (info.project.name === "mobile") {
      for (const page of [doc, user]) {
        await page.setViewportSize({ width: 360, height: 800 });
        const mute = page.getByTitle("Mute", { exact: true }); await mute.scrollIntoViewIfNeeded();
        await expect(mute).toBeInViewport({ ratio: 1 }); await expect(page.getByTitle("Turn off camera", { exact: true })).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      }
    }
    const leave = user.getByRole("button", { name: "Leave call", exact: true }); await leave.focus(); await user.keyboard.press("Enter");
    expect(await user.evaluate(() => window.fixtureLocalTracks.every(track => track.readyState === "ended"))).toBe(true);
    const rejoin = user.getByRole("button", { name: "Rejoin call" }); await expect(rejoin).toBeVisible(); await rejoin.focus(); await user.keyboard.press("Enter");
    await expect(user.getByText("Connected", { exact: true })).toBeVisible(); await expect.poll(() => remoteLive(user)).toBe(true);
    const end = doc.getByRole("button", { name: "End consultation", exact: true }); await end.focus(); await doc.keyboard.press("Enter");
    await expect(doc.locator("video")).toHaveCount(0); await expect(user.locator("video")).toHaveCount(0);
    expect((await (await request.get(`${api}/__fixture/state`)).json()).ends).toBe(1);
    expect(await user.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  } finally { await doctor.close(); await patient.close(); }
});
test("denied devices show a truthful permission error and keyboard retry", async ({ browser, request }, info) => {
  await request.post(`${api}/__fixture/reset`, { data: { callMode: true } });
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:15173", viewport: info.project.use.viewport });
  try {
    await protect(context);
    await context.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Denied", "NotAllowedError"); }; });
    const page = await context.newPage(); await page.goto(booking, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("alert")).toContainText("Microphone access is required");
    const retry = page.getByRole("button", { name: "Retry call" }); await retry.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Microphone access is required");
    expect((await (await request.get(`${api}/__fixture/state`)).json()).callEnded).toBeFalsy();
  } finally { await context.close(); }
});

test("camera denial falls back to real microphone audio without a fabricated video stream", async ({ browser, request }, info) => {
  await request.post(`${api}/__fixture/reset`, { data: { callMode: true } });
  const options = { baseURL: "http://127.0.0.1:15173", viewport: info.project.use.viewport, permissions: ["camera", "microphone"] };
  const doctor = await browser.newContext(options), patient = await browser.newContext(options);
  try {
    await protect(doctor); await protect(patient);
    await doctor.addCookies([{ name: "fixtureRole", value: "doctor", url: "http://127.0.0.1:15173", httpOnly: true }]);
    await patient.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = constraints => constraints.video ? Promise.reject(new DOMException("Camera denied", "NotAllowedError")) : original(constraints);
    });
    const doc = await doctor.newPage(), user = await patient.newPage();
    await doc.goto("/doctor/appointments", { waitUntil: "domcontentloaded" }); await user.goto(booking, { waitUntil: "domcontentloaded" });
    await expect(user.getByText("Camera unavailable. Connected with audio only.")).toBeVisible();
    await expect(doc.getByText("Connected", { exact: true })).toBeVisible(); await expect(user.getByText("Connected", { exact: true })).toBeVisible();
    expect(await user.locator("video").nth(1).evaluate(video => video.srcObject.getVideoTracks().length)).toBe(0);
    expect(await doc.locator("video").first().evaluate(video => video.srcObject.getAudioTracks().length)).toBeGreaterThan(0);
    await doc.getByRole("button", { name: "End consultation", exact: true }).click();
    await expect(user.locator("video")).toHaveCount(0);
  } finally { await doctor.close(); await patient.close(); }
});
