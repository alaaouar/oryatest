import { Module } from "@nestjs/common";
import { ActivationModule } from "../activation/activation.module";
import { AuditModule } from "../audit/audit.module";
import { FamilyController } from "./family.controller";
import { FamilyService } from "./family.service";
import { GuardiansController } from "./guardians.controller";
import { GuardiansService } from "./guardians.service";

@Module({
  imports: [AuditModule, ActivationModule],
  controllers: [GuardiansController, FamilyController],
  providers: [GuardiansService, FamilyService],
})
export class FamiliesModule {}
