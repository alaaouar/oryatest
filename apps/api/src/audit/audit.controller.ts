import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { AuditService } from "./audit.service";

/**
 * Consultation du journal d'audit.
 * - direction : uniquement les événements de son école (RLS) ;
 * - super-admin : tous les événements, y compris ses accès support (CDC §4 M10).
 */
@Controller("audit")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles("direction", "super_admin")
  @RequireMfa()
  async list(@CurrentAuth() auth: AuthContext, @Query("limit") limit?: string) {
    const parsed = Number.parseInt(limit ?? "100", 10);

    const entries = await this.audit.list(
      {
        userId: auth.userId,
        profileId: auth.profileId,
        schoolId: auth.schoolId,
        isSuperAdmin: auth.role === "super_admin",
      },
      Number.isNaN(parsed) ? 100 : parsed,
    );

    return { entries };
  }
}
