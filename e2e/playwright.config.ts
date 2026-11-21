import { defineConfig, devices } from "@playwright/test";

/**
 * Lot 10 : parcours clés contre la pile locale démarrée par run-e2e.ps1
 * (base jetable orya_e2e, API :3013, web :3100). Jamais contre orya / orya_v2.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "report" }]],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
    timezoneId: "Africa/Casablanca",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // B07 : la session apres MFA est aussi verifiee en mobile navigateur.
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /(parent|mfa-session)\.spec\.ts$/ },
  ],
});
