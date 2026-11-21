import { describe, expect, it } from "vitest";
import { dayStatus, isoWeekday, localParts, normalizeWorkingDays, spanDays } from "../../src/core/calendar-rules";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const autumn = { id: "h1", label: "Vacances d'automne", startDate: d("2026-11-23"), endDate: d("2026-11-29") };

describe("calendrier scolaire (CDC M2)", () => {
  it("numerote les jours ISO (lundi = 1, dimanche = 7)", () => {
    expect(isoWeekday(d("2026-11-16"))).toBe(1);
    expect(isoWeekday(d("2026-11-22"))).toBe(7);
  });
  it("trie, dedoublonne et refuse les jours invalides", () => {
    expect(normalizeWorkingDays([5, 1, 2, 3, 4, 1])).toEqual([1, 2, 3, 4, 5]);
    expect(() => normalizeWorkingDays([])).toThrow();
    expect(() => normalizeWorkingDays([0, 8])).toThrow();
  });
  it("les vacances priment sur les jours ouvres, bornes incluses", () => {
    expect(dayStatus(d("2026-11-23"), [1, 2, 3, 4, 5], [autumn]).reason).toBe("holiday");
    expect(dayStatus(d("2026-11-29"), [1, 2, 3, 4, 5, 6, 7], [autumn]).reason).toBe("holiday");
    expect(dayStatus(d("2026-11-21"), [1, 2, 3, 4, 5], [autumn]).reason).toBe("non_working_day");
    expect(dayStatus(d("2026-11-20"), [1, 2, 3, 4, 5], [autumn])).toMatchObject({ schoolDay: true, reason: null });
    expect(spanDays(d("2026-11-23"), d("2026-11-29"))).toBe(7);
  });
  it("calcule la date et l'heure locales dans le fuseau de l'ecole", () => {
    const p = localParts(new Date("2026-11-16T07:50:00.000Z"), "UTC");
    expect(p).toEqual({ date: "2026-11-16", minutes: 7 * 60 + 50 });
    const c = localParts(new Date("2026-11-16T23:30:00.000Z"), "Africa/Casablanca");
    expect(["2026-11-16", "2026-11-17"]).toContain(c.date);
  });
});
