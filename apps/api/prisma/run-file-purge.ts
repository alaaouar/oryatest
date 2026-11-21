/**
 * Purge de conservation des fichiers (ops / tests), sans charger AppModule.
 * --at=ISO8601 simule l'horloge.
 */
import { PrismaClient } from "@prisma/client";
import { TenancyService } from "../src/core/tenancy.service";
import { AntivirusService } from "../src/storage/antivirus";
import { FileRetentionService } from "../src/storage/file-retention.service";
import { createDriver } from "../src/storage/storage.module";
import { StorageService } from "../src/storage/storage.service";

async function main(): Promise<void> {
  const atArg = process.argv.find((a) => a.startsWith("--at="));
  const now = atArg ? new Date(atArg.slice(5)) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("--at invalide");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente");
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: ["warn", "error"] }) as unknown as import("../src/core/prisma.service").PrismaService;
  await (prisma as PrismaClient).$connect();
  try {
    const tenancy = new TenancyService(prisma);
    const storage = new StorageService(createDriver(), new AntivirusService());
    const result = await new FileRetentionService(tenancy, storage).purgeExpired(now);
    process.stdout.write(`${JSON.stringify({ at: now.toISOString(), ...result })}\n`);
  } finally {
    await (prisma as PrismaClient).$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});