import fs from "node:fs";
import path from "node:path";
import { test, type Page, type BrowserContext } from "@playwright/test";
import { authenticator } from "otplib";

const OUT = path.join(__dirname, "..", "preprod-out");
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3013/api/v1";
const PASSWORD = process.env.SEED_PASSWORD ?? "";
const OTHER_STUDENT = process.env.OTHER_SCHOOL_STUDENT_ID ?? "";
const results: Record<string, unknown>[] = [];
const rec = (r: Record<string, unknown>) => { results.push(r); fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2)); };
const secrets = new Map<string, string>();

async function login(p: Page, email: string) {
  await p.goto("/login");
  await p.getByLabel("Adresse e-mail").fill(email);
  await p.getByLabel("Mot de passe").fill(PASSWORD);
  await p.getByRole("button", { name: "Se connecter" }).click();
  const o = await Promise.race([
    p.waitForURL("**/dashboard", { timeout: 20_000 }).then(() => "d"),
    p.getByLabel("Code à 6 chiffres").waitFor({ timeout: 20_000 }).then(() => "m"),
  ]);
  if (o === "m") {
    const k = p.locator("p.mono").first();
    if (await k.isVisible().catch(() => false)) secrets.set(email, (await k.innerText()).replace(/\s+/g, ""));
    await p.getByLabel("Code à 6 chiffres").fill(authenticator.generate(secrets.get(email)!));
    await p.getByRole("button", { name: "Valider le code" }).click();
    await p.waitForURL("**/dashboard");
  }
}
async function csrf(c: BrowserContext) { return (await c.cookies()).find((k) => k.name === "orya_csrf")?.value ?? ""; }
async function api(c: BrowserContext, method: string, url: string, opts: { csrf?: boolean; data?: unknown } = {}) {
  const headers: Record<string, string> = { "X-Orya-Client": "web" };
  if (opts.csrf) headers["X-CSRF-Token"] = await csrf(c);
  const r = await c.request.fetch(API + url, { method, headers, data: opts.data, failOnStatusCode: false });
  return r.status();
}

const ROLES = {
  direction: { email: "direction@ecole-a.orya.test", pages: ["/dashboard", "/students", "/attendance", "/justifications", "/messages", "/agenda", "/massar", "/billing", "/families"] },
  enseignant: { email: "professeur@ecole-a.orya.test", pages: ["/dashboard", "/attendance", "/messages", "/agenda"] },
  parent: { email: "parent1@ecole-a.orya.test", pages: ["/family", "/family/messages", "/family/agenda", "/notifications"] },
  superadmin: { email: "superadmin@orya.test", pages: ["/platform", "/schools"] },
} as const;
const VIEWPORTS = [{ w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1440, h: 900 }];

test("pré-production", async ({ browser }) => {
  const ctxs: Record<string, BrowserContext> = {};
  for (const [role, r] of Object.entries(ROLES)) {
    try { const c = await browser.newContext(); const p = await c.newPage(); await login(p, r.email); ctxs[role] = c; rec({ kind: "login", role, ok: true }); }
    catch (e) { rec({ kind: "login", role, ok: false, err: String(e).slice(0, 200) }); }
  }
  // ---- Cookies ----
  for (const [role, c] of Object.entries(ctxs)) {
    const ck = (await c.cookies()).filter((k) => k.name.startsWith("orya_")).map((k) => ({ name: k.name, httpOnly: k.httpOnly, secure: k.secure, sameSite: k.sameSite, path: k.path }));
    const js = await (await c.pages()[0]).evaluate(() => document.cookie + "|" + JSON.stringify(sessionStorage) + JSON.stringify(localStorage));
    rec({ kind: "cookies", role, cookies: ck, jsVisibleTokens: /eyJ/.test(js) });
  }
  // ---- Permissions (API, cookie) ----
  const probes: [string, string][] = [["GET", "/dashboard/summary"], ["GET", "/students"], ["GET", "/audit"], ["GET", "/massar/check?schoolYear=2026-2027"], ["GET", "/billing"], ["GET", "/admin/overview"], ["GET", "/schools"], ["GET", "/family/children"], ["GET", "/assignments"], ["GET", "/guardians"], ["GET", "/imports/00000000-0000-4000-8000-000000000000"]];
  for (const [role, c] of Object.entries(ctxs)) for (const [m, u] of probes) rec({ kind: "perm", role, route: `${m} ${u}`, status: await api(c, m, u) });
  // ---- Anonyme ----
  const anon = await browser.newContext();
  for (const [m, u] of probes.slice(0, 3)) rec({ kind: "perm", role: "anonyme", route: `${m} ${u}`, status: await api(anon, m, u) });
  // ---- Isolation inter-écoles ----
  if (OTHER_STUDENT) for (const role of ["direction", "enseignant", "parent"]) if (ctxs[role]) {
    rec({ kind: "isolation", role, route: `GET /students/${OTHER_STUDENT}`, status: await api(ctxs[role], "GET", `/students/${OTHER_STUDENT}`) });
    rec({ kind: "isolation", role, route: `GET /family/children/${OTHER_STUDENT}`, status: await api(ctxs[role], "GET", `/family/children/${OTHER_STUDENT}`) });
  }
  // ---- CSRF ----
  if (ctxs.direction) {
    rec({ kind: "csrf", case: "POST /messages sans X-CSRF-Token", status: await api(ctxs.direction, "POST", "/messages", { data: { kind: "announcement", title: "csrf", body: "x", audience: { type: "school" } } }) });
    const c = ctxs.direction; const r = await c.request.fetch(API + "/messages", { method: "POST", headers: { "X-Orya-Client": "web", "X-CSRF-Token": "faux-jeton" }, data: { title: "csrf" }, failOnStatusCode: false });
    rec({ kind: "csrf", case: "POST /messages avec mauvais jeton", status: r.status() });
  }
  // ---- Responsive ----
  for (const [role, r] of Object.entries(ROLES)) {
    const c = ctxs[role]; if (!c) continue;
    const p = c.pages()[0];
    for (const v of VIEWPORTS) {
      await p.setViewportSize({ width: v.w, height: v.h });
      for (const url of r.pages) {
        try {
          await p.goto(url); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(500);
          const m = await p.evaluate(() => {
            const vw = document.documentElement.clientWidth;
            const over = [...document.querySelectorAll("body *")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > vw + 2 && getComputedStyle(e).position !== "fixed"; })
              .filter((e) => !e.closest("[style*='overflow'], .table-wrap, table")).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${(e.className || "").toString().split(" ")[0]}`);
            return { scrollW: document.documentElement.scrollWidth, vw, over, path: location.pathname };
          });
          // Menu : ouvrir le menu repliable si présent, puis chaque entrée doit être visible et dans la largeur.
          const toggle = p.locator(".nav__toggle");
          const toggleShown = await toggle.isVisible().catch(() => false);
          if (toggleShown && (await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
          const nav = await p.evaluate(() => {
            const vw = document.documentElement.clientWidth;
            const links = [...document.querySelectorAll("nav[aria-label='Navigation principale'] a.nav__link")] as HTMLElement[];
            const bad = links.filter((a) => { const b = a.getBoundingClientRect(); return b.width === 0 || b.height === 0 || b.left < -1 || b.right > vw + 1; }).map((a) => a.textContent?.trim());
            return { count: links.length, hidden: bad, scrollW: document.documentElement.scrollWidth, vw };
          });
          let kb = 0;
          if (url === r.pages[0]) {
            await p.locator("body").click({ position: { x: 1, y: 1 } }).catch(() => {});
            for (let i = 0; i < 40; i++) { await p.keyboard.press("Tab"); if (await p.evaluate(() => document.activeElement?.classList.contains("nav__link"))) kb++; }
          }
          rec({ kind: "menu", role, viewport: `${v.w}x${v.h}`, url, toggle: toggleShown, links: nav.count, hidden: nav.hidden, overflowAfterOpen: nav.scrollW > nav.vw + 1, keyboardFocusedLinks: url === r.pages[0] ? kb : undefined });
          if (toggleShown) await toggle.click();
          const file = `${role}_${v.w}x${v.h}_${url.replace(/\//g, "_")}.png`;
          await p.screenshot({ path: path.join(OUT, "shots", file), fullPage: false, mask: [p.locator("p.mono"), p.locator("input[type='password']")] });
          rec({ kind: "responsive", role, viewport: `${v.w}x${v.h}`, url, landed: m.path, hOverflow: m.scrollW > m.vw + 2, scrollW: m.scrollW, vw: m.vw, overflowing: m.over, file });
        } catch (e) { rec({ kind: "responsive", role, viewport: `${v.w}x${v.h}`, url, err: String(e).slice(0, 160) }); }
      }
    }
  }
  // ---- Déconnexion / révocation ----
  if (ctxs.parent) {
    const c = ctxs.parent; const before = await c.cookies();
    rec({ kind: "session", case: "logout", status: await api(c, "POST", "/auth/logout", { csrf: true }) });
    rec({ kind: "session", case: "GET /me après logout (même contexte)", status: await api(c, "GET", "/me") });
    const old = await browser.newContext(); await old.addCookies(before);
    rec({ kind: "session", case: "GET /me avec ancien cookie d'accès rejoué", status: await api(old, "GET", "/me") });
    const csrfOld = before.find((k) => k.name === "orya_csrf")?.value ?? "";
    const r = await old.request.fetch(API + "/auth/refresh", { method: "POST", headers: { "X-Orya-Client": "web", "X-CSRF-Token": csrfOld }, failOnStatusCode: false });
    rec({ kind: "session", case: "POST /auth/refresh avec ancien refresh rejoué", status: r.status() });
  }
});
