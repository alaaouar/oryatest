import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * t52u C7 : arabe (RTL) sur TOUS les ecrans parent. Les traductions sont une premiere redaction
 * A RELIRE PAR UN ARABOPHONE : le test verifie la bascule, le sens RTL, la presence de la mention
 * de relecture et l'absence des titres francais ; il ne valide PAS la qualite de la langue.
 */
const SCREENS: { path: string; title: string; frTitle: string }[] = [
  { path: "/family", title: "أطفالي", frTitle: "Mes enfants" },
  { path: "/family/agenda", title: "المفكرة", frTitle: "Agenda" },
  { path: "/family/messages", title: "رسائل المدرسة", frTitle: "Messages de l'école" },
  { path: "/mes-donnees", title: "بياناتي", frTitle: "Mes donnees" },
];

test("parent : ecrans enfants, agenda, messages et Mes donnees en arabe (RTL, mention a relire)", async ({ page }) => {
  await login(page, "parent1@ecole-a.orya.test");
  await page.goto("/family");
  await page.getByTestId("locale-switch").click();
  for (const screen of SCREENS) {
    await page.goto(screen.path);
    const main = page.locator("main").first();
    await expect(main).toHaveAttribute("dir", "rtl");
    await expect(main).toHaveAttribute("lang", "ar");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(screen.title);
    await expect(page.getByRole("heading", { level: 1, name: screen.frTitle, exact: true })).toHaveCount(0);
    await expect(page.getByTestId("ar-review-note")).toContainText("à relire par un arabophone");
  }
  // Retour au francais : la mention disparait.
  await page.getByTestId("locale-switch").click();
  await expect(page.locator("main").first()).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mes donnees");
  await expect(page.getByTestId("ar-review-note")).toHaveCount(0);
});
