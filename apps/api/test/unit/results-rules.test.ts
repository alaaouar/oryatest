import { describe, expect, it } from "vitest";
import { validScore, weekBounds, weeklySummaryBody, weeklySummaryDue } from "../../src/results/results-rules";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("resultats et resume hebdomadaire (CDC M7)", () => {
  it("note entre 0 et le bareme, 2 decimales au plus, absente autorisee", () => {
    expect(validScore(null, 20)).toBe(true);
    expect(validScore(0, 20)).toBe(true);
    expect(validScore(15.5, 20)).toBe(true);
    expect(validScore(20, 20)).toBe(true);
    expect(validScore(20.01, 20)).toBe(false);
    expect(validScore(-1, 20)).toBe(false);
    expect(validScore(12.345, 20)).toBe(false);
    expect(validScore(Number.NaN, 20)).toBe(false);
  });
  it("resume du vendredi 16h au dimanche", () => {
    expect(weeklySummaryDue(d("2026-11-19"), 18 * 60)).toBe(false);
    expect(weeklySummaryDue(d("2026-11-20"), 15 * 60 + 59)).toBe(false);
    expect(weeklySummaryDue(d("2026-11-20"), 16 * 60)).toBe(true);
    expect(weeklySummaryDue(d("2026-11-22"), 9 * 60)).toBe(true);
    expect(weeklySummaryDue(d("2026-11-23"), 9 * 60)).toBe(false);
  });
  it("semaine civile lundi -> dimanche", () => {
    const w = weekBounds(d("2026-11-20"));
    expect(w.start.toISOString().slice(0, 10)).toBe("2026-11-16");
    expect(w.end.toISOString().slice(0, 10)).toBe("2026-11-22");
    expect(weekBounds(d("2026-11-22")).start.toISOString().slice(0, 10)).toBe("2026-11-16");
  });
  it("texte du resume", () => {
    expect(weeklySummaryBody({ absences: 1, lates: 0, results: 2, upcoming: 3 })).toBe(
      "1 absence(s), 0 retard(s), 2 résultat(s) publié(s) cette semaine ; 3 devoir(s) ou contrôle(s) la semaine prochaine.",
    );
  });
});
