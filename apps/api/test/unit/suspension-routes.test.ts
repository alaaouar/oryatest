import { describe, expect, it } from "vitest";
import { isSuspensionExempt } from "../../src/billing/subscription.interceptor";

/**
 * Regle de routes par statut (equivalent API d'un hrefAllowed) : une ecole suspendue passe en
 * lecture seule, sauf liste fermee (securite, export, suppression, retrait de consentement).
 */
describe("routes exemptees de la suspension (bloc 5, t52u, t62u A1)", () => {
  it.each([
    "/api/v1/auth/login",
    "/api/v1/auth/password/forgot",
    "/api/v1/me/password",
    "/api/v1/me/devices/abc/revoke",
    "/api/v1/me/data-export",
    "/api/v1/family/children/c1/consents/k1/revoke",
    "/api/v1/students/s1/consents/k1/revoke/",
    "/api/v1/students/deletion",
    "/api/v1/auth/refresh?x=1",
  ])("exemptee : %s", (path) => {
    expect(isSuspensionExempt(path)).toBe(true);
  });

  it.each([
    "/api/v1/attendance/sessions/s1/close",
    "/api/v1/students",
    "/api/v1/students/s1/consents/k1",
    "/api/v1/students/deletion/extra",
    "/api/v1/family/children/c1/consents/k1/revoke/again",
    "/api/v1/messages",
    "/api/v1/authx/login",
    "/api/v1/meta",
  ])("bloquee : %s", (path) => {
    expect(isSuspensionExempt(path)).toBe(false);
  });
});