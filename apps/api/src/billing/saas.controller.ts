import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { CreatePlanDto, DraftInvoiceDto, UpdatePlanDto, UpdateSubscriptionDto } from "./saas.dto";
import { SaasService } from "./saas.service";

/** Lot 9 : console super-admin (seul chemin inter-écoles, MFA obligatoire, audité). */
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("super_admin")
@RequireMfa()
export class SaasAdminController {
  constructor(private readonly saas: SaasService) {}

  @Get("overview")
  overview(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    return this.saas.overview(auth, clientInfo(req));
  }

  @Get("schools/:id")
  school(@CurrentAuth() auth: AuthContext, @Param("id") id: string, @Req() req: Request) {
    return this.saas.school(auth, id, clientInfo(req));
  }

  @Patch("schools/:id/subscription")
  subscription(@CurrentAuth() auth: AuthContext, @Param("id") id: string, @Body() dto: UpdateSubscriptionDto, @Req() req: Request) {
    return this.saas.updateSubscription(auth, id, dto, clientInfo(req));
  }

  @Post("schools/:id/usage-snapshots")
  @HttpCode(201)
  snapshot(@CurrentAuth() auth: AuthContext, @Param("id") id: string, @Req() req: Request) {
    return this.saas.snapshot(auth, id, clientInfo(req));
  }

  @Post("schools/:id/invoices")
  @HttpCode(201)
  draft(@CurrentAuth() auth: AuthContext, @Param("id") id: string, @Body() dto: DraftInvoiceDto, @Req() req: Request) {
    return this.saas.draftInvoice(auth, id, dto, clientInfo(req));
  }

  @Post("invoices/:id/collect")
  @HttpCode(200)
  collect(@CurrentAuth() auth: AuthContext, @Param("id") id: string, @Req() req: Request) {
    return this.saas.collect(auth, id, clientInfo(req));
  }

  @Get("plans")
  async plans(@CurrentAuth() auth: AuthContext) {
    return { plans: await this.saas.listPlans(auth) };
  }

  @Post("plans")
  @HttpCode(201)
  createPlan(@CurrentAuth() auth: AuthContext, @Body() dto: CreatePlanDto, @Req() req: Request) {
    return this.saas.createPlan(auth, dto, clientInfo(req));
  }

  @Patch("plans/:id")
  updatePlan(@CurrentAuth() auth: AuthContext, @Param("id") id: string, @Body() dto: UpdatePlanDto, @Req() req: Request) {
    return this.saas.updatePlan(auth, id, dto, clientInfo(req));
  }

  @Get("billing/provider")
  provider() {
    return this.saas.providerStatus();
  }
}

/** Lot 9 : la direction consulte l'abonnement de SON établissement (lecture seule). */
@Controller("billing")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction")
@RequireMfa()
export class SchoolBillingController {
  constructor(private readonly saas: SaasService) {}

  @Get()
  billing(@CurrentAuth() auth: AuthContext) {
    return this.saas.schoolBilling(auth);
  }
}
