import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { StorageModule } from "../storage/storage.module";
import { ParentActionsService } from "./actions.service";
import {
  FamilySpaceController,
  JustificationsController,
  JustificationStatusController,
  NotificationsController,
  ParentActionsController,
} from "./controllers";
import { JustificationsService } from "./justifications.service";
import { NotificationsService } from "./notifications.service";

/** Lot 4 : espace parents (justificatifs, actions demandées, notifications). */
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [FamilySpaceController, JustificationsController, JustificationStatusController, ParentActionsController, NotificationsController],
  providers: [JustificationsService, ParentActionsService, NotificationsService],
  exports: [NotificationsService, JustificationsService],
})
export class ParentSpaceModule {}
