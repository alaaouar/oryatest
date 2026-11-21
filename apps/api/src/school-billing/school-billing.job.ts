import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { SchoolBillingService } from "./school-billing.service";

/**
 * Bloc 5 : evaluation periodique des statuts de facturation (facture -> en retard -> suspendu,
 * retour a "paye" apres rapprochement). Intervalle SCHOOL_BILLING_JOB_MS (defaut 6 h).
 * En test : SCHOOL_BILLING_JOB_DISABLED=1 et POST admin/billing/evaluate.
 */
@Injectable()
export class SchoolBillingJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchoolBillingJob.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly billing: SchoolBillingService) {}

  onModuleInit(): void {
    if ((process.env.SCHOOL_BILLING_JOB_DISABLED ?? "") === "1") {
      this.logger.log("Job facturation desactive (SCHOOL_BILLING_JOB_DISABLED=1).");
      return;
    }
    const every = Math.max(60_000, Number(process.env.SCHOOL_BILLING_JOB_MS ?? 6 * 3_600_000));
    this.timer = setInterval(() => {
      void this.billing.evaluateAllDue().catch((e: unknown) => this.logger.error(`Job facturation : echec ${e instanceof Error ? e.message : String(e)}`));
    }, every);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}