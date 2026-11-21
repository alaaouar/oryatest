/**
 * Declenche le job d'anonymisation (ops / tests), sans charger AppModule.
 * --at=ISO8601 simule l'horloge.
 */
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { AccountDeletionService } from "../src/account/account-deletion.service";
import { AuditService } from "../src/audit/audit.service";
import { MfaService } from "../src/auth/mfa.service";
import { ConsentService } from "../src/consent/consent.service";
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
    const audit = new AuditService(prisma, tenancy);
    const config = new ConfigService({ MFA_ENCRYPTION_KEY: process.env.MFA_ENCRYPTION_KEY ?? "" });
    const mfa = new MfaService(config);
    const notifications = new NotificationsService(tenancy);
    const consents = new ConsentService(prisma, tenancy, audit);
    const svc = new AccountDeletionService(prisma, tenancy, audit, mfa, consents, notifications);
    svc.setClock({ now: () => now });
    const result = await svc.runDueJob({ clock: { now: () => now } });
    process.stdout.write(`${JSON.stringify({ at: now.toISOString(), ...result })}\n`);
  } finally {
    await (prisma as PrismaClient).$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
