import { expect, type Page } from "@playwright/test";
import { authenticator } from "otplib";

export const PASSWORD = process.env.SEED_PASSWORD ?? "";

/** Secrets TOTP mémorisés par compte (enrôlement fait dans le navigateur). */
const secrets = new Map<string, string>();
const lastStep = new Map<string, number>();

async function freshCode(email: string): Promise<string> {
  const secret = secrets.get(email);
  if (!secret) throw new Error(`Aucun secret MFA pour ${email}`);
  // Anti-rejeu côté API : un pas TOTP déjà consommé est refusé, on attend le suivant.
  const step = Math.floor(Date.now() / 30_000);
  if (lastStep.get(email) === step) {
    await new Promise((resolve) => setTimeout(resolve, (30 - ((Date.now() / 1000) % 30)) * 1000 + 1500));
  }
  lastStep.set(email, Math.floor(Date.now() / 30_000));
  return authenticator.generate(secret);
}

/** Connexion par l'interface ; gère l'enrôlement MFA (lecture de la clé affichée) et la vérification. */
export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  const outcome = await Promise.race([
    page.waitForURL("**/dashboard", { timeout: 20_000 }).then(() => "dashboard" as const),
    page.getByLabel("Code à 6 chiffres").waitFor({ timeout: 20_000 }).then(() => "mfa" as const),
  ]);
  if (outcome === "mfa") {
    const key = page.locator("p.mono").first();
    if (await key.isVisible().catch(() => false)) {
      secrets.set(email, (await key.innerText()).replace(/\s+/g, ""));
    }
    await page.getByLabel("Code à 6 chiffres").fill(await freshCode(email));
    await page.getByRole("button", { name: "Valider le code" }).click();
    await page.waitForURL("**/dashboard");
  }
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  // Lot 10 : aucun jeton lisible par le JavaScript de la page (cookies httpOnly).
  const exposed = await page.evaluate(() => JSON.stringify(sessionStorage) + JSON.stringify(localStorage) + document.cookie);
  expect(exposed).not.toMatch(/eyJ|accessToken|refreshToken|orya_at|orya_rt/);
}

export async function logout(page: Page) {
  const button = page.getByRole("button", { name: /Se déconnecter|Déconnexion/ });
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await page.waitForURL("**/login");
  }
}
