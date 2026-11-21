import { defineConfig } from "vitest/config";

/**
 * t87u (tache 4) : tests unitaires de la logique pure de l'API (sans base, sans reseau,
 * sans conteneur). Les suites PowerShell (DB, API, E2E, BLOC*) restent la reference
 * d'integration ; ici seules les regles pures et l'ordre du pipeline fichiers.
 */
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    reporters: ["verbose"],
    env: { NODE_ENV: "test" },
  },
});