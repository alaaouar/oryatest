import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * B07 : redirection vers /login apres mfa/verify. Le jeton CSRF de la console vit en
 * sessionStorage (par onglet) ; s'il manque alors que les cookies httpOnly de session sont
 * valides (navigation avant la fin du traitement de mfa/verify, nouvel onglet), la console
 * renvoyait vers /login. Bureau (direction ecole B) et mobile navigateur (2e compte direction
 * ecole B, fixture seed-e2e.sql) : chaque projet enrole son propre second facteur.
 */
function accountFor(project: string): string {
  return project === "mobile" ? "direction-mobile@ecole-b.orya.test" : "direction@ecole-b.orya.test";
}

async function apiBaseFrom(page: Page, action: () => Promise<unknown>): Promise<string> {
  const csrf = page.waitForResponse((r) => r.url().includes("/auth/csrf"), { timeout: 20_000 });
  await action();
  const response = await csrf;
  expect(response.status()).toBe(200);
  return response.url().replace(/\/auth\/csrf.*$/, "");
}

test.describe.serial("B07 session apres MFA", () => {
  test("apres mfa/verify : onglet sans jeton CSRF et nouvel onglet restent connectes ; ecritures CSRF", async ({ page, context }, testInfo) => {
    await login(page, accountFor(testInfo.project.name));

    // 1. Course avec mfa/verify : le jeton CSRF de l'onglet n'a pas ete enregistre.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/dashboard");

    // 2. Nouvel onglet : cookies partages, sessionStorage vide.
    const tab = await context.newPage();
    const base = await apiBaseFrom(tab, () => tab.goto("/dashboard"));
    await expect(tab.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
    expect(new URL(tab.url()).pathname).toBe("/dashboard");

    // 3. Le controle CSRF reste entier : faux jeton -> 403 ; jeton repris -> ecriture acceptee.
    const write = (token: string | null) =>
      tab.evaluate(
        async ({ url, csrf }) => {
          const headers: Record<string, string> = { "X-Orya-Client": "web", "Content-Type": "application/json" };
          if (csrf) headers["X-CSRF-Token"] = csrf;
          const r = await fetch(url, { method: "POST", headers, body: "{}", credentials: "include" });
          return r.status;
        },
        { url: `${base}/auth/logout`, csrf: token },
      );
    expect(await write(null)).toBe(403);
    expect(await write("x".repeat(43))).toBe(403);
    const recovered = await tab.evaluate(() => window.sessionStorage.getItem("orya.session"));
    expect(recovered && recovered.length >= 32).toBeTruthy();
    expect(await write(recovered)).toBe(200);

    // 4. Session revoquee : la reprise du jeton echoue et la console renvoie vers /login.
    await tab.evaluate(() => window.sessionStorage.clear());
    await tab.goto("/dashboard");
    await tab.waitForURL("**/login");
  });

  test("sans session : aucun acces a la console, /auth/csrf refuse", async ({ page, request }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
    const api = process.env.E2E_API_URL ?? "http://127.0.0.1:3013/api/v1";
    const anonymous = await request.get(`${api}/auth/csrf`, { headers: { "X-Orya-Client": "web" } });
    expect(anonymous.status()).toBe(401);
  });
});