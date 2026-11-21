import { defineConfig } from "@playwright/test";
/** Pré-production : responsive + contrôles sécurité en direct (pile jetable orya_e2e). */
export default defineConfig({
  testDir: "./preprod", workers: 1, retries: 0, timeout: 900_000,
  expect: { timeout: 15_000 }, reporter: [["list"]],
  use: { baseURL: process.env.E2E_WEB_URL ?? "http://127.0.0.1:3100", locale: "fr-FR", timezoneId: "Africa/Casablanca", actionTimeout: 10_000, navigationTimeout: 30_000 },
});
