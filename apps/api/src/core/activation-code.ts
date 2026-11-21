import { randomInt } from "node:crypto";

/**
 * Code d'activation remis aux familles (CDC §3.2).
 *
 * - 32 caractères, alphabet sans ambiguïté (pas de 0/O, 1/I) ;
 * - stocké uniquement sous forme de SHA-256 ;
 * - expirant (durée par défaut : 30 jours, configurable par l'école) ;
 * - le code élève lisible (studentCode) n'est PAS un secret.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_LENGTH = 32;

export function generateActivationCode(length = DEFAULT_LENGTH): string {
  let code = "";

  for (let index = 0; index < length; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }

  return code;
}

/** Saisie tolérante : minuscules, espaces et tirets sont normalisés. */
export function normalizeActivationCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Regroupement lisible pour l'impression (XXXX-XXXX-...). */
export function formatActivationCode(code: string, groupSize = 8): string {
  return code.match(new RegExp(`.{1,${groupSize}}`, "g"))?.join("-") ?? code;
}
