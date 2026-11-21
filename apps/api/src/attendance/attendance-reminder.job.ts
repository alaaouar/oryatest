import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AttendanceReminderService } from "./attendance-reminder.service";

/**
 * t92 (CDC M3) : planificateur du rappel d'appel (7h45, heure de l'ecole).
 * Intervalle : ATTENDANCE_REMINDER_JOB_MS (defaut 5 min, minimum 1 min).
 * En test : ATTENDANCE_REMINDER_JOB_DISABLED=1 et prisma/run-attendance-reminders.ts --at=ISO.
 */
@Injectable()
export class AttendanceReminderJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttendanceReminderJob.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly reminders: AttendanceReminderService) {}

  onModuleInit(): void {
    if ((process.env.ATTENDANCE_REMINDER_JOB_DISABLED ?? "") === "1") {
      this.logger.log("Rappel d'appel desactive (ATTENDANCE_REMINDER_JOB_DISABLED=1).");
      return;
    }
    const every = Math.max(60_000, Number(process.env.ATTENDANCE_REMINDER_JOB_MS ?? 300_000));
    this.timer = setInterval(() => {
      void this.reminders.runReminders().catch((e) =>
        this.logger.error(`Rappel d'appel : echec ${e instanceof Error ? e.message : e}`),
      );
    }, every);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
