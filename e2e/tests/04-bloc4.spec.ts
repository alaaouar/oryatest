import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("public : page de suppression de compte accessible sans connexion", async ({ page }) => {
  await page.goto("/suppression-compte");
  await expect(page.getByTestId("public-deletion")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Supprimer votre compte");
  await expect(page).toHaveURL(/\/suppression-compte$/);
});

test("parent : ecran famille en arabe, sens RTL", async ({ page }) => {
  await login(page, "parent1@ecole-a.orya.test");
  await page.goto("/family");
  const main = page.locator("main.parent-space");
  await expect(main).toHaveAttribute("dir", "ltr");
  await page.getByTestId("locale-switch").click();
  await expect(main).toHaveAttribute("dir", "rtl");
  await expect(main).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("أطفالي");
  await page.reload();
  await expect(page.locator("main.parent-space")).toHaveAttribute("dir", "rtl");
  await page.getByTestId("locale-switch").click();
  await expect(page.locator("main.parent-space")).toHaveAttribute("dir", "ltr");
});