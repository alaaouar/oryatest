import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe.serial("direction", () => {
  test("MFA, examen d'un justificatif, message, tableau de bord", async ({ page }) => {
    await login(page, "direction@ecole-a.orya.test");

    // Tableau de bord direction (lot 7) : chiffres réels, pas d'erreur.
    await expect(page.getByText("Élèves").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Appel du jour/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Exports" })).toBeVisible();

    // Examen du justificatif envoyé par le parent.
    await page.goto("/justifications");
    const card = page.locator("article, li, .card").filter({ hasText: "Rendez-vous médical E2E desktop" }).first();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Accepter" }).click();
    await expect(page.getByText(/Justificatif accepté/)).toBeVisible();
    await page.getByRole("button", { name: /Accepté/ }).click();
    await expect(page.getByText("Rendez-vous médical E2E desktop").first()).toBeVisible();

    // Message à toute l'école.
    await page.goto("/messages");
    const title = `Réunion parents E2E ${Date.now()}`;
    await page.locator("#m-title").fill(title);
    await page.locator("#m-body").fill("Réunion d'information vendredi à 17 h.");
    await page.getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByText(title).first()).toBeVisible();

    // Préparation Massar : écran et avertissement.
    await page.goto("/massar");
    await expect(page.getByText(/pas connecté à Massar/)).toBeVisible();
  });
});
