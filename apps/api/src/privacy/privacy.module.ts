import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { StorageModule } from "../storage/storage.module";
import { DataExportJob } from "./data-export.job";
import { DataExportService } from "./data-export.service";
import { DataRightsService } from "./data-rights.service";
import { DataRightsController } from "./data-rights.controller";
import { PrivacyController } from "./privacy.controller";

/** Bloc 4 : droit d'acces (export), rectification et opposition. */
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [PrivacyController, DataRightsController],
  providers: [DataExportService, DataRightsService, DataExportJob],
  exports: [DataExportService],
})
export class PrivacyModule {}