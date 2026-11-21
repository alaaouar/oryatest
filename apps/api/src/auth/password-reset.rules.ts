/**
 * F01 (t87u) : regles pures de la reinitialisation du mot de passe (testees en unitaire).
 * Jeton remis par e-mail : "r1.<userId>.<secret>" (secret 256 bits base64url). Seul le
 * SHA-256 du jeton complet est stocke. L'identifiant porte par le jeton ouvre le contexte
 * RLS du compte ; un jeton presente avec un autre identifiant est introuvable.
 */
const TOKEN_RE = /^r1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{40,64})$/;

export const RESET_TOKEN_TTL_MINUTES_DEFAULT = 30;
export const RESET_ACCOUNT_LIMIT_DEFAULT = 3;
export const RESET_ACCOUNT_WINDOW_MS = 60 * 60 * 1000;

export function formatResetToken(userId: string, secret: string): string {
  return `r1.${userId}.${secret}`;
}

export function parseResetToken(token: unknown): { userId: string } | null {
  if (typeof token !== "string") return null;
  const m = TOKEN_RE.exec(token.trim());
  return m ? { userId: m[1]! } : null;
}

/** Duree de validite (minutes), bornee a [5, 60] ; valeur invalide -> 30. */
export function resetTtlMinutes(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 5 || n > 60) return RESET_TOKEN_TTL_MINUTES_DEFAULT;
  return n;
}

/** Plafond de demandes par compte et par heure, borne a [1, 20] ; invalide -> 3. */
export function resetAccountLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 20) return RESET_ACCOUNT_LIMIT_DEFAULT;
  return n;
}

export type ResetTokenState = { usedAt: Date | null; expiresAt: Date } | null | undefined;

/** Etat d'un jeton : utilisable, deja utilise, expire ou inconnu. */
export function resetTokenStatus(row: ResetTokenState, now: Date): "valid" | "used" | "expired" | "unknown" {
  if (!row) return "unknown";
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

/** Lien du courriel : le jeton est dans le fragment (#), jamais envoye au serveur web ni en Referer. */
export function resetLink(webOrigin: string, token: string): string {
  return `${webOrigin.replace(/\/+$/, "")}/nouveau-mot-de-passe#token=${encodeURIComponent(token)}`;
}

/** Reponse unique de la demande, que le compte existe ou non (anti-enumeration). */
export const RESET_REQUEST_RESPONSE = {
  ok: true,
  message: "Si un compte actif correspond a cette adresse, un e-mail de reinitialisation vient d'etre envoye. Le lien est valable 30 minutes.",
} as const;