import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ParentSpaceModule } from "../parent-space/parent-space.module";
import { BusController } from "./bus.controller";
import { BusService } from "./bus.service";
import { CircuitsController } from "./circuits.controller";
import { CircuitsService } from "./circuits.service";

/** Bloc 4 : statut du bus (sans carte ni position). */
@Module({
  imports: [AuditModule, ParentSpaceModule],
  controllers: [BusController, CircuitsController],
  providers: [BusService, CircuitsService],
  exports: [BusService],
})
export class BusModule {}