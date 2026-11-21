import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ParentSpaceModule } from "../parent-space/parent-space.module";
import { TransportController } from "./transport.controller";
import { TransportService } from "./transport.service";
import { TransportEtaService } from "./transport-eta.service";
import { TransportRealtimeService } from "./transport-realtime.service";
import { TransportNotificationService } from "./transport-notification.service";

@Module({
  imports: [AuditModule, ParentSpaceModule],
  controllers: [TransportController],
  providers: [
    TransportService,
    TransportEtaService,
    TransportRealtimeService,
    TransportNotificationService,
  ],
  exports: [TransportService, TransportRealtimeService],
})
export class TransportModule {}
