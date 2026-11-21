import { Controller, Get, Query, Req, Res, StreamableFile, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { MassarCheckDto, MassarExportDto } from "./massar.dto";
import { MassarService } from "./massar.service";

/** Lot 8 : préparation Massar (direction + MFA). Aucune connexion officielle. */
@Controller("massar")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction")
@RequireMfa()
export class MassarController {
  constructor(private readonly massar: MassarService) {}

  @Get("check")
  check(@CurrentAuth() auth: AuthContext, @Query() query: MassarCheckDto) {
    return this.massar.check(auth, query);
  }

  @Get("exports")
  history(@CurrentAuth() auth: AuthContext) {
    return this.massar.history(auth);
  }

  @Get("export")
  async export(
    @CurrentAuth() auth: AuthContext,
    @Query() query: MassarExportDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { content, filename, exportId } = await this.massar.export(auth, query, clientInfo(request));
    response.set({
      "Content-Type": query.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(content.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Orya-Export-Id": exportId,
      "Access-Control-Expose-Headers": "Content-Disposition, X-Orya-Export-Id",
    });
    return new StreamableFile(content);
  }
}
