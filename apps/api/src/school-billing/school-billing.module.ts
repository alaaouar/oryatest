import { Module } from "@nestjs/common";
import { SchoolBillingAdminController, SchoolBillingDirectionController } from "./school-billing.controller";
import { SchoolBillingJob } from "./school-billing.job";
import { SchoolBillingService } from "./school-billing.service";

/** Bloc 5 (Avenant n 1) : facturation ecole (contrat, factures, avoirs, rapprochement, statuts). */
@Module({
  controllers: [SchoolBillingAdminController, SchoolBillingDirectionController],
  providers: [SchoolBillingService, SchoolBillingJob],
})
export class SchoolBillingModule {}