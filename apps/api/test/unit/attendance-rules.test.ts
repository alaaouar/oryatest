import { describe, expect, it } from "vitest";
import {
  absenceActionTitle,
  absenceActionsToCreate,
  actionKey,
  frenchDay,
  isAbsenceMark,
  effectiveClientTime,
  slotLabel,
  syncDecision,
  type CloseRow,
} from "../../src/attendance/attendance-rules";

const date = new Date("2026-11-13T00:00:00Z");
const row = (studentId: string, status: string, linkedGuardians = 1, slot = "morning"): CloseRow => ({ studentId, status, date, slot, linkedGuardians });

describe("cloture d'appel -> cartes ParentAction (P0-5, CDC M3)", () => {
  it("intitule : type, date JJ/MM/AAAA et demi-journee", () => {
    expect(frenchDay(date)).toBe("13/11/2026");
    expect(slotLabel("morning")).toBe("matin");
    expect(slotLabel("afternoon")).toBe("apr\u00e8s-midi");
    expect(absenceActionTitle("absent", date, "morning")).toBe("Justifier l'absence du 13/11/2026 (matin)");
    expect(absenceActionTitle("late", date, "afternoon")).toBe("Justifier le retard du 13/11/2026 (apr\u00e8s-midi)");
  });

  it("seuls absent et retard declenchent", () => {
    expect(isAbsenceMark("absent")).toBe(true);
    expect(isAbsenceMark("late")).toBe(true);
    expect(isAbsenceMark("present")).toBe(false);
    expect(isAbsenceMark("excused")).toBe(false);
  });

  it("une carte par eleve absent/en retard ayant au moins un parent active", () => {
    const out = absenceActionsToCreate([row("s1", "absent"), row("s2", "late"), row("s3", "present"), row("s4", "absent", 0)], new Set());
    expect(out).toEqual([
      { studentId: "s1", title: "Justifier l'absence du 13/11/2026 (matin)" },
      { studentId: "s2", title: "Justifier le retard du 13/11/2026 (matin)" },
    ]);
  });

  it("idempotent : reouverture puis nouvelle cloture ne recree pas une carte existante", () => {
    const existing = new Set([actionKey("s1", "Justifier l'absence du 13/11/2026 (matin)")]);
    expect(absenceActionsToCreate([row("s1", "absent"), row("s2", "absent")], existing)).toEqual([
      { studentId: "s2", title: "Justifier l'absence du 13/11/2026 (matin)" },
    ]);
  });

  it("pas de doublon dans un meme lot ; matin et apres-midi sont distincts", () => {
    const out = absenceActionsToCreate([row("s1", "absent"), row("s1", "absent"), row("s1", "absent", 1, "afternoon")], new Set());
    expect(out.map((o) => o.title)).toEqual(["Justifier l'absence du 13/11/2026 (matin)", "Justifier l'absence du 13/11/2026 (apr\u00e8s-midi)"]);
  });
});

describe("synchronisation hors ligne (F03 / B11, ADR-003)", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  const at = (iso: string) => new Date(iso);

  it("heure client bornee a l'heure serveur ; illisible -> heure serveur", () => {
    expect(effectiveClientTime("2026-11-15T09:30:00Z", now).toISOString()).toBe("2026-11-15T09:30:00.000Z");
    expect(effectiveClientTime("2030-01-01T00:00:00Z", now).toISOString()).toBe(now.toISOString());
    expect(effectiveClientTime("n'importe quoi", now).toISOString()).toBe(now.toISOString());
  });

  it("session cloturee : le serveur gagne, quel que soit le reste", () => {
    expect(syncDecision({ sessionClosed: true, known: null, current: null, clientAt: now })).toBe("closed");
    expect(syncDecision({ sessionClosed: true, known: { sameRow: true }, current: null, clientAt: now })).toBe("closed");
  });

  it("rejeu idempotent : meme identifiant, meme ligne -> duplicate ; autre ligne -> rejected", () => {
    expect(syncDecision({ sessionClosed: false, known: { sameRow: true }, current: { recordedAt: at("2026-11-15T08:00:00Z") }, clientAt: now })).toBe("duplicate");
    expect(syncDecision({ sessionClosed: false, known: { sameRow: false }, current: null, clientAt: now })).toBe("rejected");
  });

  it("session ouverte : dernier ecrit gagne (egalite appliquee), ancienne mutation -> stale", () => {
    const current = { recordedAt: at("2026-11-15T09:00:00Z") };
    expect(syncDecision({ sessionClosed: false, known: null, current: null, clientAt: at("2026-11-15T08:00:00Z") })).toBe("applied");
    expect(syncDecision({ sessionClosed: false, known: null, current, clientAt: at("2026-11-15T09:00:00Z") })).toBe("applied");
    expect(syncDecision({ sessionClosed: false, known: null, current, clientAt: at("2026-11-15T09:00:01Z") })).toBe("applied");
    expect(syncDecision({ sessionClosed: false, known: null, current, clientAt: at("2026-11-15T08:59:59Z") })).toBe("stale");
  });
});