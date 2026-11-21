import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ConsentModule } from "../consent/consent.module";
import { ParentSpaceModule } from "../parent-space/parent-space.module";
import { AccountDeletionController } from "./account-deletion.controller";
import { AccountDeletionService } from "./account-deletion.service";
import { AccountDeletionJob } from "./account-deletion.job";

@Module({
  imports: [AuditModule, AuthModule, ConsentModule, ParentSpaceModule],
  controllers: [AccountDeletionController],
  providers: [AccountDeletionService, AccountDeletionJob],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
