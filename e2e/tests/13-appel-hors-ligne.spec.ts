import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * F03 / B11 / ADR-003 (t89) : appel hors ligne dans la console.
 * Saisie sans reseau (file IndexedDB, identifiants UUID), rechargement sans reseau
 * (coquille servie par le service worker), reprise automatique (POST sessions/:id/sync),
 * puis affichage des resultats "stale", "rejected" et "closed".
 */
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3013/api/v1";

type Row = { studentId: string; status: string };

/** Appel direct de l'API avec la session cookie du contexte (non soumis a l'emulation hors ligne). */
async function api(page: Page, method: "GET" | "POST", path: string, data?: unknown) {
  const csrf = await page.evaluate(() => window.sessionStorage.getItem("orya.session"));
  return page.context().request.fetch(`${API}${path}`, {
    method,
    data,
    headers: { "X-Orya-Client": "web", "X-CSRF-Token": csrf ?? "", Origin: new URL(page.url()).origin },
  });
}

test("enseignant : appel hors ligne, rechargement sans reseau, synchronisation et conflits (ADR-003)", async ({ page, context }) => {
  test.setTimeout(300_000);
  await login(page, "professeur@ecole-a.orya.test");
  await page.goto("/attendance");
  await expect(page.getByRole("heading", { name: "Présences" })).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "ATT-30" }).click();
  // Demi-journee non courante : le parcours 01 cloture la demi-journee courante.
  await page.locator(".slot-card[data-current='false']").getByRole("button").click();
  await page.waitForURL(/\/attendance\/[0-9a-f-]{36}$/);
  const sessionId = page.url().split("/").pop() as string;

  const indicator = page.getByTestId("sync-indicator");
  await expect(indicator).toHaveText("À jour");
  // Le service worker (portee /attendance) controle la page et la coquille est en cache.
  await page.waitForFunction(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(async () => (await (await caches.open("orya-attendance-shell-v1")).keys()).length))
    .toBeGreaterThan(2);

  const detail0 = await (await api(page, "GET", `/attendance/sessions/${sessionId}`)).json();
  const roster = await (
    await api(page, "GET", `/attendance/classrooms/${detail0.classroomId}/roster?date=${String(detail0.date).slice(0, 10)}`)
  ).json();
  const idOf = (n: number): string =>
    roster.students.find((s: { studentCode: string }) => s.studentCode === `ATT-${String(n).padStart(3, "0")}`).id;
  const serverRows = async (): Promise<Map<string, string>> => {
    const detail = await (await api(page, "GET", `/attendance/sessions/${sessionId}`)).json();
    return new Map((detail.rows as Row[]).map((row) => [row.studentId, row.status]));
  };
  const group = (n: number) => page.getByRole("group", { name: `Statut de Élève Appel ${n}`, exact: true });

  // 1. Saisie sans reseau : 3 mutations en file locale, aucune ecriture serveur.
  await context.setOffline(true);
  await expect(indicator).toHaveText(/Hors ligne/);
  await group(1).getByRole("button", { name: /Absent/ }).click();
  await group(2).getByRole("button", { name: /Retard/ }).click();
  await group(3).getByRole("button", { name: /Présent/ }).click();
  await expect(indicator).toHaveText("Hors ligne – 3 modification(s) en attente");
  expect((await serverRows()).size).toBe(0);

  // 2. Rechargement sans reseau : coquille du service worker, liste et file relues dans IndexedDB.
  await page.reload();
  await expect(page.getByRole("heading", { name: /ATT-30/ })).toBeVisible();
  await expect(indicator).toHaveText("Hors ligne – 3 modification(s) en attente");
  await expect(group(1).getByRole("button", { name: /Absent/ })).toHaveAttribute("aria-pressed", "true");
  await expect(group(2).getByRole("button", { name: /Retard/ })).toHaveAttribute("aria-pressed", "true");

  // 3. Retour du reseau : file rejouee automatiquement, indicateur "A jour", lignes ecrites.
  await context.setOffline(false);
  await expect(indicator).toHaveText("À jour", { timeout: 60_000 });
  const rows1 = await serverRows();
  expect(rows1.get(idOf(1))).toBe("absent");
  expect(rows1.get(idOf(2))).toBe("late");
  expect(rows1.get(idOf(3))).toBe("present");
  expect(rows1.size).toBe(3);

  // 4. Conflits : saisie hors ligne plus ancienne qu'une saisie serveur (stale) + eleve hors classe (rejected).
  await context.setOffline(true);
  await expect(indicator).toHaveText(/Hors ligne/);
  await group(4).getByRole("button", { name: /Absent/ }).click();
  await expect(indicator).toHaveText("Hors ligne – 1 modification(s) en attente");
  await page.evaluate(
    (sid) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("orya-offline");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("queue", "readwrite");
          tx.objectStore("queue").put({
            clientMutationId: crypto.randomUUID(),
            sessionId: sid,
            studentId: crypto.randomUUID(),
            status: "present",
            recordedAt: new Date().toISOString(),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    sessionId,
  );
  await page.waitForTimeout(1_100);
  const bulk = await api(page, "POST", `/attendance/sessions/${sessionId}/rows/bulk`, { rows: [{ studentId: idOf(4), status: "present" }] });
  expect(bulk.ok()).toBeTruthy();
  await context.setOffline(false);
  const notice = page.locator("p.alert--error");
  await expect(notice).toContainText("1 modification(s) refusée(s)", { timeout: 60_000 });
  await expect(notice).toContainText("1 modification(s) ignorée(s)");
  await expect(indicator).toHaveText("À jour");
  await expect(group(4).getByRole("button", { name: /Présent/ })).toHaveAttribute("aria-pressed", "true");
  expect((await serverRows()).get(idOf(4))).toBe("present");

  // 5. Appel cloture pendant la coupure : le serveur gagne, modification non appliquee signalee.
  await context.setOffline(true);
  await expect(indicator).toHaveText(/Hors ligne/);
  await group(5).getByRole("button", { name: /Absent/ }).click();
  await expect(indicator).toHaveText("Hors ligne – 1 modification(s) en attente");
  expect((await api(page, "POST", `/attendance/sessions/${sessionId}/close`)).ok()).toBeTruthy();
  await context.setOffline(false);
  await expect(indicator).toHaveText("Appel clôturé : 1 modification(s) non appliquée(s)", { timeout: 60_000 });
  await expect(page.getByText("Clôturé", { exact: true })).toBeVisible();
  expect((await serverRows()).get(idOf(5))).toBeUndefined();
});
