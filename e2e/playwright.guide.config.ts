import { defineConfig } from "@playwright/test";

/** Guide utilisateur : captures réelles sur la pile jetable (orya_guide). Jamais orya / orya_v2. */
export default defineConfig({
  testDir: "./guide",
  workers: 1,
  retries: 0,
  timeout: 900_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://127.0.0.1:3100",
    locale: "fr-FR",
    timezoneId: "Africa/Casablanca",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
});
