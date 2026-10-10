import { test, expect } from "@playwright/test";
const api = "http://127.0.0.1:19080";
test.beforeEach(async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { guest: true } });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && ["15173", "19080"].includes(url.port) ? route.continue() : route.abort();
  });
});
test("shells render at 360px, tablet and desktop without page overflow", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One project checks all responsive widths.");
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    for (const [name, path, state, heading] of [["company", "/", { guest: true }, /Better care\.\s*A clearer journey\./], ["connect", "/connect", { guest: true }, /Find your doctor\.\s*Stay connected\./], ["patient", "/hospitals/fixture/visits", {}, "My hospital visits"], ["staff", "/hospital/nursing-station", { nurse: true }, "Nursing Station"]]) {
      await request.post(api + "/__fixture/reset", { data: state });
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
      if (name === "patient") await expect(page.getByRole("heading", { name: "Token T001", exact: true })).toBeVisible();
      if (name === "staff") await expect(page.getByRole("button", { name: "Confirm arrival", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(name + "-" + width + ".png"), fullPage: true });
    }
  }
});
test("marketing navigation has keyboard skip and a responsive menu", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 }); await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Better care\.\s*A clearer journey\./ })).toBeVisible();
  await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.locator("#main-content")).toBeFocused();
  const toggle = page.getByRole("button", { name: "Toggle mobile menu", exact: true }); await toggle.focus(); await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "Mobile navigation", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("link", { name: "Find a hospital" }).focus(); await page.keyboard.press("Escape"); await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText(/Priya Sharma|Rahul Gupta|Anjali Singh|QR.code verification/)).toHaveCount(0);
});
test("branded patient actions have readable contrast and reduced motion", async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { brandColor: "#fde68a" } });
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/hospitals/fixture/visits", { waitUntil: "domcontentloaded" });
  const action = page.getByRole("link", { name: "Open this visit", exact: false }); await expect(action).toBeVisible();
  await expect(action).toHaveCSS("background-color", "rgb(253, 230, 138)"); await expect(action).toHaveCSS("color", "rgb(0, 0, 0)");
  await page.evaluate(() => document.documentElement.classList.add("dark")); await expect(action).toHaveCSS("color", "rgb(0, 0, 0)");
  expect(await page.locator(".mp-brand-mark").first().evaluate(node => getComputedStyle(node).color)).not.toBe("rgb(255, 255, 255)");
});
test("walk-in fields are labeled and validation prevents an invalid request", async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { nurse: true } }); await page.goto("/hospital/nursing-station", { waitUntil: "domcontentloaded" });
  const submit = page.getByRole("button", { name: "Issue Token", exact: true }); await expect(submit).toBeEnabled();
  await submit.focus(); await page.keyboard.press("Enter"); await expect(page.getByText("Enter the patient's name.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Patient name" })).toBeFocused();
  expect((await (await request.get(api + "/__fixture/state")).json()).issuedTokens || 0).toBe(0);
  await page.getByRole("textbox", { name: "Patient name" }).fill("Synthetic walk-in"); await submit.click();
  await expect(page.getByText("Walk-in token issued.", { exact: true })).toBeVisible();
  expect((await (await request.get(api + "/__fixture/state")).json()).issuedTokens).toBe(1);
});
test("vitals dialog traps keyboard focus, closes with Escape and restores the trigger", async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { nurse: true, checkedIn: true } }); await page.goto("/hospital/nursing-station", { waitUntil: "domcontentloaded" });
  const trigger = page.getByRole("button", { name: "Record Vitals", exact: true }); await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Record Vitals: T001", exact: true }); await expect(dialog).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Blood pressure", exact: true })).toBeFocused();
  for (let index = 0; index < 12; index++) { await page.keyboard.press("Tab"); expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await trigger.click(); await page.getByRole("textbox", { name: "Blood pressure", exact: true }).fill("120/80"); await page.getByRole("button", { name: "Save Vitals", exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.getByRole("table", { name: "Patients ready for consultation" })).toBeVisible();
  const state = await (await request.get(api + "/__fixture/state")).json(); expect(state.savedVitals.bp).toBe("120/80"); expect(state.savedVitals.temperature).toBeUndefined();
});
test("patient refresh failure has a retry state instead of a permanent spinner", async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { failVisits: true } }); await page.goto("/hospitals/fixture/visits", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("alert")).toContainText("Unable to refresh your visit.");
  await expect(page.getByText("Loading your visit...", { exact: true })).toHaveCount(0);
  await request.post(api + "/__fixture/reset", { data: {} }); await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Token T001", exact: true })).toBeVisible();
});

test("staff mobile navigation closes outside and restores focus with Escape", async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { nurse: true } });
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/hospital/nursing-station", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Nursing Station", exact: true })).toBeVisible();
  const toggle = page.getByRole("button", { name: "Toggle mobile menu", exact: true });
  await toggle.click(); await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("heading", { name: "Nursing Station", exact: true }).click(); await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click(); await page.locator("#care-mobile-navigation").getByRole("link", { name: "Staff Chat", exact: true }).focus();
  await page.keyboard.press("Escape"); await expect(toggle).toBeFocused(); await expect(toggle).toHaveAttribute("aria-expanded", "false");
});
