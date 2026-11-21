/**
 * Politique de mot de passe pour un NOUVEAU mot de passe choisi par un compte deja actif
 * (changement de mot de passe, t62u A1). Regles :
 *  - 12 a 128 caracteres ;
 *  - au moins 3 familles parmi minuscules, majuscules, chiffres, autres caracteres ;
 *  - different du mot de passe actuel ;
 *  - ne contient pas la partie locale de l'adresse e-mail (4 caracteres ou plus) ;
 *  - absent d'une courte liste de mots de passe triviaux.
 * Retourne la liste des problemes (vide = conforme). Ne journalise jamais le mot de passe.
 */
const TRIVIAL = ["password", "motdepasse", "azerty", "qwerty", "123456", "orya", "ecole", "admin", "bonjour"];

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function passwordPolicyProblems(candidate: string, ctx: { email: string; current: string }): string[] {
  const problems: string[] = [];
  if (candidate.length < PASSWORD_MIN_LENGTH || candidate.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Le nouveau mot de passe doit contenir entre ${PASSWORD_MIN_LENGTH} et ${PASSWORD_MAX_LENGTH} caracteres.`);
  }
  const families = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(candidate)).length;
  if (families < 3) {
    problems.push("Le nouveau mot de passe doit melanger au moins 3 familles : minuscules, majuscules, chiffres, symboles.");
  }
  if (candidate === ctx.current) {
    problems.push("Le nouveau mot de passe doit etre different de l'actuel.");
  }
  const lower = candidate.toLowerCase();
  const local = (ctx.email.split("@")[0] ?? "").toLowerCase();
  if (local.length >= 4 && lower.includes(local)) {
    problems.push("Le nouveau mot de passe ne doit pas contenir votre adresse e-mail.");
  }
  // Mot trivial suivi seulement de chiffres ou symboles (ex. "Azerty2026!!") : refuse.
  const core = lower.replace(/[^a-z0-9]/g, "").replace(/[0-9]+$/, "");
  if (TRIVIAL.includes(core)) {
    problems.push("Le nouveau mot de passe est trop courant.");
  }
  return problems;
}
