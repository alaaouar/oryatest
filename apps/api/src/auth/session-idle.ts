/**
 * CDC §3.4 (t92) : déconnexion des sessions inactives.
 *
 * Une session (Device) dont la dernière activité authentifiée (`lastSeenAt`, à défaut
 * `createdAt`) dépasse la limite est révoquée au prochain appel : jeton d'accès et jeton de
 * rafraîchissement refusés (401), audit `auth.session.idle_expired`.
 *
 * - Console web et clients sans plateforme déclarée : SESSION_IDLE_MINUTES (défaut 30).
 * - Applications mobiles (android, ios) : SESSION_IDLE_MOBILE_MINUTES (défaut 43 200 = 30 jours),
 *   les parents n'ouvrant l'application que lorsqu'une notification arrive.
 * - L'activité n'est réécrite en base qu'une fois par minute au plus (TOUCH_INTERVAL_MS).
 */
export const DEFAULT_IDLE_MINUTES = 30;
export const DEFAULT_MOBILE_IDLE_MINUTES = 43_200;
export const TOUCH_INTERVAL_MS = 60_000;

export type IdleEnv = { SESSION_IDLE_MINUTES?: string; SESSION_IDLE_MOBILE_MINUTES?: string };

export function isMobilePlatform(platform: string | null | undefined): boolean {
  return platform === "android" || platform === "ios";
}

function minutes(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Limite d'inactivité en millisecondes pour une plateforme. Valeur invalide -> défaut (jamais « illimité »). */
export function idleLimitMs(platform: string | null | undefined, env: IdleEnv): number {
  const mobile = isMobilePlatform(platform);
  const m = mobile
    ? minutes(env.SESSION_IDLE_MOBILE_MINUTES, DEFAULT_MOBILE_IDLE_MINUTES)
    : minutes(env.SESSION_IDLE_MINUTES, DEFAULT_IDLE_MINUTES);
  return m * 60_000;
}

/** Dernière activité connue : lastSeenAt, sinon date de création de la session. */
export function lastActivity(device: { lastSeenAt: Date | null; createdAt: Date }): Date {
  return device.lastSeenAt ?? device.createdAt;
}

export function isIdle(device: { lastSeenAt: Date | null; createdAt: Date }, limitMs: number, now: Date): boolean {
  return now.getTime() - lastActivity(device).getTime() > limitMs;
}

export function needsTouch(device: { lastSeenAt: Date | null; createdAt: Date }, now: Date): boolean {
  return device.lastSeenAt === null || now.getTime() - device.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS;
}
