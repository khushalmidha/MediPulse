import { test, expect } from "@playwright/test";
const api = "http://127.0.0.1:19080";
const doctor = { _id: "000000000000000000000003", firstName: "Dr. Dr. Naresh", lastName: "Gupta", experience: { expertise: "General Medicine", years: 5 } };
test.beforeEach(async ({ page, request }, testInfo) => {
  page.on("pageerror", error => testInfo.attach("browser-error", { body: error.message, contentType: "text/plain" }));
  await request.post(api + "/__fixture/reset", { data: { communitySummary: true } });
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/doctor", route => route.fulfill({ json: { items: [doctor] } }));
  await page.route("**/event?**", route => route.fulfill({ json: { events: [] } }));
  await page.route("https://**/*", route => route.abort());
});
test("dashboard and assistant share semantic colors, fit 360/768/1440 and normalize doctor names", async ({ page }, testInfo) => {
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard"); await expect(page.getByRole("heading", { name: "Welcome back, Fixture" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dr. Naresh Gupta", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const dark of [false,true]) {
      await page.evaluate(value => document.documentElement.classList.toggle("dark",value), dark);
      const colors = await page.locator(".mp-dashboard-welcome").evaluate(el => {
        const probe=document.createElement("span"); probe.style.backgroundColor="var(--mp-accent-soft)"; el.append(probe);
        const result={background:getComputedStyle(el).backgroundColor,expected:getComputedStyle(probe).backgroundColor}; probe.remove(); return result;
      });
      expect(colors.background).toBe(colors.expected);
      await page.getByRole("button", { name: "Open MediPulse assistant" }).click();
      const panel = page.getByRole("dialog", { name: "MediPulse Assistant" }); await expect(panel).toBeVisible();
      const box = await panel.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y).toBeGreaterThanOrEqual(0);
      await page.screenshot({ path: testInfo.outputPath(`dashboard-${width}-${dark ? "dark" : "light"}.png`) });
      await page.keyboard.press("Escape"); await expect(panel).not.toBeVisible(); await expect(page.getByRole("button", { name: "Open MediPulse assistant" })).toBeFocused();
    }
  }
});
test("assistant searches actual directory cards without model calls or invented matches", async ({ page }) => {
  let modelCalls=0; page.on("request", req => { if (req.url().includes("/gemini/")) modelCalls++; });
  await page.goto("/dashboard"); await page.getByRole("button", { name: "Open MediPulse assistant" }).click();
  const panel=page.getByRole("dialog", { name:"MediPulse Assistant" });
  await panel.getByRole("button", { name:"Doctors", exact:true }).click(); await panel.getByLabel("Doctors search").fill("Naresh");
  await expect.poll(async () => page.locator(".mp-assistant-panel").evaluate(() => window.performance.getEntriesByType("resource").some(entry => entry.name.endsWith("/doctor")))).toBe(true);
  await panel.getByRole("button", {name:"Send assistant message"}).click(); await expect(panel.getByText("Dr. Naresh Gupta",{exact:true})).toBeVisible();
  await panel.getByLabel("Doctors search").fill("NoSuchSpecialty"); await panel.getByRole("button", {name:"Send assistant message"}).click();
  await expect(panel.getByText(/No matches in this directory preview/)).toBeVisible(); expect(modelCalls).toBe(0);
});
test("community leave dialog supports Escape and restores keyboard focus", async ({ page }) => {
  await page.goto("/dashboard"); await page.getByRole("button",{name:"Leave",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Leave community",exact:true})).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog",{name:"Leave community",exact:true})).not.toBeVisible();
  await expect(page.getByRole("button",{name:"Leave",exact:true})).toBeFocused();
});
test("switching accounts disposes the assistant conversation", async ({ page }) => {
  await page.goto("/dashboard"); await page.getByRole("button", { name: "Open MediPulse assistant" }).click();
  let panel = page.getByRole("dialog", { name: "MediPulse Assistant" });
  await panel.getByRole("button", { name: "Doctors", exact: true }).click();
  await panel.getByLabel("Doctors search").fill("Previous account query");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("medipulse:session", { detail: { scope: "account", payload: { role: "user", result: { _id: "000000000000000000000099", firstName: "Another", lastName: "Fixture" } } } })));
  await expect(page.getByRole("heading", { name: "Welcome back, Another" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "MediPulse Assistant" })).not.toBeVisible();
  await page.getByRole("button", { name: "Open MediPulse assistant" }).click();
  panel = page.getByRole("dialog", { name: "MediPulse Assistant" });
  await expect(panel.getByLabel("Hospitals search")).toHaveValue("");
  await expect(panel.getByText("Previous account query")).toHaveCount(0);
});
test("failed AI requests preserve input and show unavailable rather than success", async ({ page }) => {
  await page.route("**/gemini/chat", route => route.fulfill({ status: 503, json: { message: "Synthetic provider outage" } }));
  await page.goto("/dashboard"); await page.getByRole("button", { name: "Open MediPulse assistant" }).click();
  const panel = page.getByRole("dialog", { name: "MediPulse Assistant" });
  await panel.getByRole("button", { name: "General AI information", exact: true }).click();
  await panel.getByLabel("General AI information search").fill("Synthetic general question");
  await panel.getByRole("button", { name: "Send assistant message" }).click();
  await expect(panel.getByText(/AI information is unavailable/)).toBeVisible();
  await expect(panel.getByLabel("General AI information search")).toHaveValue("Synthetic general question");
  await expect(panel.getByRole("button", { name: "Send assistant message" })).toBeEnabled();
});
