import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { WeeklySummaryService } from "./weekly-summary.service";

/**
 * t92 (CDC M7) : planificateur du résumé hebdomadaire (vendredi 16h, heure de l'école).
 * Intervalle : WEEKLY_SUMMARY_JOB_MS (défaut 15 min, minimum 1 min).
 * En test : WEEKLY_SUMMARY_JOB_DISABLED=1 et prisma/run-weekly-summary.ts --at=ISO.
 */
@Injectable()
export class WeeklySummaryJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeeklySummaryJob.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly summaries: WeeklySummaryService) {}

  onModuleInit(): void {
    if ((process.env.WEEKLY_SUMMARY_JOB_DISABLED ?? "") === "1") {
      this.logger.log("Résumé hebdomadaire désactivé (WEEKLY_SUMMARY_JOB_DISABLED=1).");
      return;
    }
    const every = Math.max(60_000, Number(process.env.WEEKLY_SUMMARY_JOB_MS ?? 900_000));
    this.timer = setInterval(() => {
      void this.summaries.runWeekly().catch((e) =>
        this.logger.error(`Résumé hebdomadaire : échec ${e instanceof Error ? e.message : e}`),
      );
    }, every);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
