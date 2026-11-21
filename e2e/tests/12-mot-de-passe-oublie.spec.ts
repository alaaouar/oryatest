import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD } from "./helpers";

/**
 * F01 (t87u) : mot de passe oublie, parcours complet dans la console.
 * Boite d'envoi locale (MAIL_OUTBOX_DIR, OutboxFileMailer) : aucun envoi reel.
 * Compte dedie parent2@ecole-a (aucun autre parcours ne l'utilise).
 */
const ACCOUNT = "parent2@ecole-a.orya.test";
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3013/api/v1";
const OUTBOX = process.env.MAIL_OUTBOX_DIR ?? "";

type Mail = { to: string; subject: string; text: string; kind: string };

function mailsTo(to: string): Mail[] {
  if (!OUTBOX) return [];
  let names: string[] = [];
  try {
    names = readdirSync(OUTBOX).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return names.map((n) => JSON.parse(readFileSync(join(OUTBOX, n), "utf8")) as Mail).filter((m) => m.to === to);
}

async function requestReset(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await page.getByRole("link", { name: "Mot de passe oubli\u00e9 ?" }).click();
  await page.waitForURL("**/mot-de-passe-oublie");
  await expect(page.getByRole("heading", { name: "Mot de passe oubli\u00e9" })).toBeVisible();
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  const status = page.locator("p.alert[role=status]");
  await expect(status).toContainText("Si un compte actif correspond");
  return (await status.innerText()).trim();
}

async function choosePassword(page: Page, link: string, password: string) {
  // Ouverture depuis l'e-mail = chargement complet (pas une simple navigation de fragment).
  await page.goto("about:blank");
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Nouveau mot de passe" })).toBeVisible();
  // Le jeton (fragment) est retire de la barre d'adresse des la lecture.
  await expect.poll(() => page.url()).not.toContain("token=");
  await page.getByLabel("Nouveau mot de passe", { exact: true }).fill(password);
  await page.getByLabel("Confirmer le mot de passe").fill(password);
  await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
}

test.describe.serial("F01 mot de passe oublie", () => {
  test("demande, lien par e-mail, nouveau mot de passe, sessions revoquees, lien a usage unique", async ({ page, request }) => {
    expect(OUTBOX, "MAIL_OUTBOX_DIR doit etre fourni par run-e2e.ps1").not.toBe("");
    const before = mailsTo(ACCOUNT).length;

    // Session ouverte avant la reinitialisation (revoquee ensuite).
    const opened = await request.post(`${API}/auth/login`, { data: { email: ACCOUNT, password: PASSWORD } });
    expect(opened.status()).toBe(200);
    const oldAccess = (await opened.json()).accessToken as string;
    expect(oldAccess).toBeTruthy();

    // Anti-enumeration : meme message pour un compte inconnu et pour le compte reel.
    const unknownMsg = await requestReset(page, "personne.inconnue@ecole-a.orya.test");
    const knownMsg = await requestReset(page, ACCOUNT);
    expect(knownMsg).toBe(unknownMsg);
    expect(mailsTo("personne.inconnue@ecole-a.orya.test")).toHaveLength(0);

    await expect.poll(() => mailsTo(ACCOUNT).length).toBe(before + 1);
    const mail = mailsTo(ACCOUNT).at(-1)!;
    const match = /(https?:\/\/\S+\/nouveau-mot-de-passe#token=\S+)/.exec(mail.text);
    expect(match, "lien de reinitialisation dans l'e-mail").not.toBeNull();
    const link = match![1];
    expect(mail.text).not.toContain(PASSWORD);

    // Politique ebe40ca : un mot de passe trop court est refuse sans consommer le lien.
    await choosePassword(page, link, "court");
    await expect(page.locator("p.alert--error")).toContainText("12");

    const newPassword = `E2e-Reset-${Date.now().toString(36)}-K9!`;
    await choosePassword(page, link, newPassword);
    await expect(page.locator("p.alert[role=status]")).toContainText("Mot de passe modifi\u00e9");

    // Lien a usage unique.
    await choosePassword(page, link, `${newPassword}x`);
    await expect(page.locator("p.alert--error")).toContainText("invalide ou expire");

    // Ancienne session et ancien mot de passe refuses ; nouveau mot de passe accepte dans la console.
    expect((await request.get(`${API}/me`, { headers: { Authorization: `Bearer ${oldAccess}` } })).status()).toBe(401);
    expect((await request.post(`${API}/auth/login`, { data: { email: ACCOUNT, password: PASSWORD } })).status()).toBe(401);
    await page.goto("/login");
    await page.getByLabel("Adresse e-mail").fill(ACCOUNT);
    await page.getByLabel("Mot de passe").fill(newPassword);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  });
});