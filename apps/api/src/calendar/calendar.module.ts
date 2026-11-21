import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";

/** t92 (CDC M2) : calendrier scolaire (jours ouvrés, vacances). */
@Module({
  imports: [AuditModule],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
