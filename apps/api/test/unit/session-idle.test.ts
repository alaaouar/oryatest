import { describe, expect, it } from "vitest";
import { DEFAULT_IDLE_MINUTES, DEFAULT_MOBILE_IDLE_MINUTES, idleLimitMs, isIdle, needsTouch } from "../../src/auth/session-idle";

const now = new Date("2026-11-15T19:00:00.000Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

describe("sessions inactives (CDC 3.4)", () => {
  it("applique 30 min au web et aux clients sans plateforme, 30 jours aux mobiles par defaut", () => {
    expect(idleLimitMs("web", {})).toBe(DEFAULT_IDLE_MINUTES * 60_000);
    expect(idleLimitMs(null, {})).toBe(30 * 60_000);
    expect(idleLimitMs("android", {})).toBe(DEFAULT_MOBILE_IDLE_MINUTES * 60_000);
    expect(idleLimitMs("ios", { SESSION_IDLE_MOBILE_MINUTES: "60" })).toBe(60 * 60_000);
  });
  it("une valeur invalide ne desactive jamais la limite", () => {
    for (const bad of ["0", "-5", "abc", " ", "Infinity"]) {
      expect(idleLimitMs("web", { SESSION_IDLE_MINUTES: bad })).toBe(30 * 60_000);
    }
  });
  it("expire au-dela de la limite, a partir de lastSeenAt ou a defaut de createdAt", () => {
    const limit = idleLimitMs("web", {});
    expect(isIdle({ lastSeenAt: ago(29), createdAt: ago(500) }, limit, now)).toBe(false);
    expect(isIdle({ lastSeenAt: ago(31), createdAt: ago(500) }, limit, now)).toBe(true);
    expect(isIdle({ lastSeenAt: null, createdAt: ago(31) }, limit, now)).toBe(true);
    expect(isIdle({ lastSeenAt: null, createdAt: ago(5) }, limit, now)).toBe(false);
  });
  it("n'ecrit l'activite qu'une fois par minute au plus", () => {
    expect(needsTouch({ lastSeenAt: new Date(now.getTime() - 30_000), createdAt: ago(10) }, now)).toBe(false);
    expect(needsTouch({ lastSeenAt: ago(2), createdAt: ago(10) }, now)).toBe(true);
    expect(needsTouch({ lastSeenAt: null, createdAt: ago(10) }, now)).toBe(true);
  });
});
