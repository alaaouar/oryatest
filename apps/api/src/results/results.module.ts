import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ParentSpaceModule } from "../parent-space/parent-space.module";
import { FamilyResultsController, ResultsController } from "./results.controller";
import { ResultsService } from "./results.service";
import { WeeklySummaryJob } from "./weekly-summary.job";
import { WeeklySummaryService } from "./weekly-summary.service";

/** t92 (CDC M7) : résultats et résumé hebdomadaire. */
@Module({
  imports: [AuditModule, ParentSpaceModule],
  controllers: [ResultsController, FamilyResultsController],
  providers: [ResultsService, WeeklySummaryService, WeeklySummaryJob],
})
export class ResultsModule {}
