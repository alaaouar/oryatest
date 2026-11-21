/**
 * t92 (CDC M2) : règles pures du calendrier scolaire.
 * Jours ISO : 1 = lundi … 7 = dimanche. Dates civiles en UTC date-only (comme AttendanceSession.date).
 */
export const DEFAULT_WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6];
export const MAX_HOLIDAY_DAYS = 120;

export type HolidayLike = { id: string; label: string; startDate: Date; endDate: Date };
export type DayReason = "holiday" | "non_working_day" | null;

export function isoWeekday(civil: Date): number {
  const d = civil.getUTCDay();
  return d === 0 ? 7 : d;
}

/** Trie et dédoublonne ; refuse une liste vide ou un jour hors 1..7. */
export function normalizeWorkingDays(days: readonly number[]): number[] {
  const out = [...new Set(days)].sort((a, b) => a - b);
  if (out.length === 0 || out.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    throw new RangeError("Jours ouvrés attendus : entiers de 1 (lundi) à 7 (dimanche), au moins un.");
  }
  return out;
}

/** Nombre de jours civils inclus entre deux dates (bornes comprises). */
export function spanDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function dayStatus(
  date: Date,
  workingDays: readonly number[],
  holidays: readonly HolidayLike[],
): { schoolDay: boolean; reason: DayReason; holiday: HolidayLike | null } {
  const t = date.getTime();
  const holiday = holidays.find((h) => h.startDate.getTime() <= t && t <= h.endDate.getTime()) ?? null;
  if (holiday) return { schoolDay: false, reason: "holiday", holiday };
  if (!workingDays.includes(isoWeekday(date))) return { schoolDay: false, reason: "non_working_day", holiday: null };
  return { schoolDay: true, reason: null, holiday: null };
}

/** Date civile (AAAA-MM-JJ) et minutes depuis minuit dans le fuseau de l'école. */
export function localParts(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}
