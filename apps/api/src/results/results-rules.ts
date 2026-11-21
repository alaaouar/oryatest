/**
 * t92 (CDC M7) : regles pures des resultats et du resume hebdomadaire (testees en unitaire).
 */
import { isoWeekday } from "../core/calendar-rules";

export const DEFAULT_MAX_SCORE = 20;
/** Resume hebdomadaire : a partir du vendredi 16h (heure de l'ecole), rattrapage samedi et dimanche. */
export const WEEKLY_SUMMARY_FRIDAY_MINUTES = 16 * 60;

/** Note valide : absente (null) ou entre 0 et le bareme, au plus 2 decimales. */
export function validScore(score: number | null | undefined, maxScore: number): boolean {
  if (score === null || score === undefined) return true;
  if (!Number.isFinite(score) || score < 0 || score > maxScore) return false;
  return Math.abs(Math.round(score * 100) - score * 100) < 1e-6;
}

export function weeklySummaryDue(civil: Date, localMinutes: number): boolean {
  const day = isoWeekday(civil);
  return (day === 5 && localMinutes >= WEEKLY_SUMMARY_FRIDAY_MINUTES) || day === 6 || day === 7;
}

const DAY_MS = 86_400_000;

/** Semaine civile (lundi -> dimanche) contenant la date. */
export function weekBounds(civil: Date): { start: Date; end: Date } {
  const start = new Date(civil.getTime() - (isoWeekday(civil) - 1) * DAY_MS);
  return { start, end: new Date(start.getTime() + 6 * DAY_MS) };
}

export function addDays(civil: Date, days: number): Date {
  return new Date(civil.getTime() + days * DAY_MS);
}

export type WeeklyCounts = { absences: number; lates: number; results: number; upcoming: number };

export function weeklySummaryBody(c: WeeklyCounts): string {
  return (
    `${c.absences} absence(s), ${c.lates} retard(s), ${c.results} r\u00e9sultat(s) publi\u00e9(s) cette semaine ; ` +
    `${c.upcoming} devoir(s) ou contr\u00f4le(s) la semaine prochaine.`
  );
}
