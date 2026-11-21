import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";

/**
 * Bloc 5 (t52u D3) : écrans de facturation des écoles dans un navigateur réel.
 * Super-admin (MFA) : liste des contrats, création du contrat d'une école, aperçu du comptage.
 * Direction : lecture seule de son contrat et de son statut (aucun bouton de paiement en ligne).
 */
test.describe.serial("facturation ecole", () => {
  test("super-admin : contrat et aperçu ; direction : lecture de son contrat", async ({ page }) => {
    await login(page, "superadmin@orya.test");
    await page.goto("/facturation-ecoles");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Facturation des écoles");
    const row = page.getByTestId("billing-contracts").locator("tr").filter({ hasText: /Al Nour/ }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Ouvrir" }).click();
    await page.getByRole("button", { name: /Créer le contrat|Mettre à jour le contrat/ }).click();
    await expect(page.getByText("Contrat enregistré (audité).")).toBeVisible();
    await expect(row).toContainText("CTR-ALNOUR");
    await expect(row).toContainText("Essai");
    await expect(row).toContainText("120,00");
    await page.getByRole("button", { name: "Aperçu" }).click();
    await expect(page.getByTestId("billing-preview")).toContainText("enfant(s)");
    await expect(page.getByTestId("billing-preview")).toContainText("TTC");
    await logout(page);

    await login(page, "direction@ecole-a.orya.test");
    await page.goto("/billing");
    const section = page.getByTestId("school-billing");
    await expect(section).toBeVisible();
    await expect(section).toContainText("CTR-ALNOUR");
    await expect(page.getByTestId("billing-status")).toHaveText("Essai");
    await expect(section).toContainText("120,00");
    await expect(section).toContainText("Aucun paiement en ligne");
    await expect(section.getByRole("button", { name: /Payer/i })).toHaveCount(0);
    await expect(section).toContainText("FICTI");
  });
});