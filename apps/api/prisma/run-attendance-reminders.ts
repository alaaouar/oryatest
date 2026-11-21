/**
 * t92 (CDC M3) : declenche le rappel d'appel (ops / tests), sans charger AppModule.
 * --at=ISO8601 simule l'horloge.
 */
import { PrismaClient } from "@prisma/client";
import { AttendanceReminderService } from "../src/attendance/attendance-reminder.service";
import { TenancyService } from "../src/core/tenancy.service";
import { NotificationsService } from "../src/parent-space/notifications.service";

async function main(): Promise<void> {
  const atArg = process.argv.find((a) => a.startsWith("--at="));
  const now = atArg ? new Date(atArg.slice(5)) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("--at invalide");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente");

  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: ["warn", "error"] }) as unknown as import("../src/core/prisma.service").PrismaService;
  await (prisma as PrismaClient).$connect();
  try {
    const tenancy = new TenancyService(prisma);
    const svc = new AttendanceReminderService(tenancy, new NotificationsService(tenancy));
    const result = await svc.runReminders(now);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await (prisma as PrismaClient).$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
