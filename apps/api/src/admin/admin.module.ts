import { Module } from "@nestjs/common";
import { ActivationModule } from "../activation/activation.module";
import { AuditModule } from "../audit/audit.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [ActivationModule, AuditModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
