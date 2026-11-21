import { Injectable, Logger } from "@nestjs/common";
import { schoolDayIn } from "../calendar/calendar.query";
import { localParts } from "../core/calendar-rules";
import { parseCivilDate, schoolYearForDate } from "../core/school-year";
import { TenancyService } from "../core/tenancy.service";
import { NotificationsService } from "../parent-space/notifications.service";
import { frenchDay, isReminderWindow, reminderLink } from "./attendance-rules";

export type ReminderRun = {
  at: string;
  schools: number;
  outsideWindow: number;
  notSchoolDay: number;
  reminders: number;
};

/**
 * t92 (CDC M3) : rappel « appel non fait » a partir de 7h45 (heure locale de l'ecole).
 * Pour chaque ecole active, un jour de classe (calendrier M2), entre 7h45 et 12h00 :
 * chaque enseignant affecte a une classe dont l'appel du matin n'est pas ouvert recoit
 * une notification in-app, une seule fois par classe et par jour (lien unique).
 * Entree systeme : appelee seulement par attendance-reminder.job.ts et
 * prisma/run-attendance-reminders.ts (controle T15).
 */
@Injectable()
export class AttendanceReminderService {
  private readonly logger = new Logger(AttendanceReminderService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly notifications: NotificationsService,
  ) {}

  async runReminders(now: Date = new Date()): Promise<ReminderRun> {
    const result: ReminderRun = { at: now.toISOString(), schools: 0, outsideWindow: 0, notSchoolDay: 0, reminders: 0 };
    await this.tenancy.runSystem(async (tx) => {
      const schools = await tx.school.findMany({ where: { status: "active" }, select: { id: true, timezone: true } });
      for (const school of schools) {
        result.schools += 1;
        const local = localParts(now, school.timezone);
        if (!isReminderWindow(local.minutes)) {
          result.outsideWindow += 1;
          continue;
        }
        const date = parseCivilDate(local.date);
        const day = await schoolDayIn(tx, school.id, date);
        if (!day.schoolDay) {
          result.notSchoolDay += 1;
          continue;
        }
        const assignments = await tx.teacherClassroomAssignment.findMany({
          where: { schoolId: school.id, schoolYear: schoolYearForDate(date) },
          select: { classroomId: true, classroom: { select: { name: true } }, teacherProfile: { select: { userId: true } } },
        });
        if (assignments.length === 0) continue;
        const opened = await tx.attendanceSession.findMany({
          where: { schoolId: school.id, date, slot: "morning", classroomId: { in: [...new Set(assignments.map((a) => a.classroomId))] } },
          select: { classroomId: true },
        });
        const done = new Set(opened.map((s) => s.classroomId));
        for (const a of assignments) {
          if (done.has(a.classroomId)) continue;
          const link = reminderLink(a.classroomId, local.date);
          const userId = a.teacherProfile.userId;
          const already = await tx.notification.count({
            where: { schoolId: school.id, userId, kind: "attendance.reminder", link },
          });
          if (already > 0) continue;
          result.reminders += await this.notifications.notifyUsers(tx, school.id, [userId], {
            kind: "attendance.reminder",
            title: `Appel non fait : ${a.classroom.name} (${frenchDay(date)}, matin)`,
            body: "L'appel du matin n'est pas encore ouvert pour cette classe.",
            link,
          });
        }
      }
    });
    if (result.reminders > 0) this.logger.log(`Rappel d'appel : ${result.reminders} notification(s)`);
    return result;
  }
}
