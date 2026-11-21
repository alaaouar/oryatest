import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { StorageModule } from "../storage/storage.module";
import { ConsentScanService } from "./consent-scan.service";
import { ConsentController } from "./consent.controller";
import { ConsentService } from "./consent.service";
import { ConsentOverviewService } from "./consent-overview.service";

@Module({
  imports: [AuditModule, StorageModule],
  controllers: [ConsentController],
  providers: [ConsentService, ConsentScanService, ConsentOverviewService],
  exports: [ConsentService],
})
export class ConsentModule {}
