import { Injectable, Logger } from "@nestjs/common";
import { localParts } from "../core/calendar-rules";
import { parseCivilDate, schoolYearForDate } from "../core/school-year";
import { TenancyService } from "../core/tenancy.service";
import { NotificationsService } from "../parent-space/notifications.service";
import { frenchDay } from "../attendance/attendance-rules";
import { addDays, weekBounds, weeklySummaryBody, weeklySummaryDue } from "./results-rules";

export type WeeklyRun = { at: string; schools: number; notDue: number; summaries: number };

/**
 * t92 (CDC M7) : résumé hebdomadaire aux familles (notification in-app), par enfant :
 * absences et retards (séances clôturées), résultats publiés de la semaine, devoirs et
 * contrôles de la semaine suivante. Vendredi à partir de 16h (heure de l'école), rattrapage
 * le week-end ; une seule fois par semaine, enfant et parent (lien unique).
 * Entrée système : weekly-summary.job.ts et prisma/run-weekly-summary.ts seulement (T15).
 */
@Injectable()
export class WeeklySummaryService {
  private readonly logger = new Logger(WeeklySummaryService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly notifications: NotificationsService,
  ) {}

  async runWeekly(now: Date = new Date()): Promise<WeeklyRun> {
    const result: WeeklyRun = { at: now.toISOString(), schools: 0, notDue: 0, summaries: 0 };
    await this.tenancy.runSystem(async (tx) => {
      const schools = await tx.school.findMany({ where: { status: "active" }, select: { id: true, timezone: true } });
      for (const school of schools) {
        result.schools += 1;
        const local = localParts(now, school.timezone);
        const today = parseCivilDate(local.date);
        if (!weeklySummaryDue(today, local.minutes)) {
          result.notDue += 1;
          continue;
        }
        const { start, end } = weekBounds(today);
        const weekKey = start.toISOString().slice(0, 10);
        const enrollments = await tx.enrollment.findMany({
          where: { schoolId: school.id, schoolYear: schoolYearForDate(start) },
          select: {
            studentId: true,
            classroomId: true,
            student: {
              select: {
                displayName: true,
                guardians: { where: { guardian: { userId: { not: null } } }, select: { guardian: { select: { userId: true } } } },
              },
            },
          },
        });
        for (const e of enrollments) {
          const userIds = [...new Set(e.student.guardians.map((g) => g.guardian.userId).filter((u): u is string => !!u))];
          if (userIds.length === 0) continue;
          const link = `/family?resume=${weekKey}&eleve=${e.studentId}`;
          const already = await tx.notification.findMany({
            where: { schoolId: school.id, kind: "summary.weekly", link, userId: { in: userIds } },
            select: { userId: true },
          });
          const done = new Set(already.map((n) => n.userId));
          const targets = userIds.filter((u) => !done.has(u));
          if (targets.length === 0) continue;
          const inWeek = { gte: start, lte: end };
          const [absences, lates, results, upcoming] = await Promise.all([
            tx.attendanceRow.count({ where: { studentId: e.studentId, status: "absent", session: { status: "closed", date: inWeek } } }),
            tx.attendanceRow.count({ where: { studentId: e.studentId, status: "late", session: { status: "closed", date: inWeek } } }),
            tx.assessmentResult.count({
              where: { studentId: e.studentId, assessment: { publishedAt: { not: null }, date: inWeek } },
            }),
            tx.agendaItem.count({
              where: {
                schoolId: school.id,
                cancelledAt: null,
                kind: { in: ["homework", "test"] },
                date: { gte: addDays(end, 1), lte: addDays(end, 7) },
                OR: [{ classroomId: null }, { classroomId: e.classroomId }],
              },
            }),
          ]);
          result.summaries += await this.notifications.notifyUsers(tx, school.id, targets, {
            kind: "summary.weekly",
            title: `R\u00e9sum\u00e9 de la semaine du ${frenchDay(start)} : ${e.student.displayName}`,
            body: weeklySummaryBody({ absences, lates, results, upcoming }),
            link,
          });
        }
      }
    });
    if (result.summaries > 0) this.logger.log(`Résumé hebdomadaire : ${result.summaries} notification(s)`);
    return result;
  }
}
