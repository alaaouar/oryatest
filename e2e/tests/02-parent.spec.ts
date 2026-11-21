import path from "node:path";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("parent : justificatif d'absence avec pièce jointe (mobile et bureau)", async ({ page }, info) => {
  await login(page, "parent1@ecole-a.orya.test");
  await page.goto("/family");
  await page.getByRole("tab", { name: /Justificatifs/ }).click();
  const reason = `Rendez-vous médical E2E ${info.project.name}`;
  await page.locator("#j-from").fill("2026-10-29");
  await page.locator("#j-to").fill("2026-10-29");
  await page.locator("#j-reason").fill(reason);
  await page.locator("#j-file").setInputFiles(path.join(__dirname, "fixtures", "certificat.pdf"));
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText(reason)).toBeVisible();
  await expect(page.getByText(/En attente/).first()).toBeVisible();
});
