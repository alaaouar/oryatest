import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { FileRetentionService } from "./file-retention.service";

/**
 * Planificateur quotidien de la purge de conservation des fichiers.
 * FILE_RETENTION_JOB_MS (defaut 24 h) ; FILE_RETENTION_JOB_DISABLED=1 en test
 * (la purge est alors lancee par prisma/run-file-purge.ts --at=, horloge simulee).
 */
@Injectable()
export class FileRetentionJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileRetentionJob.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly retention: FileRetentionService) {}

  onModuleInit(): void {
    if ((process.env.FILE_RETENTION_JOB_DISABLED ?? "") === "1") return;
    const every = Math.max(60_000, Number(process.env.FILE_RETENTION_JOB_MS ?? 86_400_000));
    this.timer = setInterval(() => {
      void this.retention.purgeExpired().then(
        (r) => this.logger.log(`Purge fichiers : ${r.purged} purge(s), ${r.failed} echec(s)`),
        (e) => this.logger.error(`Purge fichiers : echec global ${e instanceof Error ? e.message : e}`),
      );
    }, every);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}