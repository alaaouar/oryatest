import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { PASSWORD } from "./helpers";

/**
 * C6 (t52u) : espace eleve en navigateur reel.
 * 1. Le parent donne le consentement "compte eleve" via l'API reelle (aucun ecran web dedie).
 * 2. L'eleve active son compte par le lien d'invitation (ecran /activation), se deconnecte,
 *    puis se connecte par /login et consulte "Mon espace" en lecture seule.
 * 3. Le parent retire le consentement ; la meme session eleve est refusee (403 -> message).
 * Mots de passe et jeton : jamais affiches (comparaisons booleennes, aucun log).
 */
type Fixture = { token: string; studentId: string; textId: string; email: string };
const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

async function parentToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${API}/auth/login`, { data: { email: "parent1@ecole-a.orya.test", password: PASSWORD } });
  expect(r.ok()).toBe(true);
  const body = (await r.json()) as { accessToken?: string };
  expect(typeof body.accessToken === "string").toBe(true);
  return body.accessToken as string;
}

test("eleve : activation, connexion, consultation en lecture seule, refus apres retrait du consentement", async ({ page, request }) => {
  const file = process.env.ORYA_E2E_STUDENT_FIXTURE ?? "";
  expect(file.length > 0 && API.length > 0).toBe(true);
  const fx = JSON.parse(readFileSync(file, "utf8")) as Fixture;
  const studentPassword = `${randomBytes(18).toString("base64url")}Aa1!`;

  // 1. Consentement parental actif (API reelle).
  const tok = await parentToken(request);
  const auth = { Authorization: `Bearer ${tok}` };
  const granted = await request.post(`${API}/family/children/${fx.studentId}/consents`, {
    headers: auth,
    data: { textId: fx.textId, purpose: "student_account" },
  });
  expect(granted.status()).toBe(201);
  const consentId = ((await granted.json()) as { id: string }).id;

  // 2a. Activation par invitation (navigateur).
  await page.goto(`/activation?token=${encodeURIComponent(fx.token)}`);
  await page.locator("#name").fill("Eleve E2E");
  await page.locator("#password").fill(studentPassword);
  await page.locator("#confirm").fill(studentPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/activation"), { timeout: 20_000 });

  // 2b. Deconnexion puis vraie connexion par /login.
  await page.context().clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(fx.email);
  await page.getByLabel("Mot de passe").fill(studentPassword);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("**/dashboard", { timeout: 20_000 });

  // 2c. Consultation : lien "Mon espace", donnees affichees, aucune ecriture possible.
  const meResponse = page.waitForResponse((r) => r.url().endsWith("/student/me"));
  await page.getByRole("link", { name: "Mon espace" }).click();
  await page.waitForURL("**/eleve");
  const me = await meResponse;
  expect(me.status()).toBe(200);
  expect(((await me.json()) as { readOnly?: boolean }).readOnly).toBe(true);
  const space = page.getByTestId("student-space");
  await expect(space.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(space.getByTestId("student-bus")).toBeVisible();
  await expect(space.locator(".alert--error")).toHaveCount(0);
  await expect(space.locator("form, textarea, input:not([type=hidden]), button[type=submit]")).toHaveCount(0);
  const write = await page.evaluate(async (api) => {
    const r = await fetch(`${api}/student/me`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    return r.status;
  }, API);
  expect(write).toBeGreaterThanOrEqual(400);

  // C7 : meme ecran en arabe (RTL, mention "a relire par un arabophone"), puis retour au francais.
  await page.getByTestId("locale-switch").click();
  await expect(space).toHaveAttribute("dir", "rtl");
  await expect(space.getByRole("heading", { level: 1 })).toHaveText("فضائي");
  await expect(page.getByTestId("ar-review-note")).toContainText("à relire par un arabophone");
  await page.getByTestId("locale-switch").click();
  await expect(space).toHaveAttribute("dir", "ltr");

  // 3. Retrait du consentement par le parent ; meme session eleve -> refus.
  const revoked = await request.post(`${API}/family/children/${fx.studentId}/consents/${consentId}/revoke`, { headers: auth, data: {} });
  expect(revoked.ok()).toBe(true);
  const refused = page.waitForResponse((r) => r.url().endsWith("/student/me"));
  await page.reload();
  expect((await refused).status()).toBe(403);
  await expect(page.getByTestId("student-space").locator(".alert--error")).toBeVisible();
  await expect(page.getByTestId("student-bus")).toHaveCount(0);
});
