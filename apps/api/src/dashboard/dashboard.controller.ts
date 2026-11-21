import { Controller, Get, Query, Req, Res, StreamableFile, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuditService } from "../audit/audit.service";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { DashboardExportDto, DashboardRangeDto } from "./dashboard.dto";
import { DashboardService } from "./dashboard.service";
import { toCsv, toXlsx } from "./export";

/** Tableau de bord direction : lecture seule, second facteur obligatoire. */
@Controller("dashboard")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction")
@RequireMfa()
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly audit: AuditService,
  ) {}

  @Get("summary")
  summary(@CurrentAuth() auth: AuthContext, @Query() query: DashboardRangeDto) {
    return this.dashboard.summary(auth, query);
  }

  @Get("export")
  async export(
    @CurrentAuth() auth: AuthContext,
    @Query() query: DashboardExportDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const table = await this.dashboard.report(auth, query.report, query);
    const content = query.format === "csv" ? toCsv(table) : await toXlsx(table);
    const range = this.dashboard.range(query);
    const filename = `orya-${query.report}-${range.from}-${range.to}.${query.format}`;
    await this.audit.scoped(toTenantContext(auth), {
      action: "dashboard.exported",
      entity: "School",
      entityId: auth.schoolId,
      metadata: { report: query.report, format: query.format, from: range.from, to: range.to, rows: table.rows.length },
      ...clientInfo(request),
    });
    response.set({
      "Content-Type":
        query.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(content.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(content);
  }
}
