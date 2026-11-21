import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { MeController } from "./me.controller";
import { MfaService } from "./mfa.service";
import { PasswordResetController } from "./password-reset.controller";
import { PasswordResetService } from "./password-reset.service";
import { SecurityModule } from "./security.module";

@Module({
  imports: [SecurityModule, AuditModule],
  controllers: [AuthController, MeController, PasswordResetController],
  providers: [AuthService, MfaService, PasswordResetService],
  exports: [AuthService, MfaService],
})
export class AuthModule {}
