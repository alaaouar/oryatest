/** Parametre inverseable (question au juriste) : si true, TOUS les responsables lies
 *  doivent avoir un consentement actif ; si false (defaut), UN seul suffit.
 *  Variable d'environnement : CONSENT_REQUIRE_ALL_LINKED_GUARDIANS=0|1
 */
export function consentRequireAllLinkedGuardians(): boolean {
  const raw = (process.env.CONSENT_REQUIRE_ALL_LINKED_GUARDIANS ?? "0").trim();
  return raw === "1" || raw.toLowerCase() === "true";
}

export const ACCOUNT_DELETION_DELAY_DAYS = Math.max(
  1,
  Number(process.env.ACCOUNT_DELETION_DELAY_DAYS ?? 14),
);
