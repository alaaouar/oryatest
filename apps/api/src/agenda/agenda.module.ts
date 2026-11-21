import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ChannelsModule } from "../channels/channels.module";
import { StorageModule } from "../storage/storage.module";
import { AgendaController, FamilyAgendaController } from "./agenda.controller";
import { AgendaService } from "./agenda.service";

/** Lot 6 : agenda de classe, dates importantes, devoirs avec pièces jointes privées. */
@Module({
  imports: [AuditModule, StorageModule, ChannelsModule],
  controllers: [AgendaController, FamilyAgendaController],
  providers: [AgendaService],
})
export class AgendaModule {}
