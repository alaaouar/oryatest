import type { Prisma } from "@prisma/client";
import { dayStatus, DEFAULT_WORKING_DAYS } from "../core/calendar-rules";

/**
 * t92 (CDC M2) : statut d'une date civile pour une école, dans une transaction déjà ouverte
 * (contexte d'école : RLS ; contexte système : schoolId explicite obligatoire).
 */
export async function schoolDayIn(tx: Prisma.TransactionClient, schoolId: string, date: Date) {
  const [calendar, holidays] = await Promise.all([
    tx.schoolCalendar.findFirst({ where: { schoolId }, select: { workingDays: true } }),
    tx.schoolHoliday.findMany({
      where: { schoolId, startDate: { lte: date }, endDate: { gte: date } },
      select: { id: true, label: true, startDate: true, endDate: true },
      take: 1,
    }),
  ]);
  const status = dayStatus(date, calendar?.workingDays ?? DEFAULT_WORKING_DAYS, holidays);
  return { ...status, configured: !!calendar };
}
