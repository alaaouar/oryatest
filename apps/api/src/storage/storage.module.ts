import { Module } from "@nestjs/common";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AntivirusService } from "./antivirus";
import { FileRetentionJob } from "./file-retention.job";
import { FileRetentionService } from "./file-retention.service";
import { LocalStorageDriver } from "./local.driver";
import { S3StorageDriver } from "./s3.driver";
import { StorageService } from "./storage.service";
import { STORAGE_DRIVER, type StorageDriver } from "./storage.types";

export function createDriver(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") {
    return new S3StorageDriver();
  }
  if (driver !== "local") {
    throw new Error(`STORAGE_DRIVER inconnu : ${driver}`);
  }
  const dir = process.env.STORAGE_LOCAL_DIR;
  if (!dir && process.env.NODE_ENV === "production") {
    throw new Error("STORAGE_LOCAL_DIR est requis en production.");
  }
  return new LocalStorageDriver(dir ?? join(tmpdir(), "orya-private-storage"), process.env.STORAGE_ENCRYPTION_KEY || undefined);
}

@Module({
  providers: [
    { provide: STORAGE_DRIVER, useFactory: createDriver },
    AntivirusService,
    StorageService,
    FileRetentionService,
    FileRetentionJob,
  ],
  exports: [StorageService, FileRetentionService],
})
export class StorageModule {}