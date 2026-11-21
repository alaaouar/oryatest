/**
 * t92 (CDC M7) : déclenche le résumé hebdomadaire (ops / tests), sans charger AppModule.
 * --at=ISO8601 simule l'horloge.
 */
import { PrismaClient } from "@prisma/client";
import { TenancyService } from "../src/core/tenancy.service";
import { NotificationsService } from "../src/parent-space/notifications.service";
import { WeeklySummaryService } from "../src/results/weekly-summary.service";

async function main(): Promise<void> {
  const atArg = process.argv.find((a) => a.startsWith("--at="));
  const now = atArg ? new Date(atArg.slice(5)) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("--at invalide");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente");

  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: ["warn", "error"] }) as unknown as import("../src/core/prisma.service").PrismaService;
  await (prisma as PrismaClient).$connect();
  try {
    const tenancy = new TenancyService(prisma);
    const svc = new WeeklySummaryService(tenancy, new NotificationsService(tenancy));
    process.stdout.write(`${JSON.stringify(await svc.runWeekly(now))}\n`);
  } finally {
    await (prisma as PrismaClient).$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
