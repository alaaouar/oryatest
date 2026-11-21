/**
 * Bloc 4 : traitement des exports de donnees (ops / tests), sans charger AppModule.
 *   (sans option)      traite les demandes en attente (JSON + PDF, antivirus, stockage chiffre)
 *   --purge [--at=ISO] expire les exports de plus de 7 jours et retire les objets
 */
import { PrismaClient } from "@prisma/client";
import { AuditService } from "../src/audit/audit.service";
import { TenancyService } from "../src/core/tenancy.service";
import { DataExportService } from "../src/privacy/data-export.service";
import { AntivirusService } from "../src/storage/antivirus";
import { createDriver } from "../src/storage/storage.module";
import { StorageService } from "../src/storage/storage.service";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente");
  const atArg = process.argv.find((a) => a.startsWith("--at="));
  const now = atArg ? new Date(atArg.slice(5)) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("--at invalide");
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: ["warn", "error"] }) as unknown as import("../src/core/prisma.service").PrismaService;
  await (prisma as PrismaClient).$connect();
  try {
    const tenancy = new TenancyService(prisma);
    const storage = new StorageService(createDriver(), new AntivirusService());
    const service = new DataExportService(tenancy, storage, new AuditService(prisma, tenancy));
    const result = process.argv.includes("--purge") ? await service.purgeExpiredExports(now) : await service.processDue(50);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await (prisma as PrismaClient).$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});