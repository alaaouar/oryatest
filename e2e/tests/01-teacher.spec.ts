import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("enseignant : appel du jour, absent, enregistrement puis clôture", async ({ page }) => {
  await login(page, "professeur@ecole-a.orya.test");
  await page.getByRole("link", { name: "Présences" }).first().click();
  await expect(page.getByRole("heading", { name: "Présences" })).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "ATT-30" }).click();
  await page.locator(".slot-card[data-current='true']").getByRole("button").click();
  await page.getByRole("button", { name: "Tous présents" }).click();
  await page.getByRole("group", { name: "Statut de Élève Appel 1", exact: true }).getByRole("button", { name: /Absent/ }).click();
  await page.getByRole("group", { name: "Statut de Élève Appel 2", exact: true }).getByRole("button", { name: /Retard/ }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Tous les élèves sont marqués")).toBeVisible();
  await page.getByRole("button", { name: "Clôturer l'appel" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clôturer" }).click();
  await expect(page.getByText(/Clôturé/).first()).toBeVisible();
});
