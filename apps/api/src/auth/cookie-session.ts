import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Lot 10 : session navigateur en cookies httpOnly + protection CSRF
 * (double soumission : cookie httpOnly orya_csrf comparé à l'en-tête X-CSRF-Token,
 * dont la valeur est remise au client web dans le corps de la réponse).
 * Les clients non navigateur (tests, futures apps mobiles) gardent le Bearer.
 */
export const WEB_CLIENT_HEADER = "x-orya-client";
export const CSRF_HEADER = "x-csrf-token";
export const ACCESS_COOKIE = "orya_at";
export const REFRESH_COOKIE = "orya_rt";
export const CSRF_COOKIE = "orya_csrf";

const ACCESS_MAX_AGE_S = Number(process.env.ACCESS_COOKIE_MAX_AGE_S ?? 15 * 60);
const REFRESH_MAX_AGE_S = Number(process.env.REFRESH_COOKIE_MAX_AGE_S ?? 30 * 24 * 3600);

export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const raw = Array.isArray(header) ? header.join(";") : (header ?? "");
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function secure(): boolean {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === "true";
  return process.env.NODE_ENV === "production";
}

function cookie(name: string, value: string, path: string, maxAge: number): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Strict"];
  if (secure()) parts.push("Secure");
  if (process.env.COOKIE_DOMAIN) parts.push(`Domain=${process.env.COOKIE_DOMAIN}`);
  return parts.join("; ");
}

export function sessionCookies(tokens: { accessToken: string; refreshToken?: string }, csrf: string): string[] {
  const list = [cookie(ACCESS_COOKIE, tokens.accessToken, "/api/v1", ACCESS_MAX_AGE_S), cookie(CSRF_COOKIE, csrf, "/api/v1", REFRESH_MAX_AGE_S)];
  if (tokens.refreshToken) list.push(cookie(REFRESH_COOKIE, tokens.refreshToken, "/api/v1/auth", REFRESH_MAX_AGE_S));
  return list;
}

/** B07 : cookie CSRF seul (reprise de session navigateur dans un nouvel onglet, sans rotation des jetons). */
export function csrfCookie(csrf: string): string {
  return cookie(CSRF_COOKIE, csrf, "/api/v1", REFRESH_MAX_AGE_S);
}

export function clearedCookies(): string[] {
  return [cookie(ACCESS_COOKIE, "", "/api/v1", 0), cookie(CSRF_COOKIE, "", "/api/v1", 0), cookie(REFRESH_COOKIE, "", "/api/v1/auth", 0)];
}

export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function csrfMatches(header: string | string[] | undefined, cookieValue: string | undefined): boolean {
  if (typeof header !== "string" || !cookieValue) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(cookieValue);
  return a.length === b.length && a.length >= 32 && timingSafeEqual(a, b);
}

export function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}
