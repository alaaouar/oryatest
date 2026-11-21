import fs from "node:fs";
import path from "node:path";
import { test, type Page, type Browser } from "@playwright/test";
import { authenticator } from "otplib";

/**
 * Captures du guide utilisateur. Chaque capture masque les éléments sensibles
 * (clé MFA, QR code, champs mot de passe). Échecs consignés, jamais maquillés.
 */
const OUT = path.join(__dirname, "..", "guide-captures");
const PASSWORD = process.env.SEED_PASSWORD ?? "";
const secrets = new Map<string, string>();
const lastStep = new Map<string, number>();
const manifest: { file: string; module: string; feature: string; role: string; url: string; ok: boolean; note?: string }[] = [];
const flush = () => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2)); };
const MOBILE = { width: 390, height: 844 };

const sensitive = (p: Page) => [p.locator("p.mono"), p.locator("img[src^='data:'], canvas, svg[role='img'], .qr, [data-qr]"), p.locator("input[type='password']")];

async function shot(p: Page, module: string, name: string, feature: string, role: string, full = false) {
  const dir = path.join(OUT, module);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  if (fs.existsSync(file)) { manifest.push({ file: `${module}/${name}.png`, module, feature, role, url: p.url(), ok: true, note: "capture conservee (run 1)" }); return; }
  try {
    await p.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await p.waitForTimeout(600);
    await p.screenshot({ path: file, fullPage: full, mask: sensitive(p), maskColor: "#0b2142" });
    manifest.push({ file: `${module}/${name}.png`, module, feature, role, url: p.url(), ok: true });
  } catch (e) {
    manifest.push({ file: `${module}/${name}.png`, module, feature, role, url: p.url(), ok: false, note: String(e).slice(0, 200) });
  }
}

async function step(label: string, fn: () => Promise<void>) {
  try { await fn(); flush(); } catch (e) { flush(); manifest.push({ file: "", module: "_echecs", feature: label, role: "", url: "", ok: false, note: String(e).slice(0, 300) }); flush(); }
}

async function code(email: string) {
  const s = secrets.get(email)!;
  const st = Math.floor(Date.now() / 30_000);
  if (lastStep.get(email) === st) await new Promise((r) => setTimeout(r, (30 - ((Date.now() / 1000) % 30)) * 1000 + 1500));
  lastStep.set(email, Math.floor(Date.now() / 30_000));
  return authenticator.generate(s);
}

async function login(p: Page, email: string, captureModule?: string) {
  await p.goto("/login");
  await p.getByLabel("Adresse e-mail").fill(email);
  await p.getByLabel("Mot de passe").fill(PASSWORD);
  if (captureModule) await shot(p, captureModule, "01-connexion-formulaire", "Connexion : e-mail et mot de passe", "tous");
  await p.getByRole("button", { name: "Se connecter" }).click();
  const outcome = await Promise.race([
    p.waitForURL("**/dashboard", { timeout: 20_000 }).then(() => "dashboard"),
    p.getByLabel("Code à 6 chiffres").waitFor({ timeout: 20_000 }).then(() => "mfa"),
  ]);
  if (outcome === "mfa") {
    const key = p.locator("p.mono").first();
    if (await key.isVisible().catch(() => false)) {
      secrets.set(email, (await key.innerText()).replace(/\s+/g, ""));
      if (captureModule) await shot(p, captureModule, "02-mfa-enrolement-masque", "Activation de la double authentification (clé et QR masqués)", "direction", true);
    } else if (captureModule) await shot(p, captureModule, "03-mfa-code", "Saisie du code à 6 chiffres", "direction");
    await p.getByLabel("Code à 6 chiffres").fill(await code(email));
    await p.getByRole("button", { name: "Valider le code" }).click();
    await p.waitForURL("**/dashboard");
  }
}

async function logout(p: Page, captureModule?: string) {
  const b = p.getByRole("button", { name: /Se déconnecter|Déconnexion/ });
  if (await b.isVisible().catch(() => false)) {
    if (captureModule) {
      await b.evaluate((el) => { (el as HTMLElement).style.outline = "4px solid #e05a4f"; });
      await shot(p, captureModule, "05-deconnexion-bouton", "Bouton de déconnexion", "tous");
    }
    await b.click();
    await p.waitForURL("**/login");
    if (captureModule) await shot(p, captureModule, "06-apres-deconnexion", "Retour à l'écran de connexion", "tous");
  }
}

async function pages(p: Page, role: string, module: string, list: [string, string, string][]) {
  for (const [url, name, feature] of list) {
    await step(`${role} ${url}`, async () => { await p.goto(url); await shot(p, module, name, feature, role, true); });
  }
}

async function firstLinkDetail(p: Page, listUrl: string, hrefPart: string, module: string, name: string, feature: string, role: string) {
  await step(`${role} détail ${hrefPart}`, async () => {
    await p.goto(listUrl);
    await p.waitForLoadState("networkidle").catch(() => {});
    const link = p.locator(`a[href*='${hrefPart}']`).first();
    await link.click({ timeout: 8_000 });
    await p.waitForLoadState("networkidle").catch(() => {});
    await shot(p, module, name, feature, role, true);
  });
}

async function ctx(browser: Browser, mobile = false) {
  const c = await browser.newContext(mobile ? { viewport: MOBILE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {});
  return { c, p: await c.newPage() };
}

test("captures du guide", async ({ browser }) => {

  // ---------- Direction : connexion + MFA (capturés) ----------
  const d = await ctx(browser);
  await step("direction login", () => login(d.p, "direction@ecole-a.orya.test", "01-acces"));
  await shot(d.p, "02-direction-tableau-de-bord", "01-tableau-de-bord", "Tableau de bord direction", "direction", true);

  // ---------- Enseignant : appel réel ----------
  const t = await ctx(browser);
  await step("prof login", () => login(t.p, "professeur@ecole-a.orya.test"));
  await shot(t.p, "10-enseignant", "01-accueil", "Accueil de l'espace enseignant", "enseignant", true);
  await step("prof appel", async () => {
    const p = t.p;
    await p.getByRole("link", { name: "Présences" }).first().click();
    await shot(p, "10-enseignant", "02-presences-classes", "Liste des classes et séances", "enseignant", true);
    await p.getByRole("listitem").filter({ hasText: "ATT-30" }).click();
    await shot(p, "10-enseignant", "03-classe-seances", "Séances de la classe", "enseignant", true);
    await p.locator(".slot-card[data-current='true']").getByRole("button").click();
    await shot(p, "10-enseignant", "04-appel-ouvert", "Feuille d'appel ouverte", "enseignant", true);
    await p.getByRole("button", { name: "Tous présents" }).click();
    await p.getByRole("group", { name: /^Statut de .l.ve Appel 1$/ }).getByRole("button", { name: /Absent/ }).click();
    await p.getByRole("group", { name: /^Statut de .l.ve Appel 2$/ }).getByRole("button", { name: /Retard/ }).click();
    await shot(p, "10-enseignant", "05-appel-absent-retard", "Marquer absents et retards", "enseignant", true);
    await p.getByRole("button", { name: "Enregistrer" }).click();
    await p.getByText("Tous les élèves sont marqués").waitFor();
    await shot(p, "10-enseignant", "06-appel-enregistre", "Appel enregistré", "enseignant", true);
    await p.getByRole("button", { name: "Clôturer l'appel" }).click();
    await shot(p, "10-enseignant", "07-cloture-confirmation", "Confirmation de clôture", "enseignant");
    await p.getByRole("dialog").getByRole("button", { name: "Clôturer" }).click();
    await p.getByText(/Clôturé/).first().waitFor();
    await shot(p, "10-enseignant", "08-appel-cloture", "Séance clôturée", "enseignant", true);
  });
  await pages(t.p, "enseignant", "10-enseignant", [
    ["/attendance", "09-historique-presences", "Historique des appels"],
    ["/messages", "10-messages", "Messages"],
    ["/agenda", "11-agenda-devoirs", "Agenda et devoirs"],
    ["/notifications", "12-notifications", "Notifications"],
  ]);

  // ---------- Parent : justificatif (bureau + mobile) ----------
  const pa = await ctx(browser);
  await step("parent login", () => login(pa.p, "parent1@ecole-a.orya.test"));
  await pages(pa.p, "parent", "20-parent", [["/family", "01-enfants-presences", "Enfants et présences"]]);
  await step("parent justificatif", async () => {
    const p = pa.p;
    await p.goto("/family");
    await p.getByRole("tab", { name: /Justificatifs/ }).click();
    await p.locator("#j-from").fill("2026-10-29");
    await p.locator("#j-to").fill("2026-10-29");
    await p.locator("#j-reason").fill("[DÉMO] Rendez-vous médical");
    await p.locator("#j-file").setInputFiles(path.join(__dirname, "..", "tests", "fixtures", "certificat.pdf"));
    await shot(p, "20-parent", "02-justifier-formulaire", "Formulaire de justification", "parent", true);
    await p.getByRole("button", { name: "Envoyer" }).click();
    await p.getByText("[DÉMO] Rendez-vous médical").first().waitFor();
    await shot(p, "20-parent", "03-justificatif-en-attente", "Justificatif envoyé (en attente)", "parent", true);
  });
  for (const [i, tab] of [[0, "enfants"], [2, "actions"]] as const) {
    await step(`parent onglet ${tab}`, async () => {
      await pa.p.goto("/family");
      await pa.p.locator("button[role='tab']").nth(i).click();
      await shot(pa.p, "20-parent", `04-onglet-${tab}`, `Onglet ${tab}`, "parent", true);
    });
  }

  // ---------- Direction : modules ----------
  await step("direction justificatif", async () => {
    const p = d.p;
    await p.goto("/justifications");
    await shot(p, "03-direction-justificatifs", "01-a-examiner", "Justificatifs à examiner", "direction", true);
    const card = p.locator("article, li, .card").filter({ hasText: "[DÉMO] Rendez-vous médical" }).first();
    await card.getByRole("button", { name: "Accepter" }).click();
    await p.getByText(/Justificatif accepté/).waitFor();
    await shot(p, "03-direction-justificatifs", "02-accepte", "Justificatif accepté", "direction");
  });
  await step("direction message", async () => {
    const p = d.p;
    await p.goto("/messages");
    await p.locator("#m-title").fill("[DÉMO] Réunion d'information des parents");
    await p.locator("#m-body").fill("Réunion d'information vendredi à 17 h dans la salle polyvalente.");
    await shot(p, "04-direction-communication", "01-redaction", "Rédaction d'un message", "direction", true);
    await p.getByRole("button", { name: "Envoyer" }).click();
    await p.getByText("[DÉMO] Réunion d'information des parents").first().waitFor();
    await shot(p, "04-direction-communication", "02-envoye-liste", "Message envoyé (liste)", "direction", true);
  });
  await firstLinkDetail(d.p, "/messages", "/messages/", "04-direction-communication", "03-suivi-lecture", "Suivi d'un message", "direction");
  await pages(d.p, "direction", "05-direction-modules", [
    ["/students", "01-eleves-liste", "Liste des élèves"],
    ["/assignments", "03-affectations", "Affectations enseignants / classes"],
    ["/families", "04-familles", "Familles et responsables légaux"],
    ["/imports", "05-imports", "Imports"],
    ["/attendance", "06-presences-direction", "Présences (vue direction)"],
    ["/agenda", "07-agenda", "Agenda et devoirs"],
    ["/notifications", "08-notifications", "Notifications"],
    ["/audit", "09-journal-audit", "Journal d'audit"],
    ["/pending", "10-en-attente", "Éléments en attente"],
    ["/massar", "11-massar", "Préparation Massar (format ORYA)"],
    ["/billing", "12-abonnement", "Abonnement"],
  ]);
  await firstLinkDetail(d.p, "/students", "/students/", "05-direction-modules", "02-eleve-fiche", "Fiche élève", "direction");
  await firstLinkDetail(d.p, "/attendance", "/attendance/", "05-direction-modules", "06b-seance-detail", "Détail d'une séance", "direction");
  await firstLinkDetail(d.p, "/agenda", "/agenda/", "05-direction-modules", "07b-agenda-detail", "Détail agenda", "direction");
  await step("dashboard viewport", async () => { await d.p.goto("/dashboard"); await shot(d.p, "02-direction-tableau-de-bord", "02-haut-de-page", "Indicateurs (haut de page)", "direction"); });

  // ---------- Parent : messages / agenda, puis mobile ----------
  await pages(pa.p, "parent", "20-parent", [
    ["/family/messages", "05-messages", "Messages reçus"],
    ["/family/agenda", "06-agenda", "Agenda et devoirs"],
    ["/notifications", "07-notifications", "Notifications"],
  ]);
  await firstLinkDetail(pa.p, "/family/messages", "/family/messages/", "20-parent", "05b-message-detail", "Lecture d'un message", "parent");
  await firstLinkDetail(pa.p, "/family/agenda", "/family/agenda/", "20-parent", "06b-agenda-detail", "Détail d'un devoir", "parent");
  const pm = await ctx(browser, true);
  await step("parent mobile login", () => login(pm.p, "parent1@ecole-a.orya.test"));
  await pages(pm.p, "parent-mobile", "21-parent-mobile", [
    ["/family", "01-accueil", "Espace parent sur mobile"],
    ["/family/messages", "02-messages", "Messages sur mobile"],
    ["/family/agenda", "03-agenda", "Agenda sur mobile"],
  ]);

  // ---------- Super-admin ----------
  const sa = await ctx(browser);
  flush();
  await step("superadmin", async () => {
    await login(sa.p, "superadmin@orya.test");
    await pages(sa.p, "super-admin", "30-super-admin", [["/platform", "01-plateforme", "Administration plateforme"], ["/schools", "02-ecoles", "Écoles"]]);
  });

  // ---------- Déconnexion (capturée) ----------
  await step("logout", () => logout(t.p, "01-acces"));

  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
});

test("captures complémentaires", async ({ browser }) => {
  const d = await ctx(browser); const t = await ctx(browser); const pa = await ctx(browser);
  await step("c2 logins", async () => {
    await login(d.p, "direction@ecole-a.orya.test");
    await login(t.p, "professeur@ecole-a.orya.test");
    await login(pa.p, "parent1@ecole-a.orya.test");
  });
  const M = "40-complements";
  // Détail de séance + réouverture (direction)
  await step("c2 seance direction", async () => {
    const p = d.p;
    await p.goto("/attendance");
    await p.locator("button").filter({ hasText: "ATT-30" }).first().click();
    await p.getByRole("button", { name: /Consulter l'appel/ }).first().click();
    await p.waitForURL("**/attendance/**");
    await shot(p, M, "01-direction-seance-detail", "Détail d'une séance clôturée (direction)", "direction", true);
    await p.getByRole("button", { name: "Rouvrir l'appel" }).click();
    const dlg = p.getByRole("dialog");
    const box = dlg.locator("textarea, input[type='text']").first();
    if (await box.count()) await box.fill("[DÉMO] Correction d'un retard signalé par la famille");
    await shot(p, M, "02-direction-rouvrir-dialogue", "Réouverture d'un appel avec motif", "direction");
    await dlg.getByRole("button", { name: "Rouvrir" }).click();
    await p.waitForTimeout(1500);
    await shot(p, M, "03-direction-appel-rouvert", "Appel rouvert par la direction", "direction", true);
  });
  // Enseignant : publication d'un devoir
  await step("c2 devoir", async () => {
    const p = t.p;
    await p.goto("/agenda");
    const cls = p.locator("select").first();
    const opts = await cls.locator("option").allTextContents();
    const o = opts.find((x) => /ATT-30/.test(x)); if (o) await cls.selectOption({ label: o });
    await p.getByLabel("Titre").fill("[DÉMO] Exercices de mathématiques p. 42");
    await p.getByLabel("Description").fill("Faire les exercices 1 à 5. Rendre sur feuille double.");
    await shot(p, M, "04-enseignant-devoir-formulaire", "Saisie d'un devoir", "enseignant", true);
    await p.getByRole("button", { name: "Publier" }).click();
    await p.getByText("[DÉMO] Exercices de mathématiques p. 42").first().waitFor();
    await shot(p, M, "05-enseignant-devoir-publie", "Devoir publié dans l'agenda", "enseignant", true);
  });
  // Enseignant : message de classe
  await step("c2 message prof", async () => {
    const p = t.p;
    await p.goto("/messages");
    const sel = p.locator("select");
    for (let i = 0; i < await sel.count(); i++) {
      const opts = await sel.nth(i).locator("option").allTextContents();
      const o = opts.find((x) => /ATT-30/.test(x)); if (o) await sel.nth(i).selectOption({ label: o });
    }
    await p.getByLabel("Titre").fill("[DÉMO] Sortie pédagogique jeudi");
    await p.getByLabel("Message").fill("Prévoir une tenue adaptée et un goûter.");
    await shot(p, M, "06-enseignant-message-redaction", "Message de classe (enseignant)", "enseignant", true);
    await p.getByRole("button", { name: "Envoyer" }).click();
    await p.getByText("[DÉMO] Sortie pédagogique jeudi").first().waitFor();
    await shot(p, M, "07-enseignant-message-envoye", "Message de classe envoyé", "enseignant", true);
  });
  // Détail agenda direction + parent
  await firstLinkDetail(d.p, "/agenda", "/agenda/", M, "08-direction-agenda-detail", "Détail d'un devoir (direction)", "direction");
  await pages(pa.p, "parent", M, [["/family/agenda", "09-parent-agenda-liste", "Agenda du parent avec devoir"]]);
  await firstLinkDetail(pa.p, "/family/agenda", "/family/agenda/", M, "10-parent-agenda-detail", "Détail d'un devoir (parent)", "parent");
  await pages(pa.p, "parent", M, [["/family/messages", "11-parent-messages", "Messages reçus par le parent"], ["/notifications", "12-parent-notifications", "Notifications du parent"]]);
  // Parent : justificatif refusé puis état après décisions
  await step("c2 justificatif 2", async () => {
    const p = pa.p;
    await p.goto("/family");
    await p.locator("button[role='tab']").nth(1).click();
    await p.locator("#j-from").fill("2026-10-28");
    await p.locator("#j-to").fill("2026-10-28");
    await p.locator("#j-reason").fill("[DÉMO] Raison familiale");
    await p.locator("#j-file").setInputFiles(path.join(__dirname, "..", "tests", "fixtures", "certificat.pdf"));
    await p.getByRole("button", { name: "Envoyer" }).click();
    await p.getByText("[DÉMO] Raison familiale").first().waitFor();
  });
  await step("c2 refus", async () => {
    const p = d.p;
    await p.goto("/justifications");
    const card = p.locator("article, li, .card").filter({ hasText: "[DÉMO] Raison familiale" }).first();
    await card.locator("textarea, input[type='text']").first().fill("Merci de fournir un justificatif signé.");
    await shot(p, M, "13-direction-refus-note", "Refus avec note à la famille", "direction", true);
    await card.getByRole("button", { name: "Refuser" }).click();
    await p.waitForTimeout(1500);
    await p.getByRole("button", { name: /^Tous/ }).first().click().catch(() => {});
    await shot(p, M, "14-direction-justificatifs-tous", "Justificatifs : tous les statuts", "direction", true);
  });
  await step("c2 parent apres decision", async () => {
    const p = pa.p;
    await p.goto("/family");
    await p.locator("button[role='tab']").nth(1).click();
    await shot(p, M, "15-parent-justificatifs-decisions", "Justificatifs après décision (accepté / refusé)", "parent", true);
    await p.locator("button[role='tab']").nth(0).click();
    await shot(p, M, "16-parent-enfants-apres-appel", "Présences de l'enfant après l'appel", "parent", true);
  });
  // Exports tableau de bord + Massar
  await step("c2 exports dashboard", async () => {
    const p = d.p;
    await p.goto("/dashboard");
    const h = p.getByRole("heading", { name: "Exports" });
    await h.scrollIntoViewIfNeeded();
    for (const fmt of ["CSV", "XLSX"]) {
      const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15_000 }), p.getByRole("button", { name: fmt, exact: true }).first().click()]);
      manifest.push({ file: "", module: M, feature: `Export tableau de bord ${fmt} : ${dl.suggestedFilename()}`, role: "direction", url: p.url(), ok: true });
    }
    await h.evaluate((el) => el.closest(".card")?.scrollIntoView());
    await shot(p, M, "17-direction-exports-tableau-de-bord", "Exports CSV / XLSX du tableau de bord", "direction");
  });
  await step("c2 export massar", async () => {
    const p = d.p;
    await p.goto("/massar");
    const h = p.getByRole("heading", { name: "Exports" });
    await h.scrollIntoViewIfNeeded();
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15_000 }), p.getByRole("button", { name: /^(CSV|XLSX)$/ }).first().click()]);
    manifest.push({ file: "", module: M, feature: `Export Massar : ${dl.suggestedFilename()}`, role: "direction", url: p.url(), ok: true });
    await p.waitForTimeout(1500);
    await p.getByRole("heading", { name: "Historique des exports" }).scrollIntoViewIfNeeded();
    await shot(p, M, "18-direction-massar-exports-historique", "Export Massar et historique des exports", "direction");
  });
  fs.writeFileSync(path.join(OUT, "manifest2.json"), JSON.stringify(manifest, null, 2));
});
