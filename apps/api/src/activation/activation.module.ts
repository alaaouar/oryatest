import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ActivationController } from "./activation.controller";
import { ActivationService } from "./activation.service";
import { AttemptThrottleService } from "./attempt-throttle.service";

@Module({
  imports: [AuditModule],
  controllers: [ActivationController],
  providers: [ActivationService, AttemptThrottleService],
  exports: [ActivationService],
})
export class ActivationModule {}
