/**
 * Année scolaire marocaine approximative : du 1er septembre au 31 août.
 * Exemple : 15 octobre 2026 → "2026-2027" ; 10 mars 2027 → "2026-2027".
 */
export function schoolYearForDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  if (month >= 9) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

/** Parse une date civile AAAA-MM-JJ en Date UTC (date-only). */
export function parseCivilDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("date invalide");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("date invalide");
  }
  return parsed;
}
