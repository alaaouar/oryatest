import { expect, test } from "@playwright/test";

/**
 * t92 (CDC 3.1) : premiere ouverture - choix de la langue puis de l'un des 5 profils,
 * memorise sur l'appareil ; l'ouverture suivante va directement a la connexion.
 */
test.describe("Premiere ouverture : langue et profil", () => {
  test("choix AR + Parent memorise, puis connexion directe", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/bienvenue");
    await expect(page.getByRole("heading", { name: "Bienvenue sur ORYA" })).toBeVisible();
    await expect(page.getByTestId("welcome-profiles").getByRole("button")).toHaveCount(5);

    await page.getByRole("button", { name: "العربية" }).click();
    await expect(page.getByRole("heading", { name: "مرحبا بك في ORYA" })).toBeVisible();
    await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
    for (const label of ["وليّ الأمر", "تلميذ(ة)", "أستاذ(ة)", "المدرسة (الإدارة)", "مرافق(ة) الحافلة"]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }

    await page.getByRole("button", { name: "وليّ الأمر" }).click();
    await page.waitForURL("**/login");
    const stored = await page.evaluate(() => [localStorage.getItem("orya.welcome.v1"), localStorage.getItem("orya.locale")]);
    expect(JSON.parse(stored[0] ?? "{}")).toEqual({ locale: "ar", profile: "parent" });
    expect(stored[1]).toBe("ar");
    await expect(page.getByTestId("welcome-choice")).toContainText("وليّ الأمر");
    await expect(page.getByRole("link", { name: "Activer mon compte" })).toBeVisible();

    // Ouverture suivante : le choix est memorise, pas de nouvel ecran d'accueil.
    await page.goto("/");
    await page.waitForURL("**/login");

    // Changer de profil depuis la connexion.
    await page.getByRole("link", { name: "Changer" }).click();
    await page.waitForURL("**/bienvenue");
    await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
    await page.getByRole("button", { name: "Français" }).click();
    await page.getByRole("button", { name: "École (direction)" }).click();
    await page.waitForURL("**/login");
    await expect(page.getByTestId("welcome-choice")).toContainText("École (direction)");
    await expect(page.getByRole("link", { name: "Activer mon compte" })).toHaveCount(0);
  });
});
