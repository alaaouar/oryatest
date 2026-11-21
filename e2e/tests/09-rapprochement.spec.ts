import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";

/**
 * t62u A2 : rapprochement MANUEL d'un virement par le super-admin (MFA) dans un navigateur réel,
 * via le formulaire de la page /facturation-ecoles (plus de boîtes de dialogue navigateur).
 * Données FICTIVES de la base jetable orya_e2e (références bancaires « FICTIF »).
 * Refus testés : champ obligatoire vide, confirmation non cochée (aucun virement enregistré).
 */
test.describe.serial("rapprochement des virements", () => {
  test("super-admin : facture annuelle, rapprochement partiel puis total ; direction : statut payé", async ({ page }) => {
    await login(page, "superadmin@orya.test");
    await page.goto("/facturation-ecoles");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Facturation des écoles");
    const row = page.getByTestId("billing-contracts").locator("tr").filter({ hasText: /Al Nour/ }).first();
    await row.getByRole("button", { name: "Ouvrir" }).click();
    await page.getByRole("button", { name: /Créer le contrat|Mettre à jour le contrat/ }).click();
    await expect(page.getByText("Contrat enregistré (audité).")).toBeVisible();

    // Émission de la facture annuelle (confirmation explicite du document définitif).
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Émettre" }).click();
    await expect(page.getByText("Facture annuelle émise.")).toBeVisible();
    const invoice = page.getByTestId("billing-documents").locator("tbody tr").filter({ hasText: /ORYA-FA-/ }).first();
    await expect(invoice).toBeVisible();
    await expect(row).toContainText("Facturé");

    // Formulaire dans la page, pré-rempli avec le reste dû.
    await invoice.getByRole("button", { name: "Rapprocher un virement" }).click();
    const form = page.getByTestId("payment-form");
    await expect(form).toBeVisible();
    await expect(form.locator("input[name=amount]")).not.toHaveValue("");

    // Refus 1 : référence bancaire vide -> validation du formulaire, rien n'est envoyé.
    await form.locator("input[name=amount]").fill("100,00");
    await form.getByRole("button", { name: "Enregistrer le rapprochement" }).click();
    await expect(form).toBeVisible();
    await expect(page.getByTestId("billing-payments")).toHaveCount(0);

    // Refus 2 : confirmation non cochée -> message, rien n'est envoyé.
    await form.locator("input[name=bankReference]").fill("VIR-E2E-FICTIF-001");
    await form.getByRole("button", { name: "Enregistrer le rapprochement" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Cochez la confirmation");
    await expect(page.getByTestId("billing-payments")).toHaveCount(0);

    // Rapprochement partiel (100,00 DH).
    await form.locator("input[name=confirmed]").check();
    await form.getByRole("button", { name: "Enregistrer le rapprochement" }).click();
    await expect(page.getByText("Virement rapproché (audité).")).toBeVisible();
    await expect(form).toHaveCount(0);
    const payments = page.getByTestId("billing-payments");
    await expect(payments).toContainText("VIR-E2E-FICTIF-001");
    await expect(payments).toContainText("100,00");
    await expect(row).toContainText("Facturé");

    // Rapprochement du solde : montant pré-rempli = reste dû -> statut payé.
    await invoice.getByRole("button", { name: "Rapprocher un virement" }).click();
    await form.locator("input[name=bankReference]").fill("VIR-E2E-FICTIF-002");
    await form.locator("input[name=confirmed]").check();
    await form.getByRole("button", { name: "Enregistrer le rapprochement" }).click();
    await expect(page.getByText("Virement rapproché (audité).")).toBeVisible();
    await expect(payments).toContainText("VIR-E2E-FICTIF-002");
    await expect(row).toContainText("Payé");
    await expect(invoice.getByRole("button", { name: "Rapprocher un virement" })).toHaveCount(0);

    // Audit : le rapprochement figure au journal (auteur super-admin, session MFA).
    await page.goto("/audit");
    await expect(page.getByText("billing.payment.reconciled").first()).toBeVisible();
    await logout(page);

    await login(page, "direction@ecole-a.orya.test");
    await page.goto("/billing");
    await expect(page.getByTestId("billing-status")).toHaveText("Payé");
  });
});
