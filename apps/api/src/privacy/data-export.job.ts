import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DataExportService } from "./data-export.service";

/**
 * Traitement asynchrone des exports (DATA_EXPORT_JOB_MS, defaut 60 s, minimum 1 s)
 * et expiration a 7 jours. DATA_EXPORT_JOB_DISABLED=1 : traitement par
 * prisma/run-data-export.ts (tests, horloge simulee).
 */
@Injectable()
export class DataExportJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataExportJob.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly exports: DataExportService) {}

  onModuleInit(): void {
    if ((process.env.DATA_EXPORT_JOB_DISABLED ?? "") === "1") return;
    const every = Math.max(1000, Number(process.env.DATA_EXPORT_JOB_MS ?? 60_000));
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.exports
        .processDue()
        .then(() => this.exports.purgeExpiredExports())
        .catch((e) => this.logger.error(`Export : echec global ${e instanceof Error ? e.message : e}`))
        .finally(() => {
          this.running = false;
        });
    }, every);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}