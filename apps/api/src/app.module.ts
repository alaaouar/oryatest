import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { CookieSessionInterceptor } from "./auth/cookie-session.interceptor";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ActivationModule } from "./activation/activation.module";
import { AdminModule } from "./admin/admin.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { CalendarModule } from "./calendar/calendar.module";
import { ResultsModule } from "./results/results.module";
import { FamiliesModule } from "./families/families.module";
import { ParentSpaceModule } from "./parent-space/parent-space.module";
import { CommunicationModule } from "./communication/communication.module";
import { AgendaModule } from "./agenda/agenda.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { MassarModule } from "./massar/massar.module";
import { BillingModule } from "./billing/billing.module";
import { SchoolBillingModule } from "./school-billing/school-billing.module";
import { PlanLimitsModule } from "./billing/plan-limits.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { MailModule } from "./mail/mail.module";
import { SecurityModule } from "./auth/security.module";
import { CoreModule } from "./core/core.module";
import { HealthModule } from "./health/health.module";
import { ImportsModule } from "./imports/imports.module";
import { StudentsModule } from "./students/students.module";
import { ConsentModule } from "./consent/consent.module";
import { AccountDeletionModule } from "./account/account-deletion.module";
import { BusModule } from "./bus/bus.module";
import { TransportModule } from "./transport/transport.module";
import { StudentSpaceModule } from "./student-space/student-space.module";
import { PrivacyModule } from "./privacy/privacy.module";

/**
 * Validation de l'environnement au démarrage : mieux vaut un refus net au
 * lancement qu'une faille silencieuse en production.
 */
function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const databaseUrl = typeof config.DATABASE_URL === "string" ? config.DATABASE_URL : "";
  const jwtSecret =
    typeof config.JWT_ACCESS_SECRET === "string" ? config.JWT_ACCESS_SECRET : "";
  const mfaKey =
    typeof config.MFA_ENCRYPTION_KEY === "string" ? config.MFA_ENCRYPTION_KEY : "";

  const problems: string[] = [];

  if (!databaseUrl) {
    problems.push("DATABASE_URL est absente.");
  }
  if (jwtSecret.length < 32) {
    problems.push("JWT_ACCESS_SECRET est absente ou fait moins de 32 caractères.");
  }
  if (databaseUrl.includes("orya_owner")) {
    problems.push(
      "DATABASE_URL utilise le rôle orya_owner : le RLS serait contourné. Utilisez orya_app.",
    );
  }
  if (Buffer.from(mfaKey, "base64").length !== 32) {
    problems.push(
      "MFA_ENCRYPTION_KEY doit contenir 32 octets encodés en base64 (générez-la avec : node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\").",
    );
  }

  if (problems.length > 0) {
    throw new Error(`Configuration invalide :\n  - ${problems.join("\n  - ")}`);
  }

  return config;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    // Limitation de débit globale ; les routes sensibles resserrent la limite
    // avec @Throttle (connexion : 5 par minute et par IP).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.API_RATE_LIMIT ?? "120") }]),
    SecurityModule,
    CoreModule,
    HealthModule,
    AuditModule,
    MailModule,
    AuthModule,
    StudentsModule,
    ConsentModule,
    AccountDeletionModule,
    ActivationModule,
    AdminModule,
    ImportsModule,
    AttendanceModule,
    CalendarModule,
    ResultsModule,
    FamiliesModule,
    ParentSpaceModule,
    CommunicationModule,
    AgendaModule,
    DashboardModule,
    MassarModule,
    PlanLimitsModule,
    BillingModule,
    SchoolBillingModule,
    BusModule,
    TransportModule,
    StudentSpaceModule,
    PrivacyModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: CookieSessionInterceptor },
  ],
})
export class AppModule {}
