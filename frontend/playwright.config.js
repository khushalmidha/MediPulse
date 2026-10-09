import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", fullyParallel: false, workers: 1, retries: 0,
  ...(process.env.E2E_OUTPUT_DIR ? { outputDir: process.env.E2E_OUTPUT_DIR } : {}),
  reporter: "list", timeout: 90000, expect: { timeout: 30000 },
  use: { baseURL: "http://127.0.0.1:15173", launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }, trace: process.env.E2E_TRACE === "true" ? "retain-on-failure" : "off",
    ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}) },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: "node e2e/fixture-api.mjs", url: "http://127.0.0.1:19080/health/live", reuseExistingServer: false },
    { command: "npm run dev -- --host 127.0.0.1 --port 15173 --mode e2e", url: "http://127.0.0.1:15173", reuseExistingServer: false,
      env: { VITE_BACKEND_URL: process.env.E2E_API_PROXY === "true" ? "/backend" : "http://127.0.0.1:19080", DEV_API_PROXY_URL: "http://127.0.0.1:19080",
        VITE_APP_DOMAINS: "localhost,127.0.0.1,connect.medipulse.live,app.medipulse.live,api.medipulse.live", VITE_BASE_DOMAIN: "medipulse.live", VITE_ENABLE_HOSPITAL_CUSTOM_DOMAINS: "true", VITE_GOOGLE_CLIENT_ID: "" } },
  ],
});
