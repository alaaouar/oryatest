import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";

/**
 * t74u : écran direction « Consentements » dans un navigateur réel.
 * - Direction : entrée de menu, textes et versions (« Validé » / « Brouillon juridique »),
 *   compteurs, liste filtrable par élève, détail, consentement papier par la route existante.
 * - Enseignant : pas d'entrée de menu, page refusée, API 403.
 * Le texte « e2e » (validé, FIXTURE-TEST-ONLY) vient de seed-e2e-student.ts ; aucun texte
 * « alertes transport » n'est validé dans la base E2E, d'où « Brouillon juridique ».
 */
const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

test.describe.serial("consentements (direction)", () => {
  test("direction : liste, filtres, détail, papier ; enseignant refusé", async ({ page }) => {
    expect(API.length > 0).toBe(true);
    await login(page, "direction@ecole-a.orya.test");

    const overview = page.waitForResponse((r) => r.url().endsWith("/consents/overview"));
    await page.getByRole("link", { name: "Consentements" }).click();
    await page.waitForURL("**/consentements");
    expect((await overview).status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Consentements");

    // Textes et versions : texte validé « e2e » et compteurs.
    const texts = page.getByTestId("consent-texts");
    await expect(texts.getByTestId("consent-text-row").filter({ hasText: "e2e" })).toContainText("Validé");
    await expect(page.getByTestId("consent-counts")).toContainText("Acceptés");
    await expect(page.getByTestId("consent-counts")).toContainText("En attente");
    await expect(page.getByTestId("consent-counts")).toContainText("Refusés : non enregistré");

    // Isolation : aucun élève d'une autre école dans la liste.
    const list = page.getByTestId("consent-students");
    await expect(list.getByTestId("consent-student-row").first()).toBeVisible();
    await expect(list).not.toContainText("ECOLE-B");
    await expect(list).not.toContainText("ECOLE-C");

    // Alertes transport : aucun texte validé -> « Brouillon juridique », papier impossible.
    await page.getByRole("button", { name: "Alertes transport" }).click();
    await expect(texts.getByTestId("legal-draft").first()).toBeVisible();
    await page.getByRole("button", { name: "Compte élève" }).click();

    // Recherche par élève, détail, consentement papier (route existante, texte validé).
    await page.locator("#c-search").fill("ECOLE-A-2");
    const row = list.getByTestId("consent-student-row").filter({ hasText: "ECOLE-A-2" });
    await expect(row).toHaveCount(1);
    await row.getByRole("button").first().click();
    const detail = page.getByTestId("consent-detail");
    await expect(detail.getByRole("heading", { level: 2 })).toContainText("ECOLE-A-2");
    const form = detail.getByTestId("paper-form");
    await form.locator("#p-guardian").fill("Responsable papier E2E");
    await form.locator("#p-ref").fill(`DOS-E2E-${Date.now()}`);
    await form.getByRole("button", { name: "Enregistrer le consentement papier" }).click();
    await expect(page.getByText("Consentement papier enregistré")).toBeVisible();
    await expect(row).toContainText("Accepté");
    await expect(row).toContainText("Papier (école)");
    await expect(row).toContainText("Responsable papier E2E");
    await expect(detail).toContainText("Responsable papier E2E");

    // Filtres : statut et classe.
    await page.locator("#c-status").selectOption("pending");
    await expect(row).toHaveCount(0);
    await page.locator("#c-status").selectOption("accepted");
    await expect(row).toHaveCount(1);
    await page.locator("#c-search").fill("");
    await page.locator("#c-status").selectOption("");
    await logout(page);

    // Enseignant : ni menu, ni page, ni API.
    await login(page, "professeur@ecole-a.orya.test");
    await expect(page.getByRole("link", { name: "Consentements" })).toHaveCount(0);
    await page.goto("/consentements");
    await expect(page.getByText("Cette page est réservée à la direction.")).toBeVisible();
    await expect(page.getByTestId("consent-students")).toHaveCount(0);
    const status = await page.evaluate(async (api) => (await fetch(`${api}/consents/overview`, { credentials: "include" })).status, API);
    expect(status).toBe(403);
  });
});
