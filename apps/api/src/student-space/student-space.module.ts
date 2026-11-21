import { Module } from "@nestjs/common";
import { ActivationModule } from "../activation/activation.module";
import { StudentAccountService } from "./student-account.service";
import { StudentAccessService } from "./student-access.service";
import { StudentAccountController, StudentSpaceController } from "./student-space.controller";
import { StudentSpaceService } from "./student-space.service";

/** Bloc 4 : compte et espace eleve (consultation seule, consentement actif). */
@Module({
  imports: [ActivationModule],
  controllers: [StudentSpaceController, StudentAccountController],
  providers: [StudentAccessService, StudentSpaceService, StudentAccountService],
})
export class StudentSpaceModule {}