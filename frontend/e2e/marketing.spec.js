import { test, expect } from "@playwright/test";
const api = "http://127.0.0.1:19080";
test.beforeEach(async ({ page, request }) => {
  await request.post(api + "/__fixture/reset", { data: { guest: true } });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && ["15173", "19080"].includes(url.port) ? route.continue() : route.abort();
  });
});
test("product pages render at three widths and in dark mode without overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One project performs the viewport sweep.");
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    for (const [name, path, heading] of [["company", "/", /Better care\.\s*A clearer journey\./], ["connect", "/connect", /Find your doctor\.\s*Stay connected\./], ["hospital", "/hospital", /A calmer OPD\.\s*A connected hospital\./]]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText("Product illustration · no patient data or live availability", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true });
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("color", "rgb(237, 245, 244)");
      await page.screenshot({ path: testInfo.outputPath(`${name}-${width}-dark.png`), fullPage: true });
    }
  }
});
test("company hospital action opens the dedicated product", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const action = page.getByRole("link", { name: "For hospitals", exact: true });
  await action.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/hospital$/);
  await expect(page.getByRole("heading", { level: 1, name: /A calmer OPD/ })).toBeVisible();
});
test("Connect search uses the actual discovery route and preserves encoded input", async ({ page }) => {
  await page.goto("/connect", { waitUntil: "domcontentloaded" });
  await page.getByRole("searchbox", { name: "Search by doctor, specialty or clinic", exact: true }).fill("Skin & hair / care");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/connect\/doctors\?specialty=Skin%20%26%20hair%20%2F%20care$/);
  await expect(page.getByRole("textbox", { name: "Search doctors", exact: true })).toHaveValue("Skin & hair / care");
});
test("specialty discovery retains the Connect care context", async ({ page }) => {
  await page.goto("/connect", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Skin & hair", exact: true }).click();
  await expect(page).toHaveURL(/\/connect\/doctors\?specialty=Dermatology$/);
  await expect(page.getByRole("textbox", { name: "Search doctors", exact: true })).toHaveValue("Dermatology");
});
test("doctor onboarding retains the Connect signup context", async ({ page }) => {
  await page.goto("/connect", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Join as a doctor", exact: true }).click();
  await expect(page).toHaveURL(/\/connect\/signup\/doctor$/);
  await expect(page.getByRole("textbox", { name: /First name/i })).toBeVisible();
});
test("hospital product distinguishes planned expansion from current OPD", async ({ page }) => {
  await page.goto("/hospital", { waitUntil: "domcontentloaded" });
  const roadmap = page.getByRole("region", { name: /A focused start/ });
  await expect(roadmap.getByText("Planned", { exact: true })).toHaveCount(2);
  await expect(roadmap.getByText("Current core", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Register a hospital", exact: true }).click();
  await expect(page).toHaveURL(/\/hospital\/signup$/);
  await expect(page.getByRole("heading", { name: "Create Hospital Admin Portal", exact: true })).toBeVisible();
});
