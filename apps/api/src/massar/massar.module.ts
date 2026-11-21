import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { MassarController } from "./massar.controller";
import { MassarService } from "./massar.service";

/** Lot 8 : préparation des données et exports compatibles saisie Massar. */
@Module({
  imports: [AuditModule],
  controllers: [MassarController],
  providers: [MassarService],
})
export class MassarModule {}
