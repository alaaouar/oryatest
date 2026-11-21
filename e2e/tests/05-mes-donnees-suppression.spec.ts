import { expect, test } from "@playwright/test";
import { login, PASSWORD } from "./helpers";

/**
 * t50u : bouton de suppression de compte sur "Mes donnees", branche sur POST me/deletion.
 * Mauvais mot de passe : appel REEL a l'API (refus, aucune demande). Succes : la reponse 202
 * est interceptee pour ne pas desactiver le compte de seed partage par les autres specs ;
 * l'effet reel de POST me/deletion (desactivation, revocation, delai, purge) est teste en BLOC2.
 */
test("parent : suppression de compte depuis Mes donnees (mot de passe faux refuse, requete exacte, deconnexion)", async ({ page }) => {
  await login(page, "parent1@ecole-a.orya.test");
  await page.goto("/mes-donnees");
  const section = page.getByTestId("account-deletion");
  await expect(section).toBeVisible();

  const refused = page.waitForResponse((r) => r.url().endsWith("/me/deletion") && r.request().method() === "POST");
  await section.getByLabel("Mot de passe").fill("mauvais-mot-de-passe-e2e");
  await section.getByRole("button", { name: "Demander la suppression de mon compte" }).click();
  expect((await refused).status()).toBeGreaterThanOrEqual(400);
  await expect(page.locator(".alert--error")).toBeVisible();
  await expect(page.getByTestId("deletion-requested")).toHaveCount(0);

  let body: Record<string, unknown> = {};
  await page.route("**/me/deletion", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    body = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
  });
  await section.getByLabel("Mot de passe").fill(PASSWORD);
  await section.getByRole("button", { name: "Demander la suppression de mon compte" }).click();
  await expect(page.getByTestId("deletion-requested")).toBeVisible();
  // Comparaison booleenne : un echec n'affiche jamais le mot de passe dans le rapport.
  expect(Object.keys(body)).toEqual(["password"]);
  expect(body.password === PASSWORD).toBe(true);
  await page.waitForURL("**/login", { timeout: 15_000 });
});