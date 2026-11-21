import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ChannelsModule } from "../channels/channels.module";
import { FamilyMessagesController, MessagesController } from "./communication.controller";
import { CommunicationService } from "./communication.service";

/** Lot 5 : communication école-famille (in-app). */
@Module({
  imports: [AuditModule, ChannelsModule],
  controllers: [MessagesController, FamilyMessagesController],
  providers: [CommunicationService],
})
export class CommunicationModule {}
