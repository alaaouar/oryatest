import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AccountDeletionService } from "./account-deletion.service";

/**
 * Planificateur quotidien du job d'anonymisation.
 * Intervalle configurable : ACCOUNT_DELETION_JOB_MS (defaut 24h).
 * En test : desactiver avec ACCOUNT_DELETION_JOB_DISABLED=1 et appeler runDueJob.
 */
@Injectable()
export class AccountDeletionJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountDeletionJob.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deletions: AccountDeletionService) {}

  onModuleInit(): void {
    if ((process.env.ACCOUNT_DELETION_JOB_DISABLED ?? "") === "1") {
      this.logger.log("Job de suppression desactive (ACCOUNT_DELETION_JOB_DISABLED=1).");
      return;
    }
    const every = Math.max(60_000, Number(process.env.ACCOUNT_DELETION_JOB_MS ?? 86_400_000));
    this.timer = setInterval(() => {
      void this.deletions.runDueJob().then(
        (r) => this.logger.log(`Job suppression : ${r.processed} traite(s), ${r.failed} echec(s)`),
        (e) => this.logger.error(`Job suppression : echec global ${e instanceof Error ? e.message : e}`),
      );
    }, every);
    // Ne pas empecher l'arret du process Node.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
