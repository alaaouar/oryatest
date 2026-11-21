// ORYA web - configuration ESLint "flat" (Next.js 16 : `next lint` n'existe plus).
// Regles Next (core-web-vitals) + TypeScript via eslint-config-next.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Regle React Compiler (eslint-plugin-react-hooks 7) : le motif existant
      // "setState en debut d'effet de chargement" est volontaire et couvert par l'E2E.
      // Le reecrire serait une refactorisation generale : avertissement, a traiter page par page.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "node_modules/**", "next-env.d.ts"]),
]);
