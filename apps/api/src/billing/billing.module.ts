import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditModule } from "../audit/audit.module";
import { BILLING_PROVIDER, NotConfiguredBillingProvider } from "./billing-provider";
import { SaasAdminController, SchoolBillingController } from "./saas.controller";
import { SaasService } from "./saas.service";
import { SubscriptionStatusInterceptor } from "./subscription.interceptor";

/** Lot 9 : abonnements, administration SaaS, préparation facturation. */
@Module({
  imports: [AuditModule],
  controllers: [SaasAdminController, SchoolBillingController],
  providers: [
    SaasService,
    { provide: BILLING_PROVIDER, useClass: NotConfiguredBillingProvider },
    { provide: APP_INTERCEPTOR, useClass: SubscriptionStatusInterceptor },
  ],
})
export class BillingModule {}
