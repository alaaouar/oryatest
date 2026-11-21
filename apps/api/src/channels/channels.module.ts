import { Module } from "@nestjs/common";
import { ParentSpaceModule } from "../parent-space/parent-space.module";
import { EmailChannel, InAppChannel, NotificationDispatcher } from "./channels";

@Module({
  imports: [ParentSpaceModule],
  providers: [InAppChannel, EmailChannel, NotificationDispatcher],
  exports: [NotificationDispatcher],
})
export class ChannelsModule {}
